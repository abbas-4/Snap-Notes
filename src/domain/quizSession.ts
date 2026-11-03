import type { QuizQuestion } from './quiz';

/**
 * State for one run through a multiple-choice quiz.
 *
 * The quiz never advances on a timer. Answering shows feedback, and only an
 * explicit `next` moves on, so one answer can never skip a question. Every
 * action names the session and question it was taken on; anything aimed at an
 * earlier question or an earlier (restarted) session is ignored.
 *
 * The score is derived from the recorded answers rather than counted
 * separately, so it cannot drift from what was actually answered.
 */
export interface QuizState {
  /** Changes on every restart, so actions from an earlier run are ignored. */
  sessionId: number;
  questions: readonly QuizQuestion[];
  /** The question on screen; equal to `questions.length` once finished. */
  index: number;
  /** The index of the choice picked for each answered question, in order. */
  answers: readonly number[];
}

export type QuizAction =
  | { type: 'answer'; sessionId: number; questionIndex: number; choiceIndex: number }
  | { type: 'next'; sessionId: number; questionIndex: number }
  /** Starts a new run. Questions are built by the caller so the reducer stays pure. */
  | { type: 'restart'; questions: readonly QuizQuestion[] };

/** `answering`: waiting for a choice. `feedback`: answered, waiting for `next`. */
export type QuizPhase = 'answering' | 'feedback' | 'finished';

export interface QuizResult {
  question: QuizQuestion;
  choiceIndex: number;
  isCorrect: boolean;
}

export function startQuiz(questions: readonly QuizQuestion[], sessionId = 1): QuizState {
  return { sessionId, questions, index: 0, answers: [] };
}

export function quizPhase(state: QuizState): QuizPhase {
  if (state.index >= state.questions.length) return 'finished';
  return state.answers.length > state.index ? 'feedback' : 'answering';
}

export function quizResults(state: QuizState): QuizResult[] {
  return state.answers.flatMap((choiceIndex, i) => {
    const question = state.questions[i];
    if (!question) return [];
    return [
      { question, choiceIndex, isCorrect: question.choices[choiceIndex]?.isCorrect === true },
    ];
  });
}

export function quizScore(state: QuizState): number {
  return quizResults(state).filter((result) => result.isCorrect).length;
}

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'answer': {
      if (action.sessionId !== state.sessionId || action.questionIndex !== state.index) {
        return state;
      }
      if (quizPhase(state) !== 'answering') return state;
      const question = state.questions[state.index];
      const { choiceIndex } = action;
      if (!question || !Number.isInteger(choiceIndex) || !question.choices[choiceIndex]) {
        return state;
      }
      return { ...state, answers: [...state.answers, choiceIndex] };
    }
    case 'next':
      if (action.sessionId !== state.sessionId || action.questionIndex !== state.index) {
        return state;
      }
      if (quizPhase(state) !== 'feedback') return state;
      return { ...state, index: state.index + 1 };
    case 'restart':
      return startQuiz(action.questions, state.sessionId + 1);
  }
}
