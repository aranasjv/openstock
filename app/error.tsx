'use client';

import { useEffect } from 'react';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
            <h1 className="text-3xl font-bold text-gray-100">
                Something went wrong
            </h1>
            <p className="max-w-md text-gray-500">
                An unexpected error occurred while loading this page.
            </p>
            {error.digest ? (
                <p className="text-xs text-gray-600">Reference: {error.digest}</p>
            ) : null}
            <button
                type="button"
                onClick={() => reset()}
                className="rounded-lg bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2.5 font-semibold text-white transition-all hover:from-teal-600 hover:to-cyan-600"
            >
                Try again
            </button>
        </main>
    );
}
