'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Send, BellRing, Sparkles } from 'lucide-react';
import { sendTestDigest, runAlertCheckNow, sendAssistantReportNow } from '@/lib/actions/notifications.actions';

/**
 * Manual triggers for the scheduled jobs.
 *
 * The digest only fires once a day, so without this there is no way to confirm delivery
 * works short of waiting — and no way to tell a misconfiguration from an idle scheduler.
 */
export default function NotificationActions() {
    const [pending, startTransition] = useTransition();

    const run = (label: string, action: () => Promise<{ ok: boolean; message: string }>) => {
        startTransition(async () => {
            const result = await action();
            if (result.ok) toast.success(`${label}: ${result.message}`);
            else toast.error(`${label}: ${result.message}`);
        });
    };

    return (
        <section className="rounded-xl border border-gray-800 bg-gray-900/30 p-5">
            <h2 className="mb-1 text-lg font-semibold text-white">Scheduled jobs</h2>
            <p className="mb-4 text-xs text-gray-500">
                The scheduler runs inside the app process. Trigger any job now to confirm
                Telegram delivery without waiting for its schedule. The AI report uses the
                same assistant as /assistant, so it needs a working AI provider key.
            </p>

            <div className="flex flex-wrap gap-3">
                <Button
                    type="button"
                    disabled={pending}
                    onClick={() => run('Digest', sendTestDigest)}
                    className="h-9 bg-teal-600 px-3 text-white hover:bg-teal-500"
                >
                    <Send className="mr-2 h-4 w-4" />
                    {pending ? 'Working…' : 'Send daily digest now'}
                </Button>
                <Button
                    type="button"
                    disabled={pending}
                    onClick={() => run('AI report', sendAssistantReportNow)}
                    className="h-9 bg-teal-600 px-3 text-white hover:bg-teal-500"
                >
                    <Sparkles className="mr-2 h-4 w-4" />
                    {pending ? 'Working…' : 'Send AI report now'}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run('Alert check', runAlertCheckNow)}
                    className="h-9 border-gray-700 bg-transparent px-3 text-gray-200 hover:bg-white/5"
                >
                    <BellRing className="mr-2 h-4 w-4" />
                    Run alert check now
                </Button>
            </div>
        </section>
    );
}
