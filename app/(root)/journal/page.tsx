import { headers } from 'next/headers';
import BreakerBanner from '@/components/journal/BreakerBanner';
import JournalBoard from '@/components/journal/JournalBoard';
import { getAuth } from '@/lib/better-auth/auth';
import { evaluateBreakerForUser, listThesesForUser } from '@/lib/data/theses';

/**
 * The trade journal.
 *
 * Resolves the session here and hands an explicit `userId` to the data layer rather than going
 * through a session-resolving action. Both reads are server-only, so an action would expose them to
 * the browser for nothing — the mutations the board needs still go through actions, because those
 * genuinely are invoked from the client.
 */
export default async function JournalPage() {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    const userId = session?.user?.id ?? '';

    const [theses, breaker] = await Promise.all([listThesesForUser(userId), evaluateBreakerForUser(userId)]);

    return (
        <div className="flex h-full flex-col gap-3 p-3">
            <header className="shrink-0">
                <h1 className="bg-gradient-to-r from-white to-gray-500 bg-clip-text text-lg font-bold text-transparent">
                    Journal
                </h1>
                <p className="text-[11px] text-gray-500">
                    Theses written before the trade, and what actually happened. Status moves are forward-only.
                </p>
            </header>

            <BreakerBanner decision={breaker} />

            <JournalBoard theses={theses} />
        </div>
    );
}
