// The `generate-flashcards` Edge Function: turns a signed-in user's study material into
// flashcards for them to review. All the logic is in ../_shared/flashcards (tested with the
// app's own test suite); this file only reads the environment and starts the server.
// Setup and secrets: docs/ai-generation.md.
import { allowedOriginsFromEnv, providerFromEnv } from '../_shared/flashcards/config.ts';
import { createHandler } from '../_shared/flashcards/handler.ts';
import { createSupabaseAccess } from '../_shared/flashcards/supabaseAccess.ts';

const env = (name: string) => Deno.env.get(name);

const url = env('SUPABASE_URL');
const publishableKey = env('SUPABASE_ANON_KEY') ?? env('SUPABASE_PUBLISHABLE_KEY');
if (!url || !publishableKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase and must be set.');
}

const setup = providerFromEnv(env);
if (!setup.ok) console.error(`AI generation is off: ${setup.message}`);

const access = createSupabaseAccess({ url, publishableKey });

Deno.serve(
  createHandler({
    authenticate: access.authenticate,
    reserve: access.reserve,
    provider: setup.ok ? setup.provider : null,
    allowedOrigins: allowedOriginsFromEnv(env),
    // Events carry outcomes, counts and timings only, never study material or cards.
    log: (event) => console.log(JSON.stringify(event)),
  }),
);
