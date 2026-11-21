import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';

describe('contentSecurityPolicy', () => {
  it('allows only this site, and the Supabase project when there is one', () => {
    const policy = contentSecurityPolicy('https://abcdefghijklmnop.supabase.co/');
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("connect-src 'self' https://abcdefghijklmnop.supabase.co;");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it('allows no other server for a local-only build or a malformed URL', () => {
    expect(contentSecurityPolicy(undefined)).toContain("connect-src 'self';");
    expect(contentSecurityPolicy('')).toContain("connect-src 'self';");
    expect(contentSecurityPolicy('not a url; script-src *')).toContain("connect-src 'self';");
  });

  it('cannot be widened by a URL carrying extra directives', () => {
    const policy = contentSecurityPolicy("https://x.supabase.co/'; script-src * 'unsafe-inline");
    expect(policy).toContain("connect-src 'self' https://x.supabase.co;");
    expect(policy).not.toContain('unsafe-inline');
  });
});
