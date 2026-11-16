import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedCard } from '../../../supabase/functions/_shared/flashcards/contract.ts';
import type { AppData } from '../../domain/types';
import { ANALYTICS_STORAGE_KEY } from '../../storage/analyticsStore';
import { fakeCloud } from '../../test/fakeAuth';
import { makeGeneratedCard } from '../../test/fakeGeneration';
import {
  makeAppData,
  makeCard,
  makeDeck,
  renderApp,
  storageWithData,
  storedCards,
  storedDecks,
  storedProgress,
} from '../../test/renderApp';

const MATERIAL =
  'Mitochondria produce ATP through cellular respiration. Ribosomes build proteins from amino acids. The nucleus stores the cell’s DNA.';

const ATP = makeGeneratedCard({
  question: 'What do mitochondria produce?',
  answer: 'ATP',
  evidence: 'Mitochondria produce ATP through cellular respiration.',
});
const PROTEINS = makeGeneratedCard({
  kind: 'term',
  question: 'Ribosome',
  answer: 'Builds proteins from amino acids',
  evidence: 'Ribosomes build proteins from amino acids.',
});
const DNA = makeGeneratedCard({
  kind: 'fill-blank',
  question: 'The nucleus stores the cell’s _____.',
  answer: 'DNA',
  evidence: 'The nucleus stores the cell’s DNA.',
});

function collection(): AppData {
  return makeAppData(
    [makeCard({ id: 'existing', deckId: 'bio', term: 'Cell', definition: 'The unit of life' })],
    [makeDeck({ id: 'default', name: 'My Cards' }), makeDeck({ id: 'bio', name: 'Biology' })],
  );
}

/** Signed in, with this browser already holding `data`, on the Generate page. */
async function signedIn({
  data = collection(),
  route = '/generate',
  configured = true,
}: { data?: AppData; route?: string; configured?: boolean } = {}) {
  const cloud = fakeCloud();
  cloud.auth.addUser('me@example.test', 'studyhard2026', 'user-1');
  cloud.auth.signInAs('me@example.test');
  if (!configured) {
    cloud.generation.statusReply = {
      ok: true,
      value: { ok: true, configured: false, provider: null },
    };
  }
  const storage = storageWithData(data);
  const user = userEvent.setup();
  renderApp({ storage, route, cloud: cloud.setup });
  await screen.findByRole('heading', { level: 1, name: 'Generate cards with AI' });
  return { cloud, storage, user, generation: cloud.generation };
}

async function enterMaterial(user: ReturnType<typeof userEvent.setup>, text = MATERIAL) {
  await user.click(screen.getByLabelText('Study material'));
  await user.paste(text);
}

