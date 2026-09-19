import { setDefaultAutoSelectFamily } from 'node:net';
import dns from 'node:dns';

/**
 * Runtime bootstrap: starts the scheduler and normalises outbound networking.
 *
 * Guards matter here. Without them the Docker image build would try to start a scheduler
 * during `next build`, and this project depends on the build being side-effect free (no
 * database, no network). `NEXT_PHASE` is set to `phase-production-build` for builds, and
 * `NEXT_RUNTIME` distinguishes the Node server from the edge runtime, where timers and
 * MongoDB are both unavailable.
 */
export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    if (process.env.NEXT_PHASE === 'phase-production-build') return;

    tuneOutboundNetworking();

    const { startScheduler } = await import('@/lib/scheduler');
    startScheduler();
}

/**
 * Outbound HTTPS fixes, needed in a container.
 *
 * Node 20 enables "Happy Eyeballs" (autoSelectFamily) by default: it resolves every address
 * family and races them. A Docker container with no IPv6 route still receives AAAA records,
 * and connecting to one does not fail fast — it black-holes until the whole request times out.
 *
 * This was not theoretical. `fetch` to api.telegram.org timed out (ETIMEDOUT) inside the
 * container while `wget` to the same URL returned 200, because wget has no such race. The
 * failure was misread as a network block on Telegram; it was this client-side behaviour.
 *
 * Disabling it also pre-empts the same trap for any other host publishing AAAA records.
 */
function tuneOutboundNetworking(): void {
    try {
        // Prefer A records; the app already assumes IPv4 egress.
        dns.setDefaultResultOrder('ipv4first');

        // Do not race address families — a single routable address beats a fast unreachable one.
        if (typeof setDefaultAutoSelectFamily === 'function') {
            setDefaultAutoSelectFamily(false);
            console.log('🌐 Outbound networking: IPv4 preferred, address-family racing disabled');
        }
    } catch (error) {
        console.error('Could not tune outbound networking:', error);
    }
}
