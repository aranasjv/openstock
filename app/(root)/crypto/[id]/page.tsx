import CryptoDetailView from "@/components/crypto/CryptoDetailView";
import { getAuth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { isStockInWatchlist } from '@/lib/actions/watchlist.actions';
import { getCryptoCoinDetail, getCryptoMarketSentiment } from '@/lib/actions/crypto.actions';
import { resolveCryptoTradingViewSymbol } from '@/lib/tradingview';

/**
 * Full-page coin detail.
 *
 * The body is components/crypto/CryptoDetailView, shared with the dashboard drawer, so the two
 * cannot drift apart the way they did when each had its own copy.
 */
export default async function CryptoDetails({ params }: CryptoDetailsPageProps) {
    const { id } = await params;
    const coinId = id.toLowerCase();

    const auth = await getAuth();
    const session = await auth.api.getSession({
        headers: await headers()
    });
    const userId = session?.user?.id;

    const [isInWatchlist, coin, marketSentiment] = await Promise.all([
        userId ? isStockInWatchlist(coinId, 'crypto') : Promise.resolve(false),
        getCryptoCoinDetail(coinId),
        getCryptoMarketSentiment(),
    ]);

    // TradingView needs the ticker ("TAO"), not the CoinGecko id ("bittensor"), and it needs a
    // venue that actually lists the coin. The ticker only arrives with the detail response, so
    // resolution happens after it — verified against TradingView rather than assumed, and left
    // null when no venue has it so the charts can be skipped.
    const tvSymbol = coin?.symbol
        ? await resolveCryptoTradingViewSymbol(coin.symbol)
        : null;

    return (
        <div className="flex min-h-screen p-4 md:p-6 lg:p-8">
            <CryptoDetailView
                coinId={coinId}
                coin={coin}
                marketSentiment={marketSentiment}
                tvSymbol={tvSymbol}
                isInWatchlist={isInWatchlist}
            />
        </div>
    );
}
