import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCard, renderApp, storageWithCards } from '../test/renderApp';

const capitals = [
  makeCard({ term: 'France', definition: 'Paris' }),
  makeCard({ term: 'Germany', definition: 'Berlin' }),
  makeCard({ term: 'Italy', definition: 'Rome' }),
  makeCard({ term: 'Spain', definition: 'Madrid' }),
];
const answers = new Map(capitals.map((card) => [card.term, card.definition]));

function renderQuiz(cards = capitals) {
  return renderApp({ storage: storageWithCards(cards), route: '/quiz' });
}

function questionHeading() {
  return screen.getByRole('heading', { level: 2 });
}

function choices() {
  return within(screen.getByRole('list', { name: 'Answer choices' })).getAllByRole('button');
}

/** The choice button whose text starts with `text` (its name grows once answered). */
function choice(text: string) {
  const found = choices().find((button) => button.textContent?.slice(1).startsWith(text));
  if (!found) throw new Error(`No choice "${text}"`);
  return found;
}

function correctChoice() {
  return choice(answers.get(questionHeading().textContent!)!);
}

function wrongChoice() {
  const right = answers.get(questionHeading().textContent!)!;
  return choices().find((button) => !button.textContent?.slice(1).startsWith(right))!;
}

function progressText() {
  return screen.getByText(/^Question \d+ of \d+$/).textContent;
}

function scoreText() {
  return screen.getByText(/^Score:/).textContent;
}

