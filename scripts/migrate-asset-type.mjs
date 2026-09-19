import dotenv from 'dotenv';
import mongoose from 'mongoose';
import dns from 'dns';

dotenv.config({ path: '.env' });
dns.setServers(['8.8.8.8']);

const uri = process.env.MONGODB_URI;

if (!uri) {
    console.error('ERROR: MONGODB_URI must be set in .env');
    process.exit(1);
}

async function backfill(collectionName) {
    const collection = mongoose.connection.db.collection(collectionName);
    const result = await collection.updateMany(
        { assetType: { $exists: false } },
        { $set: { assetType: 'stock' } }
    );
    console.log(`  ${collectionName}: backfilled ${result.modifiedCount} doc(s) as "stock"`);
}

async function dropLegacyIndex(collectionName, indexName) {
    const collection = mongoose.connection.db.collection(collectionName);
    const indexes = await collection.indexes();
    if (!indexes.some((idx) => idx.name === indexName)) {
        console.log(`  ${collectionName}: legacy index "${indexName}" not present, skipping`);
        return;
    }
    await collection.dropIndex(indexName);
    console.log(`  ${collectionName}: dropped legacy index "${indexName}"`);
}

async function main() {
    try {
        await mongoose.connect(uri, { family: 4 });
        console.log(`Connected to MongoDB [db="${mongoose.connection.name}"]`);

        console.log('Backfilling assetType...');
        await backfill('watchlists');
        await backfill('alerts');

        console.log('Dropping legacy unique index...');
        await dropLegacyIndex('watchlists', 'userId_1_symbol_1');

        console.log('Syncing indexes...');
        // Model files are TypeScript, so build the indexes directly through the driver.
        await mongoose.connection.db
            .collection('watchlists')
            .createIndex({ userId: 1, symbol: 1, assetType: 1 }, { unique: true });
        await mongoose.connection.db
            .collection('alerts')
            .createIndex({ userId: 1, assetType: 1 });

        console.log('Indexes now on watchlists:');
        for (const idx of await mongoose.connection.db.collection('watchlists').indexes()) {
            console.log(`  ${idx.name} ${JSON.stringify(idx.key)}${idx.unique ? ' (unique)' : ''}`);
        }

        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

main();
