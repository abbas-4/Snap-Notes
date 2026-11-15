import { useId, useState, type FormEvent } from 'react';
import type { GoalProgress } from '../../domain/analytics';
import {
  GOAL_DEFINITIONS,
  GOAL_KINDS,
  parseGoalTarget,
  type GoalKind,
  type StudyGoal,
} from '../../domain/studyGoals';
import type { WriteResult } from '../appData';
import ProgressBar from '../ProgressBar';
import { dangerButton, primaryButton, secondaryButton, textField } from '../styles';
import { pct, shortDate } from './format';
import Section, { panel } from './Section';

function GoalHistory({ progress }: { progress: GoalProgress }) {
  const daily = GOAL_DEFINITIONS[progress.kind].period === 'day';
  const judged = progress.history.filter((p) => p.met !== null && !p.current);
  const met = judged.filter((p) => p.met).length;
  return (
    <div className="mt-3">
      <p className="text-xs text-gray-600">
        {judged.length === 0
          ? `History appears after the first ${daily ? 'day' : 'week'} with this goal.`
          : `Met ${met} of the last ${judged.length} ${daily ? (judged.length === 1 ? 'day' : 'days') : judged.length === 1 ? 'week' : 'weeks'} with this goal.`}
      </p>
      <ol className="mt-1.5 flex flex-wrap gap-1">
        {progress.history.map((period) => {
          const label = daily ? shortDate(period.start) : `Week of ${shortDate(period.start)}`;
          const state =
            period.met === null
              ? 'no goal'
              : period.met
                ? 'met'
                : period.current
                  ? 'in progress'
                  : 'not met';
          const className =
            period.met === null
              ? 'border border-dashed border-gray-300 bg-white'
              : period.met
                ? 'bg-green-600'
                : period.current
                  ? 'bg-indigo-200'
                  : 'bg-gray-200';
          return (
            <li
              key={period.start}
              className={`h-4 w-4 rounded ${className}`}
              title={`${label}: ${period.value}${period.target !== null ? ` of ${period.target}` : ''} (${state})`}
            >
              <span className="sr-only">
                {label}: {period.value}
                {period.target !== null ? ` of ${period.target}` : ''}, {state}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function GoalCard({
  kind,
  goal,
  progress,
  onSave,
}: {
  kind: GoalKind;
  goal: StudyGoal | undefined;
  progress: GoalProgress | undefined;
  onSave(kind: GoalKind, target: number | null): WriteResult;
}) {
  const definition = GOAL_DEFINITIONS[kind];
  const active = goal?.target ?? null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  function start() {
    setText(String(active ?? definition.suggested));
    setError(null);
    setStatus(null);
    setEditing(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseGoalTarget(kind, text);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    const saved = onSave(kind, parsed.target);
    if (!saved.ok) {
      setError(`The goal could not be saved: ${saved.message}`);
      return;
    }
    setEditing(false);
    setStatus('Goal saved.');
  }

  function turnOff() {
    const saved = onSave(kind, null);
    if (!saved.ok) {
      setError(`The goal could not be saved: ${saved.message}`);
      return;
    }
    setEditing(false);
    setStatus('Goal turned off. Its history is kept.');
  }

  const when = definition.period === 'day' ? 'today' : 'this week';

  return (
    <li className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{definition.label}</h3>
          <p className="text-sm text-gray-600">
            {active === null
              ? 'Not set'
              : `${active} ${definition.unit(active)} a ${definition.period}`}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            className={secondaryButton}
            onClick={start}
            aria-label={`${active === null ? 'Set goal' : 'Edit goal'}: ${definition.label}`}
          >
            {active === null ? 'Set goal' : 'Edit'}
          </button>
        )}
      </div>

      {editing && (
        <form className="mt-3 space-y-2" onSubmit={submit} noValidate>
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
            Target ({definition.unit(2)} per {definition.period}, {definition.min}–{definition.max})
          </label>
          <input
            id={inputId}
            className={`${textField} max-w-40`}
            inputMode="numeric"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <p id={errorId} className="text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButton}>
              Save goal
            </button>
            <button type="button" className={secondaryButton} onClick={() => setEditing(false)}>
              Cancel
            </button>
            {active !== null && (
              <button type="button" className={dangerButton} onClick={turnOff}>
                Turn off
              </button>
            )}
          </div>
        </form>
      )}

      <div aria-live="polite">
        {status && <p className="mt-2 text-sm text-green-800">{status}</p>}
      </div>

      {progress && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <p>
              <strong className="tabular-nums">{progress.value}</strong> of {progress.target}{' '}
              {definition.unit(progress.target)} {when}
            </p>
            <p className={progress.met ? 'font-semibold text-green-800' : 'text-gray-600'}>
              {progress.met ? 'Goal met' : `${pct(Math.min(1, progress.fraction))}`}
            </p>
          </div>
          <div className="mt-1.5">
            <ProgressBar
              value={Math.min(progress.value, progress.target)}
              max={progress.target}
              label={`${definition.label}: ${progress.value} of ${progress.target} ${when}`}
            />
          </div>
          <GoalHistory progress={progress} />
        </div>
      )}
      {kind === 'minutes-per-day' && (
        <p className="mt-3 text-xs text-gray-500">
          Study time is active time in recorded sessions; pauses count for at most two minutes.
        </p>
      )}
    </li>
  );
}

export default function GoalsSection({
  goals,
  progress,
  onSave,
  synced,
}: {
  goals: readonly StudyGoal[];
  progress: GoalProgress[];
  onSave(kind: GoalKind, target: number | null): WriteResult;
  /** Signed in: goals follow the account to other devices. */
  synced: boolean;
}) {
  return (
    <Section
      id="goals"
      title="Study goals"
      description={
        synced
          ? 'Targets you set yourself. They sync with your account to your other devices.'
          : 'Targets you set yourself, saved in this browser.'
      }
    >
      <ul className="grid gap-3 md:grid-cols-2">
        {GOAL_KINDS.map((kind) => (
          <GoalCard
            key={kind}
            kind={kind}
            goal={goals.find((goal) => goal.id === kind)}
            progress={progress.find((p) => p.kind === kind)}
            onSave={onSave}
          />
        ))}
      </ul>
    </Section>
  );
}
