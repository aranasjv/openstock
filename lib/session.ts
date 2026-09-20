import 'server-only';

import { headers } from 'next/headers';
import { getAuth } from '@/lib/better-auth/auth';

/**
 * The signed-in user's id.
 *
 * This is the authorisation boundary for personal data, and it exists because
 * `middleware.ts` only checks that a session cookie is **present**, not that it is valid —
 * so a request carrying any cookie value reaches the action, and the action itself is the
 * only place that can tell who is really asking.
 *
 * It throws rather than returning null so a caller cannot accidentally carry on without a
 * session and fall back to some default identity.
 *
 * Deliberately not exported from a `'use server'` module: that would expose the session
 * lookup itself as a callable endpoint.
 */
export async function requireUserId(): Promise<string> {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    const userId = session?.user?.id;
    if (!userId) throw new Error('Not signed in.');
    return userId;
}

/** Non-throwing variant, for pages that render a signed-out state. */
export async function getCurrentUserId(): Promise<string | null> {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user?.id ?? null;
}
