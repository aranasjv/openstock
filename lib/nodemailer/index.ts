import nodemailer, { type Transporter } from 'nodemailer';
import { loadConfig } from '@/lib/config';
import { WELCOME_EMAIL_TEMPLATE, NEWS_SUMMARY_EMAIL_TEMPLATE } from "@/lib/nodemailer/templates";

type EmailSendResult =
    | { status: 'skipped' }
    | { status: 'sent'; messageId: string };

/**
 * The transporter is built lazily rather than at import time, because credentials now come
 * from the runtime config layer and can change from /settings. It is rebuilt whenever the
 * configured credentials change, so editing a Gmail app password takes effect immediately.
 */
let cachedTransporter: Transporter | null = null;
let cachedCredentialKey = '';

export async function getTransporter(): Promise<Transporter | null> {
    const { NODEMAILER_EMAIL, NODEMAILER_PASSWORD } = await loadConfig();

    if (!NODEMAILER_EMAIL || !NODEMAILER_PASSWORD) {
        return null;
    }

    const credentialKey = `${NODEMAILER_EMAIL}:${NODEMAILER_PASSWORD}`;
    if (cachedTransporter && cachedCredentialKey === credentialKey) {
        return cachedTransporter;
    }

    cachedTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: NODEMAILER_EMAIL,
            pass: NODEMAILER_PASSWORD,
        },
        // Keep the pool small because email volume is low in this app.
        pool: true,
        maxConnections: 1,
        maxMessages: 3,
    });
    cachedCredentialKey = credentialKey;

    return cachedTransporter;
}

export async function sendWelcomeEmail({ email, name, intro }: WelcomeEmailData) {
    try {
        const { NODEMAILER_EMAIL } = await loadConfig();
        const transporter = await getTransporter();

        if (!transporter) {
            console.warn('⚠️ Welcome email skipped: email credentials are not configured.');
            return { status: 'skipped' } satisfies EmailSendResult;
        }

        const htmlTemplate = WELCOME_EMAIL_TEMPLATE
            .replace('{{name}}', name)
            .replace('{{intro}}', intro);

        const mailOptions = {
            from: `"Openstock" <${NODEMAILER_EMAIL}>`,
            to: email,
            subject: `Welcome to Openstock - your open-source stock market toolkit!`,
            text: 'Thanks for joining Openstock, an initiative by open dev society',
            html: htmlTemplate,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Welcome email sent successfully:', info.messageId);
        return { status: 'sent', messageId: info.messageId } satisfies EmailSendResult;
    } catch (error) {
        console.error('❌ Failed to send welcome email:', error);
        throw error;
    }
}

export const sendNewsSummaryEmail = async (
    { email, date, newsContent }: { email: string; date: string; newsContent: string }
) => {
    try {
        const { NODEMAILER_EMAIL } = await loadConfig();
        const transporter = await getTransporter();

        if (!transporter) {
            console.warn('⚠️ News summary email skipped: email credentials are not configured.');
            return { status: 'skipped' } satisfies EmailSendResult;
        }

        const htmlTemplate = NEWS_SUMMARY_EMAIL_TEMPLATE
            .replace('{{date}}', date)
            .replace('{{newsContent}}', newsContent);

        const mailOptions = {
            from: `"Openstock" <${NODEMAILER_EMAIL}>`,
            to: email,
            subject: `📈 Market News Summary Today - ${date}`,
            text: `Today's market news summary from Openstock`,
            html: htmlTemplate,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ News summary email sent successfully:', info.messageId);
        return { status: 'sent', messageId: info.messageId } satisfies EmailSendResult;
    } catch (error) {
        console.error('❌ Failed to send news summary email:', error);
        throw error;
    }
};
