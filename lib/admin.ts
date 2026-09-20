import 'server-only';

import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAuth } from '@/lib/better-auth/auth';
import { connectToDatabase } from '@/database/mongoose';

/**
 * Admin gating for the settings page.
 *
 * The app has no role system, so this uses `ADMIN_EMAILS` (comma-separated, env-only —
 * deliberately not editable from the UI, or an admin could lock themselves out).
 *
 * When `ADMIN_EMAILS` is unset, the earliest-registered user is treated as the admin.
 * That keeps a fresh self-hosted instance usable without a chicken-and-egg problem while
 * still refusing everyone else.
 */
export function getAdminEmails(): string[] {
    return (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

async function getEarliestUserEmail(): Promise<string | null> {
    try {
        const mongoose = await connectToDatabase();
        const db = mongoose.connection.db;
        if (!db) return null;

        const earliest = await db
            .collection('user')
            .find({}, { projection: { email: 1, createdAt: 1 } })
            .sort({ createdAt: 1 })
            .limit(1)
            .next();

        const email = earliest?.email;
        return typeof email === 'string' ? email.toLowerCase() : null;
    } catch (error) {
        console.error('Admin check: could not resolve earliest user:', error);
        return null;
    }
}

/**
 * The admin user's id, for jobs that act on their behalf outside a request.
 *
 * The daily digest and the AI report both cover "the owner's" holdings, and neither runs
 * with a session — so they need the same identity the settings page is gated on, resolved
 * the same way (ADMIN_EMAILS, else the earliest registered user).
 */
export async function getAdminUserId(): Promise<string | null> {
    try {
        const mongoose = await connectToDatabase();
        const db = mongoose.connection.db;
        if (!db) return null;

        const earliest = await db
            .collection('user')
            .find({}, { projection: { id: 1, _id: 1, createdAt: 1 } })
            .sort({ createdAt: 1 })
            .limit(1)
            .next();

        const id = earliest?.id;
        if (typeof id === 'string' && id) return id;
        return earliest?._id ? String(earliest._id) : null;
    } catch (error) {
        console.error('Admin check: could not resolve the admin user id:', error);
        return null;
    }
}

export async function isCurrentUserAdmin(): Promise<boolean> {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    const email = session?.user?.email?.toLowerCase();
    if (!email) return false;

    const admins = getAdminEmails();
    if (admins.length > 0) return admins.includes(email);

    const earliestEmail = await getEarliestUserEmail();
    return earliestEmail !== null && earliestEmail === email;
}

/** Renders a 404 for non-admins, so the page's existence is not disclosed. */
export async function requireAdmin(): Promise<void> {
    if (!(await isCurrentUserAdmin())) {
        notFound();
    }
}
