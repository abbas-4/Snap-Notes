import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createEmptyAppData } from '../../domain/appData';
import type { Card, Deck } from '../../domain/types';
import { resolveStorage } from '../../storage/localStore';
import { emptyProgress } from '../../storage/progressStore';
import {
  clearSyncState,
  loadSyncState,
  saveSyncState,
  SYNC_STORAGE_KEY,
} from '../../storage/syncStore';
import { pendingChanges } from '../../sync/changes';
import {
  linkAccount,
  pullAll,
  runSync,
  SyncError,
  type LocalStore,
  type SyncContext as EngineContext,
} from '../../sync/engine';
import { cloudSummary, isLocalEmpty, type LinkChoice, type LinkReport } from '../../sync/link';
import { recordsFromSnapshot } from '../../sync/records';
import type { SyncState } from '../../sync/state';
import { useAppData, type WriteResult } from '../appData';
import { useProgress } from '../progress';
import { SyncContext, useAuth, type LinkState, type SyncStatus, type SyncValue } from './cloud';

/** Wait this long after a change before uploading, so a burst of edits goes up together. */
const CHANGE_DELAY_MS = 2_000;
/** Look for changes from other devices this often while the page is visible. */
const POLL_INTERVAL_MS = 60_000;
/** Waits between automatic retries after a failure that may clear up on its own. */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

function describe(caught: unknown): { kind: SyncError['kind'] | 'unknown'; message: string } {
  if (caught instanceof SyncError) return { kind: caught.kind, message: caught.message };
  return {
    kind: 'unknown',
    message: 'Sync stopped because of an unexpected problem. Your data on this browser is safe.',
  };
}

interface SyncProviderProps {
  /** Defaults to the browser's localStorage. Tests pass an in-memory fake. */
  storage?: Storage | null;
  children: ReactNode;
}

/**
 * Keeps this browser's data in step with the signed-in account.
 *
 * Studying never waits for it: every change is saved locally first, exactly
 * as without an account, and uploaded a moment later. Offline, changes simply
 * wait; they are worked out from what the server last confirmed, so they
 * survive a refresh and go up as soon as the connection is back. A failed
 * request never removes anything from this browser.
 */
