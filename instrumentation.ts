/**
 * Runtime bootstrap: starts the in-process scheduler.
 *
 * Guards matter here. Without them the Docker image build would try to start a scheduler
 * during `next build`, and this project depends on the build being side-effect free (no
 * database, no network). `NEXT_PHASE` is set to `phase-production-build` for builds, and
 * `NEXT_RUNTIME` distinguishes the Node server from the edge runtime, where timers and
 * MongoDB are both unavailable.
 *
 * Deliberately imports no Node builtins at the top level. Next.js compiles this file for the
 * edge runtime too (the middleware runs there), where `node:net`/`node:dns` do not exist — a
 * static import of either failed to load and took down every middleware-matched route, while
 * `/api/*` and `/sign-in` (excluded from the matcher) kept working. The outbound IPv4 tuning
 * therefore lives in the Node-only `database/mongoose.ts`.
 */
export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    if (process.env.NEXT_PHASE === 'phase-production-build') return;

    const { startScheduler } = await import('@/lib/scheduler');
    startScheduler();
}
