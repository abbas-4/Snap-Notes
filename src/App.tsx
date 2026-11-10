import { Route, Routes } from 'react-router';
import AppDataProvider from './ui/AppDataProvider';
import CardFormPage from './ui/CardFormPage';
import HomePage from './ui/HomePage';
import Layout from './ui/Layout';
import LearnPage from './ui/LearnPage';
import LegacyRouteRedirect from './ui/LegacyRouteRedirect';
import ListPage from './ui/ListPage';
import MatchPage from './ui/MatchPage';
import QuizPage from './ui/QuizPage';
import StudyPage from './ui/StudyPage';
import UnsavedChangesProvider from './ui/UnsavedChangesProvider';

interface AppProps {
  /** Defaults to the browser's localStorage. Tests pass an in-memory fake. */
  storage?: Storage | null;
}

export default function App({ storage }: AppProps = {}) {
  return (
    <AppDataProvider storage={storage}>
      <UnsavedChangesProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="list" element={<ListPage />} />
            <Route path="study" element={<StudyPage />} />
            <Route path="quiz" element={<QuizPage />} />
            <Route path="learn" element={<LearnPage />} />
            <Route path="match" element={<MatchPage />} />
            <Route path="add" element={<CardFormPage mode="add" />} />
            <Route path="edit/:cardId" element={<CardFormPage mode="edit" />} />
            <Route path="*" element={<LegacyRouteRedirect />} />
          </Route>
        </Routes>
      </UnsavedChangesProvider>
    </AppDataProvider>
  );
}
