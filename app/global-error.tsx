'use client';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html lang="en" className="dark">
            <body className="antialiased">
                <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
                    <h1 className="text-3xl font-bold text-gray-100">
                        Something went wrong
                    </h1>
                    <p className="max-w-md text-gray-500">
                        An unexpected error occurred. You can try again, or head back to the
                        dashboard.
                    </p>
                    {error.digest ? (
                        <p className="text-xs text-gray-500">Reference: {error.digest}</p>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => reset()}
                        className="rounded-lg bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2.5 font-semibold text-white transition hover:from-teal-600 hover:to-cyan-600"
                    >
                        Try again
                    </button>
                </main>
            </body>
        </html>
    );
}
