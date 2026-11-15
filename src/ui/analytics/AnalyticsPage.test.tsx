import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DailyActivity } from '../../domain/progressStats';
import { addDays, dayKey, type CardProgress } from '../../domain/srs';
import type { StudyGoal } from '../../domain/studyGoals';
import type { StudyMode, StudySession } from '../../domain/studySessions';
import type { AppData } from '../../domain/types';
import { ANALYTICS_STORAGE_KEY, type AnalyticsData } from '../../storage/analyticsStore';
import { STORAGE_KEY } from '../../storage/localStore';
import { PROGRESS_STORAGE_KEY } from '../../storage/progressStore';
import { MemoryStorage } from '../../test/memoryStorage';
import { makeAppData, makeCard, makeDeck, makeProgress, renderApp } from '../../test/renderApp';
import AnalyticsErrorBoundary from './AnalyticsErrorBoundary';

const NOW = Date.now();

function at(daysAgo: number, hour = 10): number {
  const date = new Date(addDays(NOW, -daysAgo));
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

let sessionCount = 0;
function session(
  daysAgo: number,
  results: [string, number, number][],
  overrides: Partial<StudySession> & { mode?: StudyMode } = {},
): StudySession {
  sessionCount += 1;
  // Today's sessions are placed at the start of the day, so they are never in the future.
  const start = daysAgo === 0 ? new Date(NOW).setHours(0, 1, 0, 0) : at(daysAgo);
  const answered = results.reduce((sum, [, c, i]) => sum + c + i, 0);
  return {
    id: `session-${sessionCount}`,
    mode: 'quiz',
    deckId: null,
    day: dayKey(start),
    startedAt: start,
    endedAt: start + 120_000,
    durationMs: 120_000,
    answered,
    correct: results.reduce((sum, [, c]) => sum + c, 0),
    responseMs: answered * 2_000,
    timedAnswers: answered,
    results: results.map(([cardId, correct, incorrect]) => ({ cardId, correct, incorrect })),
    ...overrides,
  };
}

const biology = makeDeck({ id: 'bio', name: 'Biology' });
const spanish = makeDeck({ id: 'spa', name: 'Spanish' });
const empty = makeDeck({ id: 'empty', name: 'Empty deck' });
const mitosis = makeCard({
  id: 'mitosis',
  deckId: 'bio',
  term: 'Mitosis',
  definition: 'Cell division',
});
const enzyme = makeCard({ id: 'enzyme', deckId: 'bio', term: 'Enzyme', definition: 'A catalyst' });
const gato = makeCard({ id: 'gato', deckId: 'spa', term: 'gato', definition: 'cat' });

function store({
  data = makeAppData([mitosis, enzyme, gato], [biology, spanish, empty]),
  records = [],
  history = [],
  sessions = [],
  goals = [],
}: {
  data?: AppData;
  records?: CardProgress[];
  history?: DailyActivity[];
  sessions?: StudySession[];
  goals?: StudyGoal[];
} = {}): MemoryStorage {
  return new MemoryStorage({
    [STORAGE_KEY]: JSON.stringify(data),
    [PROGRESS_STORAGE_KEY]: JSON.stringify({ version: 1, records, history }),
    [ANALYTICS_STORAGE_KEY]: JSON.stringify({
      version: 1,
      sessions,
      goals,
    } satisfies AnalyticsData),
  });
}

function storedAnalytics(storage: MemoryStorage): AnalyticsData {
  return JSON.parse(
    storage.getItem(ANALYTICS_STORAGE_KEY) ?? '{"version":1,"sessions":[],"goals":[]}',
  );
}

/** A history with a bit of everything: two decks, a struggling card, a weak deck. */
function richStorage(extra: StudySession[] = []) {
  return store({
    records: [
      makeProgress({
        cardId: 'gato',
        deckId: 'spa',
        reviews: 6,
        correct: 1,
        incorrect: 5,
        streak: 0,
        lastReviewedAt: at(1),
      }),
      makeProgress({
        cardId: 'mitosis',
        deckId: 'bio',
        reviews: 8,
        correct: 8,
        incorrect: 0,
        streak: 8,
      }),
    ],
    sessions: [
      session(0, [['mitosis', 6, 0]], { deckId: 'bio', mode: 'review' }),
      session(1, [['gato', 1, 4]], { deckId: 'spa' }),
      session(
        2,
        [
          ['mitosis', 5, 1],
          ['enzyme', 4, 0],
        ],
        { mode: 'learn' },
      ),
      session(20, [['enzyme', 2, 2]], { deckId: 'bio', mode: 'match' }),
      ...extra,
    ],
    history: [{ day: dayKey(at(0)), reviews: 6, correct: 6 }],
  });
}

function tile(label: string): HTMLElement {
  return screen.getByText(label, { selector: 'p' }).closest('div.rounded-xl') as HTMLElement;
}

async function openAnalytics(storage: MemoryStorage, route = '/analytics') {
  renderApp({ storage, route });
  return screen.findByRole('heading', { level: 1, name: 'Analytics' });
}

describe('reaching the analytics page', () => {
  it('is in the main navigation, and shows a loading state while it loads', async () => {
    const user = userEvent.setup();
    renderApp({ storage: richStorage(), route: '/' });
    await user.click(screen.getByRole('link', { name: 'Analytics' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading analytics…');
    expect(await screen.findByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens directly at its address, with the period from the address', async () => {
    await openAnalytics(richStorage(), '/analytics?period=7d');
    expect(screen.getByRole('radio', { name: 'Last 7 days' })).toBeChecked();
  });

  it('falls back to 30 days for an unknown period', async () => {
    await openAnalytics(richStorage(), '/analytics?period=forever');
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toBeChecked();
  });

  it('is linked from the statistics page', async () => {
    const user = userEvent.setup();
    renderApp({ storage: richStorage(), route: '/stats' });
    await user.click(screen.getByRole('link', { name: 'Full analytics' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
  });
});

describe('with no study history', () => {
  it('says so, invents nothing, and offers a way to start', async () => {
    await openAnalytics(store());
    expect(screen.getByRole('heading', { name: 'No study activity yet' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Study a little to unlock suggestions' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start reviewing' })).toHaveAttribute(
      'href',
      '/review',
    );
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Weak cards' })).not.toBeInTheDocument();
    // Decks and goals still show, with their own empty states.
    expect(screen.getAllByText('Not studied in this period.').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Study goals' })).toBeInTheDocument();
  });

  it('asks for cards first when there are none', async () => {
    await openAnalytics(store({ data: makeAppData([], [biology]) }));
    expect(screen.getByRole('heading', { name: 'Add some cards to begin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a card' })).toHaveAttribute('href', '/add');
  });
});

describe('the overview', () => {
  it('reports totals from the recorded sessions, counting Review answers once', async () => {
    await openAnalytics(richStorage());
    // 6 review + 5 quiz + 10 learn + 4 match answers; the review log repeats the 6 review answers.
    expect(within(tile('Cards reviewed')).getByText('25')).toBeInTheDocument();
    expect(within(tile('Correct answers')).getByText('18')).toBeInTheDocument();
    expect(within(tile('Missed answers')).getByText('7')).toBeInTheDocument();
    expect(within(tile('Accuracy')).getByText('72%')).toBeInTheDocument();
    expect(within(tile('Study sessions')).getByText('4')).toBeInTheDocument();
    expect(within(tile('Study time')).getByText('8 min')).toBeInTheDocument();
    expect(within(tile('Average response')).getByText('2.0 s')).toBeInTheDocument();
    expect(within(tile('Current streak')).getByText('3 days')).toBeInTheDocument();
  });

  it('changes with the period', async () => {
    const user = userEvent.setup();
    await openAnalytics(richStorage());
    await user.click(screen.getByRole('radio', { name: 'Last 7 days' }));
    expect(within(tile('Cards reviewed')).getByText('21')).toBeInTheDocument();
    expect(within(tile('Study sessions')).getByText('3')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All time' }));
    expect(within(tile('Cards reviewed')).getByText('25')).toBeInTheDocument();
  });
});

describe('progress charts', () => {
  it('switches between charts, each with a summary and a table', async () => {
    const user = userEvent.setup();
    await openAnalytics(richStorage());
    const tabs = screen.getByRole('tablist', { name: 'Chart' });
    expect(within(tabs).getByRole('tab', { name: 'Cards reviewed' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText(/25 answers in the last 30 days/)).toBeInTheDocument();

    await user.click(within(tabs).getByRole('tab', { name: 'Accuracy' }));
    expect(screen.getByText(/72% of answers were right in the last 30 days/)).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(within(tabs).getByRole('tab', { name: 'Study time' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText(/8 min of active study/)).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Study time per day' });
    expect(within(table).getAllByRole('row')).toHaveLength(31);
  });

  it('reads out a point chosen with the keyboard', async () => {
    const user = userEvent.setup();
    await openAnalytics(richStorage());
    const chart = screen.getByRole('group', { name: /Cards reviewed per day/ });
    chart.focus();
    await user.keyboard('{End}');
    expect(screen.getByText(/: 6 Correct, 0 Missed$/)).toBeInTheDocument();
  });
});

describe('learning performance', () => {
  it('keeps observed accuracy and the estimated memory strength apart', async () => {
    await openAnalytics(richStorage());
    expect(screen.getByRole('heading', { name: 'Observed accuracy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Estimated memory strength' })).toBeInTheDocument();
    expect(
      screen.getByText('An estimate from your spaced repetition schedule, not a measurement.'),
    ).toBeInTheDocument();
    const modes = screen.getByRole('table', { name: /Answers by study mode/ });
    expect(within(modes).getByRole('row', { name: /Learn 10 90%/ })).toBeInTheDocument();
  });
});

describe('deck performance', () => {
  it('shows every deck, with empty and unstudied decks handled', async () => {
    await openAnalytics(richStorage());
    const decks = screen.getByRole('list', { name: 'Decks' });
    const items = within(decks).getAllByRole('listitem');
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Biology',
      'Spanish',
      'Empty deck',
    ]);
    expect(
      within(items[2]!).getByText('Add cards to this deck to start tracking it.'),
    ).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: 'Open deck' })).toHaveAttribute(
      'href',
      '/decks/bio',
    );
    // Spanish has only 5 answers in 30 days: too few to call it the weakest.
    expect(screen.queryByText(/Strongest:/)).not.toBeInTheDocument();
  });

  it('names the strongest and weakest deck once both have enough answers', async () => {
    await openAnalytics(richStorage(), '/analytics?period=all');
    const decks = screen.getByRole('list', { name: 'Decks' });
    expect(
      within(decks)
        .getAllByRole('listitem')
        .map((item) => within(item).getByRole('heading').textContent),
    ).toEqual(['BiologyStrongest', 'SpanishNeeds attention', 'Empty deck']);
    // All time counts each card's lifetime Review answers once.
    expect(screen.getByText(/Strongest:/)).toHaveTextContent(
      'Strongest: Biology (86%). Needs the most attention: Spanish (18%).',
    );
  });

  it('sorts by accuracy and by cards reviewed', async () => {
    const user = userEvent.setup();
    await openAnalytics(richStorage());
    const names = () =>
      within(screen.getByRole('list', { name: 'Decks' }))
        .getAllByRole('listitem')
        .map((item) => within(item).getAllByRole('link')[0]!.textContent);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Lowest accuracy');
    expect(names()).toEqual(['Spanish', 'Biology', 'Empty deck']);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort by' }),
      'Fewest cards reviewed',
    );
    expect(names()).toEqual(['Empty deck', 'Spanish', 'Biology']);
  });
});

describe('weak cards', () => {
  it('lists the card the user keeps missing, with why and where to go', async () => {
    await openAnalytics(richStorage());
    const section = screen.getByRole('region', { name: 'Weak cards' });
    expect(within(section).getByText('gato')).toBeInTheDocument();
    expect(within(section).queryByText('Mitosis')).not.toBeInTheDocument();
    expect(within(section).getByText('• Right 2 of 11 times')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Open card' })).toHaveAttribute(
      'href',
      '/edit/gato',
    );
    expect(within(section).getByRole('link', { name: 'Open deck' })).toHaveAttribute(
      'href',
      '/decks/spa',
    );
    expect(within(section).getByRole('link', { name: 'Practise weak cards' })).toHaveAttribute(
      'href',
      '/learn?focus=weak',
    );
  });

  it('opens Learn on just the weak cards', async () => {
    const user = userEvent.setup();
    await openAnalytics(richStorage());
    await user.click(
      within(screen.getByRole('region', { name: 'Weak cards' })).getByRole('link', {
        name: 'Practise weak cards',
      }),
    );
    expect(await screen.findByText('Practising weak cards')).toBeInTheDocument();
    expect(screen.getByText('Mastered 0 of 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'gato' })).toBeInTheDocument();
  });

  it('says when there are none', async () => {
    renderApp({ storage: store(), route: '/learn?focus=weak' });
    expect(screen.getByRole('heading', { name: 'No weak cards right now' })).toBeInTheDocument();
  });
});

describe('study activity', () => {
  it('shows streaks and weekly summaries', async () => {
    await openAnalytics(richStorage());
    const section = screen.getByRole('region', { name: 'Study activity' });
    expect(within(section).getByText('Days studied').nextSibling).toHaveTextContent('4');
    const weeks = within(section).getByRole('table', { name: /by week/ });
    expect(within(weeks).getAllByRole('row')).toHaveLength(9);
  });
});

describe('study goals', () => {
  it('sets, checks, edits and turns off a goal, saving each change', async () => {
    const user = userEvent.setup();
    const storage = richStorage();
    await openAnalytics(storage);
    const section = screen.getByRole('region', { name: 'Study goals' });

    await user.click(
      within(section).getByRole('button', { name: 'Set goal: Cards reviewed per day' }),
    );
    const input = within(section).getByRole('textbox', { name: /Target/ });
    await user.clear(input);
    await user.type(input, '5000');
    await user.click(within(section).getByRole('button', { name: 'Save goal' }));
    expect(within(section).getByRole('alert')).toHaveTextContent(
      'Choose between 1 and 1000 cards.',
    );

    await user.clear(input);
    await user.type(input, '5');
    await user.click(within(section).getByRole('button', { name: 'Save goal' }));
    expect(within(section).getByText('Goal saved.')).toBeInTheDocument();
    // Six cards were reviewed today.
    expect(within(section).getByText('Goal met')).toBeInTheDocument();
    expect(storedAnalytics(storage).goals).toMatchObject([{ id: 'cards-per-day', target: 5 }]);

    await user.click(
      within(section).getByRole('button', { name: 'Edit goal: Cards reviewed per day' }),
    );
    await user.click(within(section).getByRole('button', { name: 'Turn off' }));
    expect(within(section).getByText('Goal turned off. Its history is kept.')).toBeInTheDocument();
    const [goal] = storedAnalytics(storage).goals;
    expect(goal?.target).toBeNull();
    expect(goal?.changes.map((c) => c.target)).toEqual([5, null]);
  });
});

describe('recommendations', () => {
  it('explains each suggestion and links to the study it suggests', async () => {
    await openAnalytics(richStorage());
    const section = screen.getByRole('region', { name: 'What to study next' });
    expect(
      within(section).getByRole('heading', { name: 'Practise your weak cards' }),
    ).toBeInTheDocument();
    expect(within(section).getByText(/“gato” was right 2 of 11 times/)).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Practise weak cards' })).toHaveAttribute(
      'href',
      '/learn?focus=weak',
    );
  });
});

describe('study history', () => {
  it('lists sessions newest first and filters them by deck and by performance', async () => {
    const user = userEvent.setup();
    await openAnalytics(richStorage());
    const section = screen.getByRole('region', { name: 'Study history' });
    const rows = () => within(within(section).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows()).toHaveLength(4);
    expect(rows()[0]).toHaveTextContent('Review · Biology');
    expect(within(section).getByText('4 sessions.')).toBeInTheDocument();

    await user.selectOptions(within(section).getByRole('combobox', { name: 'Deck' }), 'Spanish');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Quiz · Spanish');

    await user.selectOptions(within(section).getByRole('combobox', { name: 'Deck' }), 'Every deck');
    await user.selectOptions(
      within(section).getByRole('combobox', { name: 'Performance' }),
      'Strong (80% or more)',
    );
    expect(rows()).toHaveLength(2);

    await user.click(within(section).getByRole('button', { name: 'Clear filters' }));
    expect(rows()).toHaveLength(4);
  });

  it('filters by date range, and says when nothing matches', async () => {
    const user = userEvent.setup();
    await openAnalytics(richStorage());
    const section = screen.getByRole('region', { name: 'Study history' });
    await user.type(within(section).getByLabelText('From'), dayKey(at(1)));
    expect(within(section).getByText('2 sessions match.')).toBeInTheDocument();
    await user.type(within(section).getByLabelText('To'), dayKey(at(30)));
    expect(within(section).getByRole('alert')).toHaveTextContent(
      'The start date is after the end date.',
    );
  });

  it('pages through a long history', async () => {
    const user = userEvent.setup();
    const extra = Array.from({ length: 12 }, (_, i) => session(3 + i, [['enzyme', 1, 0]]));
    await openAnalytics(richStorage(extra));
    const section = screen.getByRole('region', { name: 'Study history' });
    expect(within(section).getByText('Page 1 of 2')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Newer' })).toBeDisabled();
    await user.click(within(section).getByRole('button', { name: 'Older' }));
    expect(within(section).getByText('Page 2 of 2')).toBeInTheDocument();
    expect(within(within(section).getByRole('table')).getAllByRole('row')).toHaveLength(7);
  });

  it('explains reviews saved before sessions were recorded', async () => {
    await openAnalytics(
      store({
        history: [{ day: dayKey(at(50)), reviews: 5, correct: 4 }],
        sessions: [session(0, [['gato', 1, 0]])],
      }),
    );
    expect(
      screen.getByText(/Reviews from 1 day were saved before sessions were recorded/),
    ).toBeInTheDocument();
  });
});

describe('when something goes wrong', () => {
  it('shows an error in place of the analytics, and can try again', async () => {
    const user = userEvent.setup();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    function Broken() {
      if (fail) throw new Error('boom');
      return <p>Recovered</p>;
    }
    render(
      <AnalyticsErrorBoundary>
        <Broken />
      </AnalyticsErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Analytics could not be shown');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered')).toBeInTheDocument();
    quiet.mockRestore();
  });
});

describe('staying up to date', () => {
  it('counts a review made a moment ago', async () => {
    const user = userEvent.setup();
    const storage = store();
    renderApp({ storage, route: '/review?mode=new' });
    await user.click(await screen.findByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));
    await user.click(screen.getByRole('link', { name: 'Analytics' }));
    await screen.findByRole('heading', { level: 1, name: 'Analytics' });
    await waitFor(() => expect(within(tile('Cards reviewed')).getByText('1')).toBeInTheDocument());
    expect(within(tile('Study sessions')).getByText('1')).toBeInTheDocument();
  });
});
