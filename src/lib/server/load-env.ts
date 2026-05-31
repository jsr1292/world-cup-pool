/**
 * Auto-load a local `.env` for standalone CLI scripts (migrate / seed / seed-matches).
 *
 * Vite/SvelteKit load `.env` automatically for the running app, but the
 * one-shot `tsx` scripts do not — so without this they fail with
 * "DATABASE_URL is required" unless the caller exports the var manually.
 *
 * Behaviour:
 *   - If DATABASE_URL is already set in the environment, do nothing
 *     (production sets real env vars; we never override them).
 *   - Otherwise, if a `.env` file exists in the current working directory,
 *     load it via Node's built-in loader (Node >= 20.12 / 21.7). Zero deps.
 *
 * In production there is no `.env` (it is gitignored and never deployed),
 * so this is a no-op and the host's real environment variables are used.
 */
import { existsSync } from 'node:fs';

if (!process.env.DATABASE_URL && existsSync('.env')) {
	try {
		(process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.('.env');
	} catch {
		// Older Node without loadEnvFile, or unreadable file — fall back to
		// requiring the caller to export DATABASE_URL themselves.
	}
}
