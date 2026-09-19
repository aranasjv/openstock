'use client';

import { useEffect, useState } from 'react';
import CoinDetailDrawer from './CoinDetailDrawer';
import { OPEN_COIN_DRAWER_EVENT } from '@/lib/coin-drawer-event';

/**
 * The single drawer instance for the whole app.
 *
 * Mounted once in the root layout so a coin opens identically from any page. Callers use
 * `openCoinDrawer` from lib/coin-drawer-event rather than rendering their own drawer.
 */
export default function CoinDrawerHost() {
    const [coinId, setCoinId] = useState<string | null>(null);

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<string>).detail;
            if (detail) setCoinId(detail);
        };

        window.addEventListener(OPEN_COIN_DRAWER_EVENT, handler);
        return () => window.removeEventListener(OPEN_COIN_DRAWER_EVENT, handler);
    }, []);

    return <CoinDetailDrawer coinId={coinId} onClose={() => setCoinId(null)} />;
}
