import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The transporter is now built lazily, so the mock exposes getTransporter() rather than a
// ready-made instance. vi.hoisted keeps the spy available to the hoisted mock factory.
const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock('@/lib/nodemailer', () => ({
    getTransporter: async () => ({ sendMail: sendMailMock }),
}));

// Read config straight from process.env so these tests never touch MongoDB or real saved
// settings. Built from the real schema so key names and defaults cannot drift.
vi.mock('@/lib/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/config')>();
    return {
        ...actual,
        loadConfig: async () => {
            const values: Record<string, string> = {};
            for (const def of actual.CONFIG_SCHEMA) {
                let value: string | undefined;
                for (const name of def.env ?? []) {
                    if (process.env[name]) {
                        value = process.env[name];
                        break;
                    }
                }
                values[def.key] = value ?? def.default ?? '';
            }
            return values;
        },
    };
});

import { sendPasswordResetEmail } from '@/lib/nodemailer/reset-password';

describe('sendPasswordResetEmail', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = {
            ...originalEnv,
            NODEMAILER_EMAIL: 'sender@example.com',
            NODEMAILER_PASSWORD: 'secret',
        };
        sendMailMock.mockReset();
        sendMailMock.mockResolvedValue({ messageId: 'msg-123' } as never);
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('escapes interpolated values before building the HTML email', async () => {
        await sendPasswordResetEmail({
            email: 'user@example.com',
            name: '<Admin&Co.>',
            resetUrl: 'https://example.com/reset-password?token=a b&next=<script>',
        });

        expect(sendMailMock).toHaveBeenCalledTimes(1);
        const [mailOptions] = sendMailMock.mock.calls[0];

        expect(mailOptions.html).toContain('Hi &lt;Admin&amp;Co.&gt;,');
        expect(mailOptions.html).toContain('href="https://example.com/reset-password?token=a%20b&amp;next=%3Cscript%3E"');
        expect(mailOptions.html).not.toContain('<script>');
        expect(mailOptions.text).toContain('https://example.com/reset-password?token=a%20b&next=%3Cscript%3E');
    });

    it('throws when reset email credentials are missing', async () => {
        delete process.env.NODEMAILER_EMAIL;
        delete process.env.NODEMAILER_PASSWORD;

        await expect(
            sendPasswordResetEmail({
                email: 'user@example.com',
                name: 'User',
                resetUrl: 'https://example.com/reset-password?token=test',
            })
        ).rejects.toThrow('Email credentials not configured');
    });
});
