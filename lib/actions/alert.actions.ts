'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Alert, type IAlert } from '@/database/models/alert.model';
import { revalidatePath } from 'next/cache';

// Create a new alert
export async function createAlert(params: {
    userId: string;
    symbol: string;
    targetPrice: number;
    condition: 'ABOVE' | 'BELOW';
    assetType?: 'stock' | 'crypto';
}) {
    try {
        await connectToDatabase();
        const newAlert = await Alert.create({
            ...params,
            assetType: params.assetType ?? 'stock',
            active: true,
            // expiresAt handled by default value in schema
        });
        revalidatePath('/watchlist');
        revalidatePath('/holdings');
        return JSON.parse(JSON.stringify(newAlert));
    } catch (error) {
        console.error('Error creating alert:', error);
        throw new Error('Failed to create alert');
    }
}

// Get all alerts for a user
export async function getUserAlerts(userId: string, assetType?: 'stock' | 'crypto') {
    try {
        await connectToDatabase();
        const filter = assetType ? { userId, assetType } : { userId };
        const alerts = await Alert.find(filter).sort({ createdAt: -1 });
        return JSON.parse(JSON.stringify(alerts));
    } catch (error) {
        console.error('Error fetching alerts:', error);
        return [];
    }
}

// Delete an alert
export async function deleteAlert(alertId: string) {
    try {
        await connectToDatabase();
        await Alert.findByIdAndDelete(alertId);
        revalidatePath('/watchlist');
        return { success: true };
    } catch (error) {
        console.error('Error deleting alert:', error);
        throw new Error('Failed to delete alert');
    }
}

// Toggle alert active status (optional utility)
export async function toggleAlert(alertId: string, active: boolean) {
    try {
        await connectToDatabase();
        await Alert.findByIdAndUpdate(alertId, { active });
        revalidatePath('/watchlist');
        return { success: true };
    } catch (error) {
        console.error('Error toggling alert:', error);
        throw new Error('Failed to update alert');
    }
}
