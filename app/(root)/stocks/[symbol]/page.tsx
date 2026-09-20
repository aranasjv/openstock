import StockDetailView from "@/components/stocks/StockDetailView";
import { getAuth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { isStockInWatchlist } from '@/lib/actions/watchlist.actions';
import { getStockSentimentInsights } from '@/lib/actions/adanos.actions';

/**
 * Full-page stock detail.
 *
 * The body is components/stocks/StockDetailView, shared with the dashboard drawer, so the two
 * cannot drift apart the way the coin page and its drawer did.
 */
export default async function StockDetails({ params }: StockDetailsPageProps) {
    const { symbol } = await params;

    const auth = await getAuth();
    const session = await auth.api.getSession({
        headers: await headers()
    });
    const userId = session?.user?.id;

    const [isInWatchlist, sentimentInsights] = await Promise.all([
        userId ? isStockInWatchlist(symbol) : Promise.resolve(false),
        getStockSentimentInsights(symbol),
    ]);

    return (
        <div className="flex min-h-screen p-4 md:p-6 lg:p-8">
            <StockDetailView
                symbol={symbol}
                isInWatchlist={isInWatchlist}
                sentimentInsights={sentimentInsights}
            />
        </div>
    );
}
