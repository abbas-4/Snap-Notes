import { describe, expect, it } from 'vitest';
import type { QuizQuestion } from './quiz';
import {
  quizPhase,
  quizReducer,
  quizResults,
  quizScore,
  startQuiz,
  type QuizAction,
  type QuizState,
} from './quizSession';

/** A question whose correct answer is always the choice at `correct`. */
function question(cardId: string, correct = 0): QuizQuestion {
  return {
    cardId,
    prompt: `term ${cardId}`,
    choices: [0, 1, 2].map((i) => ({ text: `${cardId}-${i}`, isCorrect: i === correct })),
  };
}

const questions = [question('a', 0), question('b', 1), question('c', 2)];

function run(state: QuizState, ...actions: QuizAction[]): QuizState {
  return actions.reduce(quizReducer, state);
}

function answer(state: QuizState, choiceIndex: number, questionIndex = state.index): QuizAction {
  return { type: 'answer', sessionId: state.sessionId, questionIndex, choiceIndex };
}

function next(state: QuizState, questionIndex = state.index): QuizAction {
  return { type: 'next', sessionId: state.sessionId, questionIndex };
}

describe('quizReducer', () => {
  it('starts on the first question, waiting for an answer, with no score', () => {
    const state = startQuiz(questions);

    expect(state.index).toBe(0);
    expect(quizPhase(state)).toBe('answering');
    expect(quizScore(state)).toBe(0);
  });

  it('records an answer and shows feedback without moving on', () => {
    const start = startQuiz(questions);
    const state = run(start, answer(start, 0));

    expect(quizPhase(state)).toBe('feedback');
    expect(state.index).toBe(0);
    expect(state.answers).toEqual([0]);
    expect(quizScore(state)).toBe(1);
  });

  it('counts only correct answers', () => {
    let state = startQuiz(questions);
    state = run(state, answer(state, 0)); // correct
    state = run(state, next(state));
    state = run(state, answer(state, 0)); // wrong: b's answer is 1
    state = run(state, next(state));
    state = run(state, answer(state, 2)); // correct

    expect(quizScore(state)).toBe(2);
    expect(quizResults(state).map((r) => r.isCorrect)).toEqual([true, false, true]);
  });

  it('accepts only the first of several answers to the same question', () => {
    const start = startQuiz(questions);
    // Three clicks queued from the same render all name question 0.
    const state = run(start, answer(start, 1), answer(start, 0), answer(start, 0));

    expect(state.answers).toEqual([1]);
    expect(quizScore(state)).toBe(0);
    expect(state.index).toBe(0);
  });

  it('does not move on before the question is answered', () => {
    const start = startQuiz(questions);

    expect(run(start, next(start))).toBe(start);
  });

  it('advances exactly one question however many times "next" is sent', () => {
    let state = startQuiz(questions);
    state = run(state, answer(state, 0));
    const answered = state;
    state = run(state, next(answered), next(answered), next(answered));

    expect(state.index).toBe(1);
    expect(quizPhase(state)).toBe('answering');
  });

  it('ignores an answer aimed at an earlier question', () => {
    let state = startQuiz(questions);
    state = run(state, answer(state, 0), next(state));

    const late = run(state, answer(state, 1, 0));
    expect(late).toBe(state);
  });

  it('ignores choices that do not exist', () => {
    const start = startQuiz(questions);

    expect(run(start, answer(start, 3))).toBe(start);
    expect(run(start, answer(start, -1))).toBe(start);
    expect(run(start, answer(start, 0.5))).toBe(start);
  });

  it('finishes after the last question and then ignores everything but restart', () => {
    let state = startQuiz(questions);
    for (let i = 0; i < questions.length; i++) {
      state = run(state, answer(state, i), next(state));
    }

    expect(quizPhase(state)).toBe('finished');
    expect(quizScore(state)).toBe(3);
    expect(run(state, answer(state, 0))).toBe(state);
    expect(run(state, next(state))).toBe(state);
    expect(run(state, answer(state, 0, 2), next(state, 2))).toBe(state);
  });

  it('restarts with a new session that ignores actions from the old one', () => {
    let old = startQuiz(questions);
    old = run(old, answer(old, 0));
    const restarted = run(old, { type: 'restart', questions: [question('x'), question('y')] });

    expect(restarted.sessionId).not.toBe(old.sessionId);
    expect(restarted).toMatchObject({ index: 0, answers: [] });
    expect(quizScore(restarted)).toBe(0);
    expect(restarted.questions.map((q) => q.cardId)).toEqual(['x', 'y']);

    // Both of these were valid for the old session at the same position.
    expect(run(restarted, answer(old, 0, 0))).toBe(restarted);
    expect(run(restarted, next(old, 0))).toBe(restarted);
  });

  it('treats a quiz with no questions as already finished', () => {
    const state = startQuiz([]);

    expect(quizPhase(state)).toBe('finished');
    expect(run(state, answer(state, 0))).toBe(state);
  });
});
