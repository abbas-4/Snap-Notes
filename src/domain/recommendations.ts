import type { DeckPerformance, GoalProgress, StreakSummary, WeakCard } from './analytics';
import type { ProgressCounts } from './progressStats';
import { daysBetween } from './srs';
import { GOAL_DEFINITIONS } from './studyGoals';
import type { Timestamp } from './types';

/**
 * What to study next, chosen by fixed rules from the user's own analytics.
 *
 * Every recommendation names the figures behind it, so the user can see why
 * it was made. The same data always gives the same recommendations, in the
 * same order. No outside service is asked anything.
 */

/** Below this many recorded answers, there is too little history to recommend from. */
export const MIN_HISTORY_ANSWERS = 10;

/** A deck not studied for this many days is worth revisiting. */
export const NEGLECTED_DAYS = 7;

/** A study gap of this many days or more breaks the habit worth mentioning. */
export const MISSED_DAYS = 2;

export const MAX_RECOMMENDATIONS = 4;

export type RecommendationKind =
  | 'overdue'
  | 'due'
  | 'weak-cards'
  | 'declining-deck'
  | 'neglected-deck'
  | 'get-back'
  | 'keep-streak'
  | 'goal'
  | 'new-cards';

export interface Recommendation {
  /** Stable, for React keys and tests. */
  id: string;
  kind: RecommendationKind;
  /** Lower comes first. */
  priority: number;
  title: string;
  /** Why it is recommended, with the figures behind it. */
  reason: string;
  /** What to do, as the button says it. */
  action: string;
  /** Where the button goes (a route inside the app). */
  href: string;
}

export interface RecommendationInput {
  now: Timestamp;
  /** The whole collection's card counts (due, overdue, new…). */
  counts: ProgressCounts;
  streaks: StreakSummary;
  decks: readonly DeckPerformance[];
  weakCards: readonly WeakCard[];
  goals: readonly GoalProgress[];
  /** Answers recorded, ever. */
  totalAnswered: number;
}

export type RecommendationResult =
  /** Not enough history to recommend from; the page shows how to get started instead. */
  | { kind: 'getting-started'; hasCards: boolean; answered: number }
  | { kind: 'recommendations'; items: Recommendation[] };

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function pct(value: number | null): string {
  return value === null ? '0%' : `${Math.round(value * 100)}%`;
}

function deckParam(id: string): string {
  return encodeURIComponent(id);
}

function quote(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 40 ? `“${trimmed.slice(0, 39)}…”` : `“${trimmed}”`;
}

