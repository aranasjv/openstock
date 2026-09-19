import Header from "@/components/Header";
import Sidebar from "@/components/layout/Sidebar";
import CoinDrawerHost from "@/components/crypto/CoinDrawerHost";
import { getAuth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import DonatePopup from "@/components/DonatePopup";

// Session-dependent: never prerender at build time (keeps builds database-free).
export const dynamic = 'force-dynamic';

const Layout = async ({ children }: { children: React.ReactNode }) => {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user) redirect('/sign-in');

    const user = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
    }

    return (
        // The shell is viewport-height so dashboards can fill it exactly and scroll only
        // inside their own panels. Main scrolls normally for longer pages like settings.
        <div className="flex h-screen overflow-hidden text-gray-400">
            <Sidebar user={user} />

            <div className="flex min-w-0 flex-1 flex-col">
                <div className="shrink-0 lg:hidden">
                    <Header user={user} />
                </div>

                <main className="min-h-0 flex-1 overflow-y-auto">
                    {children}
                </main>
            </div>

            {/* Single drawer host: any coin row anywhere can open it via an event. */}
            <CoinDrawerHost />
            <DonatePopup />
        </div>
    )
}
export default Layout;
