'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import DetailDrawer from '@/components/detail/DetailDrawer';
import StockDetailView from '@/components/stocks/StockDetailView';
import { getQuote } from '@/lib/actions/finnhub.actions';
import { getStockSentimentInsights } from '@/lib/actions/adanos.actions';
import { isStockInWatchlist } from '@/lib/actions/watchlist.actions';
import { formatPrice } from '@/lib/utils';

interface StockDetailDrawerProps {
    symbol: string | null;
    onClose: () => void;
}

type SentimentInsight = ComponentProps<typeof StockDetailView>['sentimentInsights'];

/**
 * Slide-over detail panel for a stock, the counterpart to CoinDetailDrawer.
 *
 * Stocks previously had no drawer at all: a candidate row expanded in place and the only route
 * to the real detail was a full navigation to /stocks/[symbol]. This gives the stock dashboard
 * the same affordance the crypto one has, and — both bodies being shared views — the two stay
 * honest about showing what their pages show.
 */
export default function StockDetailDrawer({ symbol, onClose }: StockDetailDrawerProps) {
    const [quote, setQuote] = useState<{ c?: number; dp?: number } | null>(null);
    const [insight, setInsight] = useState<SentimentInsight>(null);
    const [isInWatchlist, setIsInWatchlist] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!symbol) {
            setQuote(null);
            setInsight(null);
            setIsInWatchlist(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setQuote(null);
        setInsight(null);
        setIsInWatchlist(false);

        // All three are independent, so they go out together rather than in a waterfall.
        Promise.all([
            getQuote(symbol),
            getStockSentimentInsights(symbol),
            isStockInWatchlist(symbol),
        ])
            .then(([nextQuote, nextInsight, inWatchlist]) => {
                if (cancelled) return;
                setQuote(nextQuote);
                setInsight(nextInsight);
                setIsInWatchlist(inWatchlist);
            })
            .catch(() => {
                // Each panel renders its own unavailable state; the drawer itself stays usable.
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [symbol]);

    const upper = (symbol ?? '').toUpperCase();

    return (
        <DetailDrawer
            open={Boolean(symbol)}
            onClose={onClose}
            label={`${upper} details`}
            title={upper}
            price={quote?.c ? { value: formatPrice(quote.c), changePercent: quote.dp ?? null } : undefined}
            href={`/stocks/${upper}`}
            widthStorageKey="openstock:stock-drawer:width"
            loading={loading}
        >
            {symbol ? (
                <StockDetailView
                    symbol={upper}
                    isInWatchlist={isInWatchlist}
                    sentimentInsights={insight}
                />
            ) : null}
        </DetailDrawer>
    );
}
