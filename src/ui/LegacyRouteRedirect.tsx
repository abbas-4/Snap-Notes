import { Navigate, useLocation } from 'react-router';
import { legacyRedirectTarget } from './legacyRoutes';
import NotFoundPage from './NotFoundPage';

/**
 * Rendered by the catch-all route. Bookmarked URLs from the original app are
 * redirected, replacing the history entry so Back does not bounce through the
 * dead address; anything else really is not found.
 */
export default function LegacyRouteRedirect() {
  const { pathname } = useLocation();
  const target = legacyRedirectTarget(pathname);

  if (target === null) return <NotFoundPage />;
  return <Navigate to={target} replace />;
}
