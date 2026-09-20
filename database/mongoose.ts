import mongoose from "mongoose";
import dns from 'dns';

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Outbound networking fixes, needed in a container.
 *
 * Set Google DNS and prefer IPv4 to avoid querySrv ECONNREFUSED.
 *
 * **`net.setDefaultAutoSelectFamily(false)` used to be called here, and removing it is deliberate.**
 * It was added because `fetch` to api.telegram.org timed out while `wget` to the same URL returned
 * 200: a container with no IPv6 route still receives AAAA records, and Happy Eyeballs' fallback to a
 * black-holed IPv6 address does not fail fast. Disabling the race fixed that.
 *
 * It also broke the market-breadth CSV, and the isolation is worth recording because the two
 * symptoms have opposite signs. Measured in this container against tradermonty.github.io:
 *
 *     no tuning            -> OK
 *     ipv4first only       -> OK
 *     autoselect disabled  -> Connect Timeout Error (tradermonty.github.io:443, 10000ms)
 *
 * The reason is the shape of the answer: GitHub Pages resolves to **four** A records. With the race
 * disabled Node commits to the first address it is given, and when that one black-holes the host
 * becomes unreachable — even though three others work and the same host resolved fine a moment
 * earlier. A global switch that turns one vendor's bad luck into every vendor's problem is the wrong
 * instrument, so it is gone.
 *
 * `ipv4first` is the half worth keeping: it makes IPv4 the address Happy Eyeballs tries *first*,
 * which is the actual cause the Telegram diagnosis identified, without removing the fallback that
 * lets an unreachable address be skipped. If Telegram regresses, the fix is a per-request dispatcher
 * for Telegram specifically — not re-disabling this globally.
 *
 * This runs here, at the top of the Node-only database module, rather than in instrumentation.ts:
 * Next.js compiles instrumentation for the edge runtime as well (the middleware), where node:dns
 * does not exist, and a static import there crashed every middleware-matched route.
 */
try {
    // This is often more effective than setServers for Node 17+
    if (dns.setDefaultResultOrder) {
        dns.setDefaultResultOrder('ipv4first');
    }
    dns.setServers(['8.8.8.8']);

    console.log('🌐 Outbound networking: IPv4 preferred');
} catch (e) {
    console.error('Failed to set custom DNS:', e);
}

declare global {
    var mongooseCache: {
        conn: typeof mongoose | null;
        promise: Promise<typeof mongoose> | null;
    }
}

let cached = global.mongooseCache;

if (!cached) {
    cached = global.mongooseCache = { conn: null, promise: null };
}

export const connectToDatabase = async () => {
    if (!MONGODB_URI) {
        throw new Error("MongoDB URI is missing");
    }

    if (cached.conn) return cached.conn;

    if (!cached.promise) {
        cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false, family: 4 });
    }

    try {
        cached.conn = await cached.promise;
    }
    catch (err) {
        cached.promise = null;
        throw err;
    }

    console.log(`MongoDB Connected ${MONGODB_URI} in ${process.env.NODE_ENV}`);
    return cached.conn;
}