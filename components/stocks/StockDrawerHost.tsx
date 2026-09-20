'use client';

import { useEffect, useState } from 'react';
import StockDetailDrawer from './StockDetailDrawer';
import { OPEN_STOCK_DRAWER_EVENT } from '@/lib/stock-drawer-event';

/**
 * The single stock drawer instance for the whole app.
 *
 * Mounted once in the root layout so a stock opens identically from any page. Callers use
 * `openStockDrawer` from lib/stock-drawer-event rather than rendering their own drawer —
 * the same contract as the coin drawer.
 */
export default function StockDrawerHost() {
    const [symbol, setSymbol] = useState<string | null>(null);

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<string>).detail;
            if (detail) setSymbol(detail);
        };

        window.addEventListener(OPEN_STOCK_DRAWER_EVENT, handler);
        return () => window.removeEventListener(OPEN_STOCK_DRAWER_EVENT, handler);
    }, []);

    return <StockDetailDrawer symbol={symbol} onClose={() => setSymbol(null)} />;
}
