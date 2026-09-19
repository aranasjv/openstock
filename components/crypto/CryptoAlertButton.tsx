"use client";

import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import CreateAlertModal from "@/components/watchlist/CreateAlertModal";

interface CryptoAlertButtonProps {
    userId: string;
    coinId: string;
    coinName: string;
    currentPrice: number;
}

export default function CryptoAlertButton({
    userId,
    coinId,
    coinName,
    currentPrice,
}: CryptoAlertButtonProps) {
    return (
        <CreateAlertModal
            userId={userId}
            symbol={coinId}
            currentPrice={currentPrice}
            companyName={coinName}
            assetType="crypto"
        >
            <Button
                variant="outline"
                className="border-gray-700 bg-transparent text-gray-200 hover:bg-white/5"
            >
                <Bell className="mr-2 h-4 w-4" />
                Set Alert
            </Button>
        </CreateAlertModal>
    );
}
