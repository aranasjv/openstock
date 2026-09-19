import { getAuth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPortfolioSummary } from '@/lib/actions/holdings.actions';
import HoldingsManager from '@/components/holdings/HoldingsManager';
import { formatPrice } from '@/lib/utils';

export default async function HoldingsPage() {
    const auth = await getAuth();
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        redirect('/sign-in');
    }

    const userId = session.user.id;
    const summary = await getPortfolioSummary(userId);

    const pnlClass = summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400';

    return (
        <div className="flex min-h-screen flex-col gap-8 p-6 md:p-8">
            <div>
                <h1 className="bg-clip-text text-3xl font-bold text-transparent bg-gradient-to-r from-white to-gray-500">
                    Holdings
                </h1>
                <p className="mt-1 text-gray-500">
                    Your positions across stocks and crypto, valued at the latest price.
                </p>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
                    <div className="text-[10px] uppercase tracking-wider text-gray-600">Total value</div>
                    <div className="mt-1 font-mono text-2xl text-gray-100">{formatPrice(summary.totalValue)}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
                    <div className="text-[10px] uppercase tracking-wider text-gray-600">Cost basis</div>
                    <div className="mt-1 font-mono text-2xl text-gray-300">{formatPrice(summary.totalCost)}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
                    <div className="text-[10px] uppercase tracking-wider text-gray-600">Profit / loss</div>
                    <div className={`mt-1 font-mono text-2xl ${pnlClass}`}>
                        {summary.totalPnl >= 0 ? '+' : ''}
                        {formatPrice(summary.totalPnl)}
                        <span className="ml-2 text-sm">({summary.totalPnlPercent.toFixed(2)}%)</span>
                    </div>
                </div>
            </div>

            {summary.unpricedSymbols.length > 0 ? (
                <p className="rounded-xl border border-yellow-900/50 bg-yellow-950/20 p-3 text-xs text-yellow-200/90">
                    No price available for{' '}
                    <span className="font-mono">{summary.unpricedSymbols.join(', ')}</span>. Totals exclude these
                    positions rather than counting them as zero.
                </p>
            ) : null}

            <HoldingsManager userId={userId} holdings={summary.holdings} />
        </div>
    );
}