export default function SyncProvider({ storage, children }: SyncProviderProps) {
  const auth = useAuth();
  const { data, getData, replaceData, updateCard, renameDeck, deleteCard } = useAppData();
  const { snapshot, getProgress, replaceProgress } = useProgress();
  const [resolved] = useState(() => resolveStorage(storage));

  const [syncState, setSyncState] = useState<SyncState | null>(() => {
    const loaded = loadSyncState(resolved);
    return loaded.ok ? loaded.state : null;
  });
  const stateRef = useRef(syncState);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<SyncValue['error']>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  // Which account a link check belongs to, so a sign-out leaves nothing behind.
  const [linkState, setLinkState] = useState<{ userId: string; state: LinkState } | null>(null);
  const [linkReport, setLinkReport] = useState<LinkReport | null>(null);
  const [checkAgain, setCheckAgain] = useState(0);

  const { services, user } = auth;
  const signedIn = auth.status === 'signed-in' && user !== null && services !== null;
  const linked = signedIn && syncState?.userId === user.id;
  const link = useMemo<LinkState>(
    () => (signedIn && linkState?.userId === user.id ? linkState.state : { kind: 'idle' }),
    [linkState, signedIn, user],
  );
  const setLink = useCallback(
    (state: LinkState) => {
      if (user) setLinkState({ userId: user.id, state });
    },
    [user],
  );

  const persistState = useCallback(
    (next: SyncState | null): boolean => {
      stateRef.current = next;
      setSyncState(next);
      // Without browser storage, sync still works for as long as the page is open.
      if (resolved === null) return true;
      return next === null ? clearSyncState(resolved) : saveSyncState(resolved, next);
    },
    [resolved],
  );

  const local = useMemo<LocalStore>(
    () => ({
      read: () => ({ data: getData(), progress: getProgress() }),
      write: (next) => {
        const cards = replaceData(next.data);
        if (!cards.ok) return cards;
        const progress = replaceProgress(next.progress);
        return progress.ok ? { ok: true } : progress;
      },
    }),
    [getData, getProgress, replaceData, replaceProgress],
  );

  const engine = useCallback(
    (): EngineContext | null =>
      services ? { transport: services.transport, local, saveState: persistState } : null,
    [local, persistState, services],
  );

  // --- Running a sync -------------------------------------------------------

  const runningRef = useRef(false);
  const againRef = useRef(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback((delay: number) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void runRef.current(), delay);
  }, []);

  const run = useCallback(async () => {
    const context = engine();
    const userId = user?.id;
    if (!context || !userId || stateRef.current?.userId !== userId) return;
    if (runningRef.current) {
      againRef.current = true;
      return;
    }
    runningRef.current = true;
    setRunning(true);
    clearTimeout(timerRef.current);
    try {
      const job = async () => {
        // Another tab may have synced since: start from what is saved.
        const saved = loadSyncState(resolved);
        const start = saved.ok && saved.state?.userId === userId ? saved.state : stateRef.current;
        if (!start || start.userId !== userId) return;
        await runSync(context, start);
      };
      // One tab syncs at a time; the others wait their turn.
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      if (locks) await locks.request('snapnotes.sync', job);
      else await job();
      attemptRef.current = 0;
      setError(null);
      setRetryAt(null);
    } catch (caught) {
      const problem = describe(caught);
      setError({ ...problem, at: Date.now() });
      const attempt = attemptRef.current;
      attemptRef.current += 1;
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] as number;
      if (problem.kind === 'auth') {
        // Renew the session and try again; if it cannot be renewed, the user
        // must sign in again. A session renewed but still refused is not
        // retried forever.
        if ((await auth.reportSessionProblem()) && attempt < 2) schedule(1_000);
      } else if (caught instanceof SyncError && caught.retryable) {
        setRetryAt(Date.now() + delay);
        schedule(delay);
      } else if (!(caught instanceof SyncError)) {
        // Never log the data itself.
        console.error('Snap Notes sync failed:', caught instanceof Error ? caught.name : caught);
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      if (againRef.current) {
        againRef.current = false;
        schedule(250);
      }
    }
  }, [auth, engine, resolved, schedule, user?.id]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // --- Joining this browser to the account ----------------------------------

  const doLink = useCallback(
    async (choice: LinkChoice): Promise<WriteResult> => {
      const context = engine();
      if (!context || !user) return { ok: false, message: 'Sign in first.' };
      setLink({ kind: 'linking' });
      try {
        const result = await linkAccount(context, { userId: user.id, email: user.email }, choice);
        setLinkReport(result.report);
        setLink({ kind: 'idle' });
        setError(null);
        attemptRef.current = 0;
        setRetryAt(null);
        void runRef.current();
        return { ok: true };
      } catch (caught) {
        const { kind, message } = describe(caught);
        setLink({ kind: 'error', message });
        if (kind === 'auth') void auth.reportSessionProblem();
        return { ok: false, message };
      }
    },
    [auth, engine, setLink, user],
  );

  const checkKey = signedIn && !linked && online ? `${user.id}:${checkAgain}` : null;
  useEffect(() => {
    if (checkKey === null) return;
    const context = engine();
    const account = user;
    if (!context || !account) return;
    let active = true;
    const check = async () => {
      setLink({ kind: 'checking' });
      try {
        const pulled = await pullAll(context.transport, 0);
        if (!active) return;
        const here = context.local.read();
        const previous =
          stateRef.current && stateRef.current.userId !== account.id ? stateRef.current : null;
        const previousPending = previous
          ? pendingChanges(recordsFromSnapshot(here), previous.base, previous.rejected).length
          : 0;
        const cloud = cloudSummary(pulled.records);
        const cloudEmpty = cloud.cards === 0 && cloud.decks === 0;
        if (isLocalEmpty(here) && previousPending === 0) {
          // Nothing here to lose: take the account's data.
          await doLink('use-account');
        } else if (cloudEmpty && !previous) {
          // A new account and this browser's own data: upload it.
          await doLink('merge');
        } else {
          setLink({
            kind: 'needed',
            local: { decks: here.data.decks.length, cards: here.data.cards.length },
            cloud,
            previousAccount: previous ? (previous.email ?? 'another account') : null,
            previousPending,
          });
        }
      } catch (caught) {
        if (!active) return;
        const problem = describe(caught);
        setLink({ kind: 'error', message: problem.message });
        // A dropped connection or a busy server: look again shortly.
        if (caught instanceof SyncError && caught.retryable) {
          const attempt = attemptRef.current;
          attemptRef.current += 1;
          const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] as number;
          setRetryAt(Date.now() + delay);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCheckAgain((n) => n + 1), delay);
        }
        // A refused session is renewed and the check repeated, or the user is
        // asked to sign in again; either way it is not a sync error.
        if (problem.kind === 'auth') {
          void auth.reportSessionProblem().then((renewed) => {
            if (renewed && active) setCheckAgain((n) => n + 1);
          });
        }
      }
    };
    void check();
    return () => {
      active = false;
    };
    // `checkKey` captures every input that should start a new check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  // Signed out: stop retrying. The link itself is kept, so signing back in to
  // the same account carries on where it left off.
  useEffect(() => {
    if (signedIn) return;
    clearTimeout(timerRef.current);
    attemptRef.current = 0;
  }, [signedIn]);

  // --- When to sync ---------------------------------------------------------

  const pending = useMemo(() => {
    if (!syncState) return 0;
    return pendingChanges(
      recordsFromSnapshot({ data, progress: snapshot }),
      syncState.base,
      syncState.rejected,
    ).length;
  }, [data, snapshot, syncState]);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // As soon as this browser is linked and online.
  useEffect(() => {
    if (linked && online) void runRef.current();
  }, [linked, online]);

  // Shortly after each change made here.
  useEffect(() => {
    if (!linked || !online) return;
    const timer = setTimeout(() => {
      if (pendingRef.current > 0) void runRef.current();
    }, CHANGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [linked, online, data, snapshot]);

  // Regularly, and on returning to the page, to pick up changes from other devices.
  useEffect(() => {
    if (!linked || !online) return;
    const poll = () => {
      if (document.visibilityState === 'visible') void runRef.current();
    };
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [linked, online]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // Another tab synced or linked: take its sync state.
  useEffect(() => {
    if (resolved === null) return;
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== resolved || event.key !== SYNC_STORAGE_KEY) return;
      const loaded = loadSyncState(resolved);
      if (loaded.ok) {
        stateRef.current = loaded.state;
        setSyncState(loaded.state);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [resolved]);

  // --- Actions --------------------------------------------------------------

  const syncNow = useCallback(() => {
    attemptRef.current = 0;
    setRetryAt(null);
    if (!linked) {
      setCheckAgain((n) => n + 1);
      return;
    }
    void runRef.current();
  }, [linked]);

  const dismissConflict = useCallback(
    (id: string) => {
      const current = stateRef.current;
      if (!current) return;
      persistState({ ...current, conflicts: current.conflicts.filter((c) => c.id !== id) });
    },
    [persistState],
  );

  const restoreConflict = useCallback(
    (id: string): WriteResult => {
      const conflict = stateRef.current?.conflicts.find((c) => c.id === id);
      if (!conflict) return { ok: false, message: 'That conflict has already been dealt with.' };
      let result: WriteResult;
      if (conflict.other === null) {
        // Kept because it was edited elsewhere: "the other version" is deleting it.
        result =
          conflict.kind === 'card'
            ? deleteCard(conflict.recordId)
            : { ok: false, message: 'Delete the deck from its own page.' };
      } else if (conflict.kind === 'card') {
        const other = conflict.other as Card;
        const decks = getData().decks;
        result = updateCard(conflict.recordId, {
          term: other.term,
          definition: other.definition,
          deckId: decks.some((d) => d.id === other.deckId) ? other.deckId : undefined,
        });
      } else {
        result = renameDeck(conflict.recordId, (conflict.other as Deck).name);
      }
      if (result.ok) dismissConflict(id);
      return result;
    },
    [deleteCard, dismissConflict, getData, renameDeck, updateCard],
  );

  const forgetThisBrowser = useCallback((): WriteResult => {
    const cards = replaceData(createEmptyAppData(Date.now()));
    if (!cards.ok) return cards;
    const progress = replaceProgress(emptyProgress());
    if (!progress.ok) return progress;
    persistState(null);
    setLinkReport(null);
    return { ok: true };
  }, [persistState, replaceData, replaceProgress]);

  const unlink = useCallback(() => {
    persistState(null);
    setLinkReport(null);
  }, [persistState]);

  const dismissLinkReport = useCallback(() => setLinkReport(null), []);

  // --- What to show ---------------------------------------------------------

  let status: SyncStatus;
  if (auth.status === 'disabled') status = 'disabled';
  else if (auth.status === 'loading') status = 'checking';
  else if (auth.status === 'signed-out') {
    status = auth.sessionExpired ? 'session-expired' : 'signed-out';
  } else if (!linked) {
    if (link.kind === 'needed') status = 'needs-link';
    else if (link.kind === 'linking') status = 'linking';
    else if (link.kind === 'error') status = 'error';
    else status = online ? 'checking' : 'offline';
  } else if (!online) status = 'offline';
  else if (running) status = 'syncing';
  else if (error) status = 'error';
  else if (pending > 0) status = 'pending';
  else status = 'synced';

  const value = useMemo<SyncValue>(
    () => ({
      status,
      online,
      pending,
      lastSyncedAt: syncState?.lastSyncedAt ?? null,
      error: signedIn ? error : null,
      retryAt: signedIn ? retryAt : null,
      link,
      linkReport,
      conflicts: linked ? (syncState?.conflicts ?? []) : [],
      rejected: linked ? (syncState?.rejected ?? []) : [],
      syncNow,
      linkWith: doLink,
      dismissLinkReport,
      restoreConflict,
      dismissConflict,
      forgetThisBrowser,
      unlink,
    }),
    [
      status,
      online,
      pending,
      syncState,
      error,
      retryAt,
      link,
      linkReport,
      linked,
      signedIn,
      syncNow,
      doLink,
      dismissLinkReport,
      restoreConflict,
      dismissConflict,
      forgetThisBrowser,
      unlink,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