function feedbackStatus() {
  return screen.getByRole('status');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuizPage', () => {
  describe('with too few cards', () => {
    it('explains that there are no cards', () => {
      renderApp({ route: '/quiz' });

      expect(
        screen.getByRole('heading', { name: 'Not enough cards for a quiz' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/You have no cards yet/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Add a card' })).toBeInTheDocument();
    });

    it('needs at least two different definitions', () => {
      renderQuiz([
        makeCard({ term: 'One', definition: 'Same' }),
        makeCard({ term: 'Two', definition: ' same ' }),
      ]);

      expect(
        screen.getByRole('heading', { name: 'Not enough cards for a quiz' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Answer choices' })).not.toBeInTheDocument();
    });

    it('mentions cards that cannot be quizzed', () => {
      renderQuiz([
        makeCard({ term: 'Only', definition: 'Real' }),
        makeCard({ term: '', definition: 'No term' }),
      ]);

      expect(
        screen.getByText(/You have 1 card with both a term and a definition/),
      ).toHaveTextContent('1 card is missing a term or definition');
    });
  });

  it('asks one question per card with every choice shown', () => {
    renderQuiz();

    expect(progressText()).toBe('Question 1 of 4');
    expect(scoreText()).toBe('Score: 0');
    expect(answers.has(questionHeading().textContent!)).toBe(true);
    expect(choices()).toHaveLength(4);
    expect(
      choices()
        .map((b) => b.textContent!.slice(1))
        .sort(),
    ).toEqual(['Berlin', 'Madrid', 'Paris', 'Rome']);
    expect(screen.queryByRole('button', { name: /Next question/ })).not.toBeInTheDocument();
  });

  it('shows feedback for a correct answer and waits before moving on', async () => {
    const user = userEvent.setup();
    renderQuiz();

    await user.click(correctChoice());

    expect(screen.getByText('Correct!')).toBeInTheDocument();
    expect(feedbackStatus()).toHaveTextContent('Correct. Score: 1 of 1.');
    expect(scoreText()).toBe('Score: 1');
    expect(progressText()).toBe('Question 1 of 4');
    expect(correctChoice()).toHaveTextContent('Your answer — correct');
    for (const button of choices()) expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Next question' })).toHaveFocus();
  });

  it('shows feedback and the right answer for a wrong answer', async () => {
    const user = userEvent.setup();
    renderQuiz();
    const right = answers.get(questionHeading().textContent!)!;

    const wrong = wrongChoice();
    await user.click(wrong);

    expect(screen.getByText('Not quite.')).toBeInTheDocument();
    expect(screen.getByText(`The correct answer is: ${right}`)).toBeInTheDocument();
    expect(feedbackStatus()).toHaveTextContent(
      `Incorrect. The correct answer is: ${right}. Score: 0 of 1.`,
    );
    expect(wrong).toHaveTextContent('Your answer — incorrect');
    expect(choice(right)).toHaveTextContent('Correct answer');
    expect(scoreText()).toBe('Score: 0');
  });

  it('runs to a results screen with the score and a review of mistakes', async () => {
    const user = userEvent.setup();
    renderQuiz();

    const missedTerm = questionHeading().textContent!;
    await user.click(wrongChoice());
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    expect(questionHeading()).toHaveFocus();

    for (let i = 2; i <= 4; i++) {
      expect(progressText()).toBe(`Question ${i} of 4`);
      await user.click(correctChoice());
      await user.click(
        screen.getByRole('button', { name: i === 4 ? 'See results' : 'Next question' }),
      );
    }

    const results = screen.getByRole('heading', { name: 'Quiz complete' });
    expect(results).toHaveFocus();
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
    expect(screen.getByText(/You answered 3 of 4 questions correctly \(75%\)/)).toBeInTheDocument();

    const review = screen.getByRole('heading', { name: 'Review your mistakes' }).parentElement!;
    expect(within(review).getAllByRole('listitem')).toHaveLength(1);
    expect(within(review).getByText(missedTerm)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Answer choices' })).not.toBeInTheDocument();
  });

  it('counts only the first of several rapid clicks', () => {
    renderQuiz();
    const right = correctChoice();
    const wrong = wrongChoice();

    // All three clicks land before React re-renders, as with a fast double-click.
    act(() => {
      right.click();
      right.click();
      wrong.click();
    });

    expect(scoreText()).toBe('Score: 1');
    expect(progressText()).toBe('Question 1 of 4');
    expect(right).toHaveTextContent('Your answer — correct');
    expect(wrong).not.toHaveTextContent('Your answer');

    // The extra clicks were not saved as answers to later questions either.
    act(() => screen.getByRole('button', { name: 'Next question' }).click());
    expect(progressText()).toBe('Question 2 of 4');
    expect(screen.queryByRole('button', { name: 'Next question' })).not.toBeInTheDocument();
    for (const button of choices()) expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('ignores clicks on choices after answering', async () => {
    const user = userEvent.setup();
    renderQuiz();

    await user.click(wrongChoice());
    await user.click(correctChoice());
    await user.click(correctChoice());

    expect(scoreText()).toBe('Score: 0');
    expect(screen.getByText('Not quite.')).toBeInTheDocument();
  });

  it('advances exactly one question on a rapid double-click of Next', async () => {
    const user = userEvent.setup();
    renderQuiz();
    await user.click(correctChoice());
    const next = screen.getByRole('button', { name: 'Next question' });

    act(() => {
      next.click();
      next.click();
    });

    expect(progressText()).toBe('Question 2 of 4');
    // The new question is waiting for an answer, not skipped.
    expect(screen.queryByText('Correct!')).not.toBeInTheDocument();
    expect(choices()[0]).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('answers with number keys and continues with Enter', async () => {
    const user = userEvent.setup();
    renderQuiz();
    const firstChoice = choices()[0]!;
    const right = answers.get(questionHeading().textContent!)!;

    await user.keyboard('1');
    expect(firstChoice).toHaveTextContent('Your answer');
    const expectedScore = firstChoice.textContent!.slice(1).startsWith(right) ? 1 : 0;

    // Further number keys are ignored once answered.
    await user.keyboard('2345');
    expect(scoreText()).toBe(`Score: ${expectedScore}`);
    expect(progressText()).toBe('Question 1 of 4');

    await user.keyboard('{Enter}');
    expect(progressText()).toBe('Question 2 of 4');
    expect(questionHeading()).toHaveFocus();
  });

  it('ignores number keys with no matching choice', async () => {
    const user = userEvent.setup();
    renderQuiz();

    await user.keyboard('9');
    expect(screen.queryByRole('button', { name: 'Next question' })).not.toBeInTheDocument();
  });

  it('does not skip a question when Enter is held down', async () => {
    const user = userEvent.setup();
    renderQuiz();

    await user.click(correctChoice());
    const next = screen.getByRole('button', { name: 'Next question' });
    expect(next).toHaveFocus();
    // A repeated keydown is cancelled, so the browser does not click the button again.
    expect(fireEvent.keyDown(next, { key: 'Enter', repeat: true })).toBe(false);
    expect(progressText()).toBe('Question 1 of 4');
    await user.keyboard('{Enter>5/}');

    expect(progressText()).toBe('Question 2 of 4');
    expect(screen.queryByRole('button', { name: 'Next question' })).not.toBeInTheDocument();
  });

  it('ignores keyboard input once the quiz has ended', async () => {
    const user = userEvent.setup();
    renderQuiz(capitals.slice(0, 2));

    for (let i = 0; i < 2; i++) {
      await user.click(correctChoice());
      await user.keyboard('{Enter}');
    }
    expect(screen.getByText('2 / 2')).toBeInTheDocument();

    await user.keyboard('1{Enter}2 ');
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quiz complete' })).toBeInTheDocument();
  });

  it('restarts from the results with a fresh score', async () => {
    const user = userEvent.setup();
    renderQuiz(capitals.slice(0, 2));

    for (let i = 0; i < 2; i++) {
      await user.click(correctChoice());
      await user.keyboard('{Enter}');
    }
    await user.click(screen.getByRole('button', { name: 'Restart quiz' }));

    expect(progressText()).toBe('Question 1 of 2');
    expect(scoreText()).toBe('Score: 0');
    expect(questionHeading()).toHaveFocus();
    expect(choices()[0]).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('restarts mid-quiz, discarding progress', async () => {
    const user = userEvent.setup();
    renderQuiz();

    await user.click(correctChoice());
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    await user.click(correctChoice());
    await user.click(screen.getByRole('button', { name: 'Restart' }));

    expect(progressText()).toBe('Question 1 of 4');
    expect(scoreText()).toBe('Score: 0');
    expect(screen.queryByText('Correct!')).not.toBeInTheDocument();
  });

  it('ignores a click from the old quiz that lands after a restart', () => {
    renderQuiz();
    const oldChoice = correctChoice();
    const restart = screen.getByRole('button', { name: 'Restart' });

    act(() => {
      restart.click();
      // Still attached, with a handler bound to the previous session.
      oldChoice.click();
    });

    expect(progressText()).toBe('Question 1 of 4');
    expect(scoreText()).toBe('Score: 0');
    for (const button of choices()) expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('exits to the home page and stops listening for keys', async () => {
    const user = userEvent.setup();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    renderQuiz();

    await user.click(correctChoice());
    await user.click(screen.getByRole('link', { name: 'Exit quiz' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();

    const keydownHandlers = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === 'keydown').map(([, handler]) => handler);
    expect(keydownHandlers(add).length).toBeGreaterThan(0);
    expect(new Set(keydownHandlers(remove))).toEqual(new Set(keydownHandlers(add)));

    await user.keyboard('1{Enter}');
    expect(screen.getByRole('heading', { level: 1, name: 'Your flashcards' })).toBeInTheDocument();
  });

  it('starts a new quiz when the page is opened again', async () => {
    const user = userEvent.setup();
    renderQuiz();

    await user.click(correctChoice());
    await user.click(screen.getByRole('link', { name: 'Exit quiz' }));
    await user.click(screen.getByRole('link', { name: 'Quiz' }));

    expect(progressText()).toBe('Question 1 of 4');
    expect(scoreText()).toBe('Score: 0');
  });

  it('keeps HTML-like text as plain text', () => {
    renderQuiz([
      makeCard({ term: '<b>bold</b>', definition: '<img src=x onerror=alert(1)>' }),
      makeCard({ term: 'Plain', definition: 'Tom &amp; Jerry' }),
    ]);

    expect(['<b>bold</b>', 'Plain']).toContain(questionHeading().textContent);
    expect(document.querySelector('main img')).toBeNull();
    expect(document.querySelector('main b')).toBeNull();
  });
});