function card(number: number) {
  return screen.getByRole('listitem', { name: `Card ${number}` });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getting to the Generate page', () => {
  it('is left out of a build without a server, and explains why', async () => {
    renderApp({ route: '/generate' });
    expect(screen.queryByRole('link', { name: 'Generate' })).not.toBeInTheDocument();
    expect(await screen.findByText(/needs a Snap Notes server/)).toBeInTheDocument();
  });

  it('asks a signed-out user to sign in', async () => {
    const cloud = fakeCloud();
    renderApp({ route: '/generate', cloud: cloud.setup });
    expect(
      await screen.findByRole('heading', { name: 'Sign in to generate cards' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Generate' })).toHaveAttribute('href', '/generate');
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Sign in' }),
    ).toBeInTheDocument();
  });

  it('is linked from a deck, with that deck chosen for saving', async () => {
    const cloud = fakeCloud();
    cloud.auth.addUser('me@example.test', 'studyhard2026', 'user-1');
    cloud.auth.signInAs('me@example.test');
    const user = userEvent.setup();
    renderApp({ storage: storageWithData(collection()), route: '/decks/bio', cloud: cloud.setup });
    await user.click(await screen.findByRole('link', { name: 'Generate cards with AI' }));
    expect(await screen.findByLabelText('Save cards to')).toHaveValue('bio');
  });

  it('says where the material is processed, and that cards should be checked', async () => {
    await signedIn();
    expect(
      await screen.findByText(/to Anthropic \(Claude\) to write the cards/),
    ).toBeInTheDocument();
    expect(screen.getByText(/AI-written cards can contain mistakes/)).toBeInTheDocument();
  });

  it('explains when the server has no AI provider, and does not offer to generate', async () => {
    const { user } = await signedIn({ configured: false });
    expect(await screen.findByText(/not set up on this Snap Notes server yet/)).toBeInTheDocument();
    await enterMaterial(user);
    expect(screen.getByRole('button', { name: 'Generate cards' })).toBeDisabled();
  });
});

describe('study material', () => {
  it('needs enough material, and offers to trim material over the limit', async () => {
    const { user } = await signedIn();
    const button = screen.getByRole('button', { name: 'Generate cards' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Add some study material to begin.')).toBeInTheDocument();

    await enterMaterial(user, 'Too short.');
    expect(button).toBeDisabled();
    expect(screen.getByText(/at least 40 characters/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Study material'));
    await enterMaterial(user, 'x'.repeat(30_005));
    expect(screen.getByText('30,005 / 30,000 characters')).toBeInTheDocument();
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Keep the first 30,000 characters' }));
    expect(screen.getByLabelText('Study material')).toHaveValue('x'.repeat(30_000));
    expect(button).toBeEnabled();
  });

  it('reads an uploaded text file on this device', async () => {
    const { user, generation } = await signedIn();
    const file = new File(
      ['Photosynthesis turns light into chemical energy in chloroplasts.'],
      'notes.txt',
      {
        type: 'text/plain',
      },
    );
    await user.upload(screen.getByTestId('material-file'), file);
    expect(
      await screen.findByText(/Added 64 characters from the text file “notes.txt”/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Study material')).toHaveValue(
      'Photosynthesis turns light into chemical energy in chloroplasts.',
    );
    expect(generation.requests).toEqual([]);
  });

  it('explains a file that cannot be used, and leaves the material alone', async () => {
    const { user } = await signedIn();
    await enterMaterial(user, 'My notes');
    const input = screen.getByTestId('material-file');
    await user.upload(input, new File([''], 'empty.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('empty.txt: This file is empty.');
    await user.upload(
      input,
      new File(['%PDF-1.4 not really'], 'notes.txt', { type: 'text/plain' }),
    );
    expect(
      await screen.findByText(/named like a text file, but it is not plain text/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Study material')).toHaveValue('My notes');
  });

  it('can use the cards of an existing deck', async () => {
    const { user } = await signedIn();
    await user.selectOptions(screen.getByLabelText('From your cards'), 'bio');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByLabelText('Study material')).toHaveValue('Cell: The unit of life');
    expect(screen.getByText('Added 1 card from “Biology”.')).toBeInTheDocument();
  });
});

describe('generating', () => {
  it('sends the settings, shows progress, ignores repeated clicks and lists the cards', async () => {
    const { user, generation } = await signedIn();
    generation.nextCards([ATP, PROTEINS]);
    generation.hold();

    await enterMaterial(user);
    await user.type(screen.getByLabelText(/Topic/), 'Cells');
    await user.selectOptions(screen.getByLabelText('Card type'), 'qa');
    await user.selectOptions(screen.getByLabelText('Difficulty'), 'hard');
    await user.selectOptions(screen.getByLabelText('Number of cards'), '5');
    await user.click(screen.getByRole('button', { name: 'Generate cards' }));

    expect(
      await screen.findByText(/Reading your material and writing 5 cards/),
    ).toBeInTheDocument();
    const busy = screen.getByRole('button', { name: 'Generating…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(screen.getByLabelText('Study material')).toBeDisabled();

    generation.release();
    // Focus moves to the new cards, for keyboard and screen reader users.
    const heading = await screen.findByRole('heading', { name: '3. Review and save' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(generation.requests).toEqual([
      {
        action: 'generate',
        material: MATERIAL,
        topic: 'Cells',
        count: 5,
        cardType: 'qa',
        difficulty: 'hard',
        avoid: [],
      },
    ]);
    expect(screen.getByTestId('draft-counts')).toHaveTextContent(
      '2 generated · 2 selected · 0 saved',
    );
    expect(within(card(1)).getByLabelText('Question')).toHaveValue('What do mitochondria produce?');
    expect(within(card(2)).getByLabelText('Term')).toHaveValue('Ribosome');
    expect(
      screen.getByText('Wrote 2 of the 5 cards asked for: the material did not support more.'),
    ).toBeInTheDocument();
  });

  it('can be cancelled', async () => {
    const { user, generation } = await signedIn();
    generation.nextCards([ATP]);
    generation.hold();
    await enterMaterial(user);
    await user.click(screen.getByRole('button', { name: 'Generate cards' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate cards' })).toBeEnabled(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Generated cards' })).not.toBeInTheDocument();
  });

  it('explains an empty result', async () => {
    const { user, generation } = await signedIn();
    generation.nextCards([], { invalid: 0, ungrounded: 3, duplicate: 0 });
    await enterMaterial(user);
    await user.click(screen.getByRole('button', { name: 'Generate cards' }));
    expect(
      await screen.findByText(/No cards could be written from this material/),
    ).toHaveTextContent('Left out: 3 were not supported by your material.');
  });

  it('explains a failure, and retries the same request', async () => {
    const { user, generation } = await signedIn();
    generation.nextFailure({
      code: 'provider-unavailable',
      message: 'The AI service is busy or unavailable right now. Try again in a minute.',
    });
    generation.nextCards([ATP]);
    await enterMaterial(user);
    await user.click(screen.getByRole('button', { name: 'Generate cards' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The AI service is busy');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('listitem', { name: 'Card 1' })).toBeInTheDocument();
    expect(generation.requests).toHaveLength(2);
    expect(generation.requests[1]).toEqual(generation.requests[0]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says when the allowance is used up, and when to come back', async () => {
    const { user, generation } = await signedIn();
    generation.nextFailure({
      code: 'rate-limited',
      message: 'You have generated a lot of cards recently. Wait a while, then try again.',
      retryAfterSeconds: 540,
    });
    await enterMaterial(user);
    await user.click(screen.getByRole('button', { name: 'Generate cards' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You have generated a lot of cards recently.');
    expect(alert).toHaveTextContent('You can try again in about 9 minutes.');
  });

  it('sends a user whose session ended to sign in again', async () => {
    const { user, generation } = await signedIn();
    generation.nextFailure({ code: 'unauthenticated', message: 'Your session has ended.' });
    await enterMaterial(user);
    await user.click(screen.getByRole('button', { name: 'Generate cards' }));
    expect(await screen.findByRole('link', { name: 'Sign in again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('asks before replacing unsaved cards with a new set', async () => {
    const { user, generation } = await signedIn();
    generation.nextCards([ATP]);
    await enterMaterial(user);
    await user.click(screen.getByRole('button', { name: 'Generate cards' }));
    await screen.findByRole('listitem', { name: 'Card 1' });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'Generate a new set' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Replace the 1 unsaved card/));
    expect(generation.requests).toHaveLength(1);
  });
});

describe('reviewing before saving', () => {
  async function withCards(cards: GeneratedCard[], options = {}) {
    const setup = await signedIn(options);
    setup.generation.nextCards(cards);
    await enterMaterial(setup.user);
    await setup.user.click(screen.getByRole('button', { name: 'Generate cards' }));
    await screen.findByRole('listitem', { name: 'Card 1' });
    return setup;
  }

  it('edits, deselects and removes cards, and saves only what is chosen', async () => {
    const { user, storage } = await withCards([ATP, PROTEINS, DNA]);

    const question = within(card(1)).getByLabelText('Question');
    await user.clear(question);
    await user.type(question, 'Which molecule do mitochondria produce?');
    const answer = within(card(1)).getByLabelText('Answer');
    await user.clear(answer);
    await user.type(answer, 'ATP (adenosine triphosphate)');
    expect(within(card(1)).getByText('edited')).toBeInTheDocument();

    await user.click(within(card(2)).getByRole('checkbox'));
    expect(screen.getByTestId('draft-counts')).toHaveTextContent(
      '3 generated · 2 selected · 0 saved',
    );
    await user.click(within(card(3)).getByRole('button', { name: 'Remove card 3' }));
    expect(screen.getByTestId('draft-counts')).toHaveTextContent(
      '2 generated · 1 selected · 0 saved',
    );

    await user.selectOptions(screen.getByLabelText('Save cards to'), 'bio');
    await user.click(screen.getByRole('button', { name: 'Save 1 card to “Biology”' }));

    expect(await screen.findByText('Saved 1 card to “Biology”.')).toBeInTheDocument();
    expect(screen.getByTestId('draft-counts')).toHaveTextContent(
      '2 generated · 0 selected · 1 saved',
    );
    const saved = storedCards(storage).filter((c) => c.id !== 'existing');
    expect(saved).toEqual([
      expect.objectContaining({
        deckId: 'bio',
        term: 'Which molecule do mitochondria produce?',
        definition: 'ATP (adenosine triphosphate)',
      }),
    ]);
    // The saved card is locked, with a link to edit it like any other card.
    expect(within(card(1)).getByText('Saved')).toBeInTheDocument();
    expect(within(card(1)).getByRole('link', { name: 'Edit saved card' })).toHaveAttribute(
      'href',
      `/edit/${saved[0]!.id}`,
    );
    expect(within(card(1)).getByLabelText('Question')).toHaveAttribute('readonly');
  });

  it('saves into a new deck, and keeps saving to it afterwards', async () => {
    const { user, storage } = await withCards([ATP, PROTEINS]);
    await user.click(within(card(2)).getByRole('checkbox'));
    await user.selectOptions(screen.getByLabelText('Save cards to'), 'New deck…');
    await user.type(screen.getByLabelText('New deck name'), 'Organelles');
    await user.click(screen.getByRole('button', { name: 'Save 1 card to a new deck' }));

    expect(await screen.findByText('Saved 1 card to “Organelles”.')).toBeInTheDocument();
    const deck = storedDecks(storage).find((d) => d.name === 'Organelles')!;
    expect(storedCards(storage).filter((c) => c.deckId === deck.id)).toHaveLength(1);
    expect(screen.getByLabelText('Save cards to')).toHaveValue(deck.id);

    await user.click(within(card(2)).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save 1 card to “Organelles”' }));
    expect(storedCards(storage).filter((c) => c.deckId === deck.id)).toHaveLength(2);
    expect(storedDecks(storage).filter((d) => d.name === 'Organelles')).toHaveLength(1);
  });

  it('refuses a new deck name already in use, without saving anything', async () => {
    const { user, storage } = await withCards([ATP]);
    await user.selectOptions(screen.getByLabelText('Save cards to'), 'New deck…');
    await user.type(screen.getByLabelText('New deck name'), 'biology');
    await user.click(screen.getByRole('button', { name: 'Save 1 card to a new deck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A deck called “biology” already exists.',
    );
    expect(storedCards(storage)).toHaveLength(1);
  });

  it('changes a card to multiple choice, and saves it only once it is complete', async () => {
    const { user, storage } = await withCards([ATP]);
    await user.selectOptions(within(card(1)).getByLabelText('Card 1 type'), 'Multiple choice');
    expect(within(card(1)).getByLabelText('Choice 1')).toHaveValue('ATP');
    expect(within(card(1)).getByText('Fill in every choice.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save 1 card to “My Cards”' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'One selected card needs fixing first',
    );
    expect(storedCards(storage)).toHaveLength(1);

    await user.type(within(card(1)).getByLabelText('Choice 2'), 'DNA');
    await user.type(within(card(1)).getByLabelText('Choice 3'), 'Glucose');
    await user.click(within(card(1)).getByRole('button', { name: 'Remove choice 4' }));
    // Picking another option as correct, then back.
    await user.click(within(card(1)).getByRole('radio', { name: 'Choice 2 is correct' }));
    await user.click(within(card(1)).getByRole('radio', { name: 'Choice 1 is correct' }));
    await user.click(screen.getByRole('button', { name: 'Save 1 card to “My Cards”' }));

    await screen.findByText('Saved 1 card to “My Cards”.');
    expect(storedCards(storage).at(-1)).toMatchObject({
      term: 'What do mitochondria produce?\n\nA. ATP\nB. DNA\nC. Glucose',
      definition: 'A. ATP',
    });
  });

  it('regenerates one card in place, avoiding the others', async () => {
    const { user, generation } = await withCards([ATP, PROTEINS]);
    const replacement = makeGeneratedCard({
      kind: 'term',
      question: 'Ribosomes',
      answer: 'Protein builders',
    });
    generation.nextCards([replacement]);
    await user.click(within(card(2)).getByRole('button', { name: 'Regenerate card 2' }));

    await waitFor(() => expect(within(card(2)).getByLabelText('Term')).toHaveValue('Ribosomes'));
    expect(within(card(1)).getByLabelText('Question')).toHaveValue('What do mitochondria produce?');
    expect(generation.requests[1]).toMatchObject({
      count: 1,
      cardType: 'term',
      avoid: ['What do mitochondria produce?', 'Ribosome'],
    });
  });

  it('generates more cards, added to the list', async () => {
    const { user, generation } = await withCards([ATP]);
    generation.nextCards([DNA]);
    await user.selectOptions(screen.getByLabelText('Need more?'), '3');
    await user.click(screen.getByRole('button', { name: 'Generate more cards' }));
    expect(await screen.findByRole('listitem', { name: 'Card 2' })).toBeInTheDocument();
    expect(generation.requests[1]).toMatchObject({
      count: 3,
      avoid: ['What do mitochondria produce?'],
    });
    expect(screen.getByTestId('draft-counts')).toHaveTextContent(
      '2 generated · 2 selected · 0 saved',
    );
  });

  it('selects and deselects every card at once', async () => {
    const { user } = await withCards([ATP, PROTEINS]);
    await user.click(screen.getByRole('button', { name: 'Select none' }));
    expect(screen.getByRole('button', { name: /^Save 0 cards/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByTestId('draft-counts')).toHaveTextContent('2 selected');
  });

  it('marks cards the deck already has, and does not add them twice', async () => {
    const same = makeGeneratedCard({ kind: 'term', question: 'Cell', answer: 'The unit of life' });
    const { user, storage } = await withCards([same, ATP]);
    await user.selectOptions(screen.getByLabelText('Save cards to'), 'bio');
    expect(within(card(1)).getByText('Already in “Biology”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save 2 cards to “Biology”' }));
    expect(
      await screen.findByText(/Saved 1 card to “Biology”. 1 was already in the deck/),
    ).toBeInTheDocument();
    expect(storedCards(storage).filter((c) => c.deckId === 'bio')).toHaveLength(2);
    expect(within(card(1)).getByText('Already in deck')).toBeInTheDocument();
  });

  it('asks before leaving with unsaved cards', async () => {
    const { user } = await withCards([ATP]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('link', { name: 'Decks' }));
    expect(confirm).toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Generate cards with AI' }),
    ).toBeInTheDocument();
  });
});

describe('saved cards in the rest of the app', () => {
  it('sync to the account, then study and count like any other card', async () => {
    const { user, cloud, storage, generation } = await signedIn();
    generation.nextCards([ATP]);
    await enterMaterial(user);
    await user.click(screen.getByRole('button', { name: 'Generate cards' }));
    await screen.findByRole('listitem', { name: 'Card 1' });
    await user.click(screen.getByRole('button', { name: 'Save 1 card to “My Cards”' }));
    await screen.findByText('Saved 1 card to “My Cards”.');

    const saved = storedCards(storage).find((c) => c.term === 'What do mitochondria produce?')!;
    // Uploaded by the ordinary sync engine, once, under its own ID.
    await waitFor(() => expect(cloud.server.live('card').map((c) => c.id)).toContain(saved.id), {
      timeout: 5000,
    });
    expect(cloud.server.live('card').filter((c) => c.id === saved.id)).toHaveLength(1);

    // A new card for spaced repetition: studying it saves progress and a study session.
    await user.click(screen.getByRole('link', { name: 'Study the new cards' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'What do mitochondria produce?' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));
    expect(storedProgress(storage).records).toContainEqual(
      expect.objectContaining({ cardId: saved.id, reviews: 1, correct: 1 }),
    );
    const analytics = JSON.parse(storage.getItem(ANALYTICS_STORAGE_KEY) ?? '{}') as {
      sessions?: Array<{ results: Array<{ cardId: string }> }>;
    };
    expect(analytics.sessions?.flatMap((s) => s.results.map((r) => r.cardId))).toContain(saved.id);
  });
});
