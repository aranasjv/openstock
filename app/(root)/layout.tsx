import Header from "@/components/Header";
import Sidebar from "@/components/layout/Sidebar";
import { getAuth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Footer from "@/components/Footer";
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
        // Sidebar on desktop, slim header (with the nav in the user dropdown) on mobile.
        <div className="flex min-h-screen text-gray-400">
            <Sidebar user={user} />

            <div className="flex min-w-0 flex-1 flex-col">
                <div className="lg:hidden">
                    <Header user={user} />
                </div>

                <main className="min-w-0 flex-1">
                    {children}
                </main>

                <Footer />
            </div>

            <DonatePopup />
        </div>
    )
}
export default Layout;
