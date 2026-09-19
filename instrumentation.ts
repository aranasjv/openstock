/**
 * Starts the in-process scheduler once, when the server boots.
 *
 * Guards matter here. Without them the Docker image build would try to start a scheduler
 * during `next build`, and this project already depends on the build being side-effect free
 * (no database, no network). `NEXT_PHASE` is set to `phase-production-build` for builds, and
 * `NEXT_RUNTIME` distinguishes the Node server from the edge runtime, where timers and
 * MongoDB are both unavailable.
 */
export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    if (process.env.NEXT_PHASE === 'phase-production-build') return;

    const { startScheduler } = await import('@/lib/scheduler');
    startScheduler();
}
