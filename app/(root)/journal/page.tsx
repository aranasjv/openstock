import JournalBoard from '@/components/journal/JournalBoard';
import { listTheses } from '@/lib/actions/thesis.actions';

/**
 * The trade journal.
 *
 * Reads through the session-resolving action, so the list is always the caller's own: the data
 * layer takes an explicit `userId` and the action is the only thing that supplies one.
 */
export default async function JournalPage() {
    const theses = await listTheses();

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

            <JournalBoard theses={theses} />
        </div>
    );
}
