import type { MouseEvent } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAppData } from './appData';
import { useUnsavedChanges } from './unsavedChanges';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
    isActive
      ? 'bg-indigo-100 text-indigo-900'
      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
  }`;

export default function Layout() {
  const { persistenceWarning } = useAppData();
  const { confirmLeave } = useUnsavedChanges();

  // Asks before navigating away from a form with unsaved changes.
  const guardNavigation = (event: MouseEvent) => {
    if (!confirmLeave()) event.preventDefault();
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-10 focus:rounded-lg focus:bg-white focus:px-3 focus:py-1.5 focus:outline-2 focus:outline-indigo-600"
      >
        Skip to content
      </a>
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <NavLink to="/" onClick={guardNavigation} className="text-xl font-bold tracking-tight">
            Snap <span className="text-indigo-700">Notes</span>
          </NavLink>
          <nav aria-label="Main">
            <ul className="flex gap-1">
              <li>
                <NavLink to="/" end onClick={guardNavigation} className={navLinkClass}>
                  Home
                </NavLink>
              </li>
              <li>
                <NavLink to="/list" onClick={guardNavigation} className={navLinkClass}>
                  Cards
                </NavLink>
              </li>
              <li>
                <NavLink to="/add" onClick={guardNavigation} className={navLinkClass}>
                  Add card
                </NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      {persistenceWarning && (
        <p
          role="alert"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900"
        >
          {persistenceWarning}
        </p>
      )}
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
