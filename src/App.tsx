import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { resolveStorage } from './storage/localStore';
import CloudProvider from './ui/account/CloudProvider';
import { cloudFromEnvironment, type CloudSetup } from './ui/account/cloudSetup';
import AppDataProvider from './ui/AppDataProvider';
import CardFormPage from './ui/CardFormPage';
import DeckPage from './ui/DeckPage';
import DecksPage from './ui/DecksPage';
import HomePage from './ui/HomePage';
import Layout from './ui/Layout';
import LearnPage from './ui/LearnPage';
import LegacyRouteRedirect from './ui/LegacyRouteRedirect';
import ListPage from './ui/ListPage';
import MatchPage from './ui/MatchPage';
import ProgressProvider from './ui/ProgressProvider';
import QuizPage from './ui/QuizPage';
import ReviewPage from './ui/ReviewPage';
import StatsPage from './ui/StatsPage';
import StudyPage from './ui/StudyPage';
import UnsavedChangesProvider from './ui/UnsavedChangesProvider';

// The account screens are not needed to study, so they are not in the main
// bundle. With accounts enabled they are fetched right after start-up (see
// `preloadAccountPages`), so they are in the browser's cache before the
// connection might drop. If one still cannot be loaded, the page says so
// instead of breaking the app.
const accountPages = {
  account: () => import('./ui/account/AccountPage'),
  link: () => import('./ui/account/LinkAccountPage'),
  auth: () => import('./ui/account/AuthPages'),
};

function preloadAccountPages() {
  for (const load of Object.values(accountPages)) void load().catch(() => {});
}

function PageNeedsConnection() {
  return (
    <p className="text-gray-700" role="alert">
      This page could not be loaded. Check your connection, then reload. Your cards are safe and
      studying works offline.
    </p>
  );
}

function lazyPage<T>(load: () => Promise<T>, pick: (module: T) => ComponentType) {
  return lazy(() =>
    load().then(
      (module): { default: ComponentType } => ({ default: pick(module) }),
      (): { default: ComponentType } => ({ default: PageNeedsConnection }),
    ),
  );
}

const AccountPage = lazyPage(accountPages.account, (m) => m.default);
const LinkAccountPage = lazyPage(accountPages.link, (m) => m.default);
const SignInPage = lazyPage(accountPages.auth, (m) => m.SignInPage);
const SignUpPage = lazyPage(accountPages.auth, (m) => m.SignUpPage);
const ForgotPasswordPage = lazyPage(accountPages.auth, (m) => m.ForgotPasswordPage);
const ResetPasswordPage = lazyPage(accountPages.auth, (m) => m.ResetPasswordPage);

function Loading({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <p className="text-gray-600" role="status">
          Loading…
        </p>
      }
    >
      {children}
    </Suspense>
  );
}

interface AppProps {
  /** Defaults to the browser's localStorage. Tests pass an in-memory fake. */
  storage?: Storage | null;
  /** Accounts and sync. Defaults to the build's settings; without any, the app is local-only. */
  cloud?: CloudSetup;
}

export default function App({ storage, cloud }: AppProps = {}) {
  const [setup] = useState(() => cloud ?? cloudFromEnvironment(resolveStorage(storage)));
  const accountsEnabled = setup.services !== null;
  useEffect(() => {
    if (accountsEnabled) preloadAccountPages();
  }, [accountsEnabled]);
  return (
    <AppDataProvider storage={storage}>
      <ProgressProvider storage={storage}>
        <CloudProvider cloud={setup} storage={storage}>
          <UnsavedChangesProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<HomePage />} />
                <Route path="list" element={<ListPage />} />
                <Route path="decks" element={<DecksPage />} />
                <Route path="decks/:deckId" element={<DeckPage />} />
                <Route path="review" element={<ReviewPage />} />
                <Route path="stats" element={<StatsPage />} />
                <Route path="study" element={<StudyPage />} />
                <Route path="quiz" element={<QuizPage />} />
                <Route path="learn" element={<LearnPage />} />
                <Route path="match" element={<MatchPage />} />
                <Route path="add" element={<CardFormPage mode="add" />} />
                <Route path="edit/:cardId" element={<CardFormPage mode="edit" />} />
                <Route
                  path="account"
                  element={
                    <Loading>
                      <AccountPage />
                    </Loading>
                  }
                />
                <Route
                  path="account/sign-in"
                  element={
                    <Loading>
                      <SignInPage />
                    </Loading>
                  }
                />
                <Route
                  path="account/sign-up"
                  element={
                    <Loading>
                      <SignUpPage />
                    </Loading>
                  }
                />
                <Route
                  path="account/forgot-password"
                  element={
                    <Loading>
                      <ForgotPasswordPage />
                    </Loading>
                  }
                />
                <Route
                  path="account/reset-password"
                  element={
                    <Loading>
                      <ResetPasswordPage />
                    </Loading>
                  }
                />
                <Route
                  path="account/link"
                  element={
                    <Loading>
                      <LinkAccountPage />
                    </Loading>
                  }
                />
                <Route path="*" element={<LegacyRouteRedirect />} />
              </Route>
            </Routes>
          </UnsavedChangesProvider>
        </CloudProvider>
      </ProgressProvider>
    </AppDataProvider>
  );
}
