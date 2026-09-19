import React, { Suspense } from 'react';
import { getAuth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { getUserAlerts } from '@/lib/actions/alert.actions';
import { getNews } from '@/lib/actions/finnhub.actions';
import { getCryptoNews, searchCrypto } from '@/lib/actions/crypto.actions';
import WatchlistManager from '@/components/watchlist/WatchlistManager';
import CryptoWatchlistManager from '@/components/crypto/CryptoWatchlistManager';
import WatchlistTabs from '@/components/watchlist/WatchlistTabs';
import SearchCommand from '@/components/SearchCommand';
import CryptoSearchCommand from '@/components/crypto/CryptoSearchCommand';
import AlertsPanel from '@/components/watchlist/AlertsPanel';
import NewsGrid from '@/components/watchlist/NewsGrid';
import { Loader2 } from 'lucide-react';

interface WatchlistPageProps {
    searchParams: Promise<{ tab?: string }>;
}

export default async function WatchlistPage({ searchParams }: WatchlistPageProps) {
    const { tab } = await searchParams;
    const assetType = tab === 'crypto' ? ('crypto' as const) : ('stock' as const);

    const auth = await getAuth();
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        redirect('/sign-in');
    }

    const userId = session.user.id;

    // Both lists are fetched so the tab counts are accurate regardless of the active tab.
    const [stockItems, cryptoItems] = await Promise.all([
        getUserWatchlist(userId, 'stock'),
        getUserWatchlist(userId, 'crypto'),
    ]);

    const activeItems = assetType === 'crypto' ? cryptoItems : stockItems;
    const stockSymbols = stockItems.map((item: { symbol: string }) => item.symbol);

    // Every fetch is filtered by asset type. Previously these omitted the filter, so the
    // stock page also listed crypto coins and then asked Finnhub to quote CoinGecko ids —
    // the reported "watchlist doesn't support crypto" bug.
    const [alerts, symbolNews, topCoins] = await Promise.all([
        getUserAlerts(userId, assetType),
        assetType === 'crypto' ? getCryptoNews() : getNews(stockSymbols),
        assetType === 'crypto' ? searchCrypto() : Promise.resolve([]),
    ]);

    // Fall back to general market news when a stock watchlist is empty.
    const news = symbolNews && symbolNews.length > 0
        ? symbolNews
        : assetType === 'stock'
            ? await getNews()
            : [];

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        Watchlist
                    </h1>
                    <p className="text-gray-500 mt-1">
                        Track stocks and crypto, and manage alerts for both.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <Suspense fallback={<div className="h-10" />}>
                        <WatchlistTabs
                            active={assetType === 'crypto' ? 'crypto' : 'stocks'}
                            stockCount={stockItems.length}
                            cryptoCount={cryptoItems.length}
                        />
                    </Suspense>
                    {assetType === 'crypto' ? (
                        <CryptoSearchCommand renderAs="button" label="Add Coin" initialCoins={topCoins} />
                    ) : (
                        <SearchCommand renderAs="button" label="Add Stock" initialStocks={[]} />
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Main Content - Watchlist */}
                <div className="lg:col-span-3 space-y-8">
                    <div className="space-y-6">
                        {assetType === 'crypto' ? (
                            <CryptoWatchlistManager initialItems={activeItems} userId={userId} />
                        ) : (
                            <WatchlistManager initialItems={activeItems} userId={userId} />
                        )}
                    </div>

                    {/* News Section */}
                    <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin text-gray-500" /></div>}>
                        <NewsGrid news={news || []} />
                    </Suspense>
                </div>

                {/* Sidebar - Alerts */}
                <div className="lg:col-span-1">
                    <AlertsPanel alerts={alerts} />
                </div>
            </div>
        </div>
    );
}
