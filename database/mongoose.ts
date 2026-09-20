import mongoose from "mongoose";
import dns from 'dns';
import { setDefaultAutoSelectFamily } from 'node:net';

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Outbound networking fixes, needed in a container.
 *
 * Set Google DNS and force IPv4 to avoid querySrv ECONNREFUSED.
 *
 * Also disables Node 20's "Happy Eyeballs" address-family racing (autoSelectFamily): it
 * resolves every family and races them, and a container with no IPv6 route still receives
 * AAAA records — connecting to one does not fail fast, it black-holes until the whole request
 * times out. That is why `fetch` to api.telegram.org timed out (ETIMEDOUT) inside the
 * container while `wget` to the same URL returned 200; it was misread as a network block on
 * Telegram, but it was this client-side behaviour.
 *
 * This runs here, at the top of the Node-only database module, rather than in
 * instrumentation.ts: Next.js compiles instrumentation for the edge runtime as well (the
 * middleware), where node:net/node:dns do not exist, and a static import there crashed every
 * middleware-matched route.
 */
try {
    // This is often more effective than setServers for Node 17+
    if (dns.setDefaultResultOrder) {
        dns.setDefaultResultOrder('ipv4first');
    }
    dns.setServers(['8.8.8.8']);

    // Prefer A records; the app already assumes IPv4 egress.
    if (typeof setDefaultAutoSelectFamily === 'function') {
        setDefaultAutoSelectFamily(false);
    }

    console.log('🌐 Outbound networking: IPv4 preferred, address-family racing disabled');
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