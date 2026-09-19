import { redirect } from 'next/navigation';

/**
 * Kept as a permanent redirect so existing links keep working. The crypto watchlist is now
 * the crypto tab of the unified /watchlist page — two separate pages is what let the
 * asset-type filtering drift apart in the first place.
 */
export default function CryptoWatchlistRedirect() {
    redirect('/watchlist?tab=crypto');
}
