import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: 'standalone',
    devIndicators: false,
    turbopack: {
        root: process.cwd(),
    },
    /* config options here */
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'i.ibb.co',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'static2.finnhub.io',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'assets.coingecko.com',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'coin-images.coingecko.com',
                port: '',
                pathname: '/**',
            },
        ],
    },
    eslint: {
        // Still ignored, and knowingly: `npm run lint` fails repo-wide on pre-existing errors in
        // scripts/ and a few components, so making it a build gate would block every deploy until
        // that debt is cleared. Types are a gate again — see below.
        ignoreDuringBuilds: true,
    },
    // `typescript: { ignoreBuildErrors: true }` used to live here, and it cost us: a duplicate
    // object key shipped in a widget config and nobody found out until a later typecheck. The
    // only thing keeping it on was a set of Inngest signatures written against the v4
    // `triggers:` shape while the installed version takes the trigger as its own argument; those
    // are fixed, so the build typechecks again.
    typescript: {
        ignoreBuildErrors: false,
    },
};

export default nextConfig;
