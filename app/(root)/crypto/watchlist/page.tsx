import React, { Suspense } from 'react';
import { getAuth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { getUserAlerts } from '@/lib/actions/alert.actions';
import { getCryptoNews, searchCrypto } from '@/lib/actions/crypto.actions';
import CryptoWatchlistManager from '@/components/crypto/CryptoWatchlistManager';
import CryptoSearchCommand from '@/components/crypto/CryptoSearchCommand';
import AlertsPanel from '@/components/watchlist/AlertsPanel';
import NewsGrid from '@/components/watchlist/NewsGrid';
import { Loader2 } from 'lucide-react';

export default async function CryptoWatchlistPage() {
    const auth = await getAuth();
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        redirect('/sign-in');
    }

    const userId = session.user.id;

    const [watchlistItems, alerts, news, topCoins] = await Promise.all([
        getUserWatchlist(userId, 'crypto'),
        getUserAlerts(userId, 'crypto'),
        getCryptoNews(),
        searchCrypto(),
    ]);

    return (
        <div className="min-h-screen bg-black text-gray-100 p-6 md:p-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        Crypto Watchlist
                    </h1>
                    <p className="text-gray-500 mt-1">Track your favourite coins and manage alerts.</p>
                </div>
                <div className="flex items-center space-x-4">
                    <CryptoSearchCommand renderAs="button" label="Add Coin" initialCoins={topCoins} />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Main Content - Watchlist */}
                <div className="lg:col-span-3 space-y-8">
                    <div className="space-y-6">
                        <CryptoWatchlistManager initialItems={watchlistItems} userId={userId} />
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
