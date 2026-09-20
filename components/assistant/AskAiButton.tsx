'use client';

import { Sparkles } from 'lucide-react';
import { openAssistant } from '@/lib/assistant-overlay-event';

const DEFAULT_CLASS =
    'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-teal-900/50 bg-teal-950/30 px-2.5 py-1.5 text-[11px] text-teal-300 transition-colors hover:bg-teal-900/30';

/**
 * The dashboards' "Ask AI" affordance.
 *
 * A button rather than a link: it opens the floating assistant, so the screener or chart you
 * were reading stays behind it. It used to be a `<Link href="/assistant">`, which meant losing
 * your place to ask a single question and then having to navigate back.
 */
export default function AskAiButton({ className }: { className?: string }) {
    return (
        <button
            type="button"
            onClick={() => openAssistant()}
            aria-haspopup="dialog"
            className={className ?? DEFAULT_CLASS}
        >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Ask AI
        </button>
    );
}
