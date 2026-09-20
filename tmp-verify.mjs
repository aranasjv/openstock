import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://root:example@127.0.0.1:27017/openstock?authSource=admin');
await client.connect();
const db = client.db('openstock');

const auth = betterAuth({
    database: mongodbAdapter(db),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: 'http://localhost:3000',
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
});

const email = `verify-${Date.now()}@example.com`;
const res = await auth.api.signUpEmail({
    body: { email, password: 'verify-password-123', name: 'Verify Bot' },
    returnHeaders: true,
});

console.log('PAIR=' + (res.headers.get('set-cookie') || '').split(';')[0]);
await client.close();