export function recommend(input: RecommendationInput): RecommendationResult {
  const { counts, streaks, now } = input;
  if (input.totalAnswered < MIN_HISTORY_ANSWERS) {
    return {
      kind: 'getting-started',
      hasCards: counts.reviewable > 0,
      answered: input.totalAnswered,
    };
  }

  const items: Recommendation[] = [];
  const studyNowHref = counts.due > 0 ? '/review?mode=due' : '/learn';

  // Cards the schedule says are slipping.
  if (counts.overdue > 0) {
    items.push({
      id: 'overdue',
      kind: 'overdue',
      priority: 10,
      title: 'Catch up on overdue reviews',
      reason: `${plural(counts.overdue, 'card')} ${counts.overdue === 1 ? 'has' : 'have'} been due since an earlier day. Reviewing ${counts.overdue === 1 ? 'it' : 'them'} now stops ${counts.overdue === 1 ? 'it' : 'them'} slipping further.`,
      action: 'Review due cards',
      href: '/review?mode=due',
    });
  } else if (counts.due > 0) {
    items.push({
      id: 'due',
      kind: 'due',
      priority: 20,
      title: 'Review today’s due cards',
      reason: `${plural(counts.due, 'card')} ${counts.due === 1 ? 'is' : 'are'} due for review today, at the point you are most likely to start forgetting ${counts.due === 1 ? 'it' : 'them'}.`,
      action: 'Review due cards',
      href: '/review?mode=due',
    });
  }

  // Habit.
  if (streaks.lastActiveAt !== null) {
    const gap = daysBetween(streaks.lastActiveAt, now);
    if (streaks.current === 0 && gap >= MISSED_DAYS) {
      items.push({
        id: 'get-back',
        kind: 'get-back',
        priority: 12,
        title: 'Get back into a rhythm',
        reason: `You last studied ${plural(gap, 'day')} ago. A short session today starts a new streak.`,
        action: 'Start a short session',
        href: studyNowHref,
      });
    } else if (streaks.current >= 2 && !streaks.studiedToday) {
      items.push({
        id: 'keep-streak',
        kind: 'keep-streak',
        priority: 18,
        title: `Keep your ${streaks.current}-day streak going`,
        reason: `You have studied ${streaks.current} days in a row. Study today to make it ${streaks.current + 1}.`,
        action: 'Study now',
        href: studyNowHref,
      });
    }
  }

  // Cards the user keeps missing.
  if (input.weakCards.length > 0) {
    const worst = input.weakCards[0] as WeakCard;
    const count = input.weakCards.length;
    items.push({
      id: 'weak-cards',
      kind: 'weak-cards',
      priority: count >= 5 ? 15 : 25,
      title: 'Practise your weak cards',
      reason: `${plural(count, 'card')} ${count === 1 ? 'is' : 'are'} often answered wrongly. ${quote(worst.card.term || worst.card.definition)} was right ${worst.correct} of ${plural(worst.attempts, 'time')}.`,
      action: 'Practise weak cards',
      href: '/learn?focus=weak',
    });
  }

  // A deck getting worse.
  const declining = input.decks
    .filter((deck) => deck.trend.direction === 'declining' && deck.trend.change !== null)
    .sort((a, b) => (a.trend.change as number) - (b.trend.change as number))[0];
  if (declining) {
    items.push({
      id: `declining-${declining.deck.id}`,
      kind: 'declining-deck',
      priority: 30,
      title: `Revisit ${declining.deck.name}`,
      reason: `Your accuracy in this deck fell from ${pct(declining.trend.earlier)} to ${pct(declining.trend.later)} over the last two weeks.`,
      action: `Practise ${declining.deck.name}`,
      href: `/learn?deck=${deckParam(declining.deck.id)}`,
    });
  }

  // A deck left alone.
  const neglected = input.decks
    .filter(
      (deck) =>
        deck !== declining &&
        deck.counts.reviewable > 0 &&
        deck.lastStudiedAt !== null &&
        daysBetween(deck.lastStudiedAt, now) >= NEGLECTED_DAYS,
    )
    .sort(
      (a, b) =>
        b.counts.due - a.counts.due ||
        (a.lastStudiedAt as number) - (b.lastStudiedAt as number) ||
        (a.deck.id < b.deck.id ? -1 : 1),
    )[0];
  if (neglected) {
    const days = daysBetween(neglected.lastStudiedAt as number, now);
    const due = neglected.counts.due;
    items.push({
      id: `neglected-${neglected.deck.id}`,
      kind: 'neglected-deck',
      priority: 40,
      title: `Return to ${neglected.deck.name}`,
      reason:
        due > 0
          ? `You have not studied this deck for ${plural(days, 'day')}, and ${plural(due, 'card')} in it ${due === 1 ? 'is' : 'are'} due.`
          : `You have not studied this deck for ${plural(days, 'day')}. A quick pass keeps it fresh.`,
      action: due > 0 ? 'Review this deck' : 'Practise this deck',
      href:
        due > 0
          ? `/review?mode=due&deck=${deckParam(neglected.deck.id)}`
          : `/learn?deck=${deckParam(neglected.deck.id)}`,
    });
  }

  // Goals not yet met in the current day or week.
  for (const goal of input.goals) {
    if (goal.met) continue;
    const definition = GOAL_DEFINITIONS[goal.kind];
    const when = definition.period === 'day' ? 'today' : 'this week';
    if (goal.kind === 'days-per-week' && streaks.studiedToday) continue;
    items.push({
      id: `goal-${goal.kind}`,
      kind: 'goal',
      priority: 35,
      title: definition.period === 'day' ? 'Finish today’s goal' : 'Reach this week’s goal',
      reason: `${goal.value} of ${goal.target} ${definition.unit(goal.target)} ${when} (${definition.label.toLowerCase()}). ${plural(goal.remaining, definition.unit(1), definition.unit(2))} to go.`,
      action: 'Study now',
      href: studyNowHref,
    });
  }

  // Nothing waiting, but cards not yet started.
  if (counts.due === 0 && counts.newCards > 0) {
    items.push({
      id: 'new-cards',
      kind: 'new-cards',
      priority: 50,
      title: 'Start on new cards',
      reason: `Nothing is due, and ${plural(counts.newCards, 'card')} ${counts.newCards === 1 ? 'has' : 'have'} never been reviewed.`,
      action: 'Learn new cards',
      href: '/review?mode=new',
    });
  }

  items.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
  return { kind: 'recommendations', items: items.slice(0, MAX_RECOMMENDATIONS) };
}
