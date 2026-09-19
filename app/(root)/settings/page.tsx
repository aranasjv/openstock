import { requireAdmin, getAdminEmails } from '@/lib/admin';
import { getConfigView, SETTING_GROUPS } from '@/lib/config';
import SettingsGroup from '@/components/settings/SettingsGroup';
import NotificationActions from '@/components/settings/NotificationActions';

export default async function SettingsPage() {
    await requireAdmin();

    const [fields, adminEmails] = await Promise.all([getConfigView(), Promise.resolve(getAdminEmails())]);
    const usingFallbackAdmin = adminEmails.length === 0;

    return (
        <div className="flex min-h-screen flex-col gap-8 p-6 md:p-8">
            <div>
                <h1 className="bg-clip-text text-3xl font-bold text-transparent bg-gradient-to-r from-white to-gray-500">
                    Settings
                </h1>
                <p className="mt-1 text-gray-500">
                    Runtime configuration. Changes take effect immediately — no rebuild or restart.
                    Values saved here override environment variables.
                </p>
            </div>

            {usingFallbackAdmin ? (
                <div className="rounded-xl border border-yellow-900/50 bg-yellow-950/20 p-4 text-sm text-yellow-200/90">
                    <strong className="font-semibold">ADMIN_EMAILS is not set.</strong> The
                    earliest-registered account is being treated as the admin. Set
                    <code className="mx-1 rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs">ADMIN_EMAILS</code>
                    in the environment to control this explicitly.
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {SETTING_GROUPS.map((group) => {
                    const groupFields = fields.filter((field) => field.group === group.id);
                    if (groupFields.length === 0) return null;
                    return (
                        <div key={group.id} className={group.id === 'system' ? 'xl:col-span-2' : ''}>
                            <SettingsGroup title={group.label} fields={groupFields} />
                        </div>
                    );
                })}
            </div>

            <NotificationActions />

            <p className="text-xs text-gray-600">
                Secrets are stored in MongoDB and never sent to the browser — only a masked
                form is displayed here.
            </p>
        </div>
    );
}
