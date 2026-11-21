/**
 * The Content Security Policy for production builds. GitHub Pages cannot send
 * response headers, so it is delivered as a <meta> tag, which browsers honour
 * for everything below except `frame-ancestors`, `report-uri` and `sandbox`
 * (framing is handled in src/main.tsx instead). The app loads only its own
 * files and talks only to its own Supabase project, so anything else, such as
 * an injected script or a request to an attacker's server, is refused.
 *
 * Added to the built index.html by vite.config.ts; not by `vite dev`, whose
 * hot reloading needs inline scripts and a WebSocket.
 */
export function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  let supabase = '';
  try {
    if (supabaseUrl?.trim()) supabase = ` ${new URL(supabaseUrl.trim()).origin}`;
  } catch {
    // An invalid URL is reported by the app itself (src/cloud/config.ts); nothing is allowed.
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${supabase}`,
    // PDF.js reads PDFs in a worker served from this site.
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
  ].join('; ');
}
