import 'dotenv/config';

export const config = {
  port: process.env.PORT || 4000,
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  },
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    sandboxReceiverEmail: process.env.PAYPAL_SANDBOX_RECEIVER_EMAIL || '',
    mode: process.env.PAYPAL_MODE || 'sandbox',
    baseUrl:
      (process.env.PAYPAL_MODE || 'sandbox') === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com',
  },
};
