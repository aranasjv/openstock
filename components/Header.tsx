import Link from "next/link";
import Image from "next/image";
import NavItems from "@/components/NavItems";
import UserDropdown from "@/components/UserDropdown";
import {searchStocks} from "@/lib/actions/finnhub.actions";
import {searchCrypto} from "@/lib/actions/crypto.actions";

const Header = async ({ user }: { user: User }) => {
    const [initialStocks, initialCoins] = await Promise.all([
        searchStocks(),
        searchCrypto(),
    ]);

    return (
        <header className="sticky top-0 header">
            <div className="container header-wrapper">
                <Link href="/" className="flex items-center justify-center gap-2">
                    <Image
                        src="/assets/images/logo.png"
                        alt="OpenStock"
                        width={200}
                        height={50}
                    />
                </Link>
                <nav className="hidden sm:block">
                    <NavItems initialStocks={initialStocks} initialCoins={initialCoins}/>
                </nav>

                <UserDropdown user={user} initialStocks={initialStocks} initialCoins={initialCoins} />
            </div>
        </header>
    )
}
export default Header