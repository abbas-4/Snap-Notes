import { Route, Routes } from 'react-router';

const LIVE_APP_URL = 'https://abbas-4.github.io/Snap-Notes/';

/**
 * Placeholder shell for the rebuild. It deliberately does not read or write
 * localStorage: migrating real flashcards starts at cutover (Milestone 5).
 */
function RebuildNotice() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-3xl font-bold">
        Snap <span className="text-indigo-700">Notes</span>
      </h1>
      <p className="mt-4 text-gray-700">
        This is the in-progress rebuild with React and TypeScript. It is not deployed yet.
      </p>
      <p className="mt-2 text-gray-700">
        The current app is still live at{' '}
        <a className="text-indigo-700 underline" href={LIVE_APP_URL}>
          {LIVE_APP_URL}
        </a>
        .
      </p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<RebuildNotice />} />
    </Routes>
  );
}
