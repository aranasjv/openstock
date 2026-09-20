import Link from "next/link";

export default function NotFound() {
    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-500">
                404
            </p>
            <h1 className="text-3xl font-bold text-gray-100 md:text-4xl">
                This page could not be found
            </h1>
            <p className="max-w-md text-gray-500">
                The page you are looking for does not exist or may have been moved.
            </p>
            <Link
                href="/"
                className="rounded-lg bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2.5 font-semibold text-white transition hover:from-teal-600 hover:to-cyan-600"
            >
                Back to dashboard
            </Link>
        </main>
    );
}
