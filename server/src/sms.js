// Изпращане на кода за вход. Засега има само демо: кодът се печата в конзолата.
// Истински доставчик на SMS още не е избран; когато бъде, тук се добавя негов клон.

export function createSms({ provider = 'demo' } = {}) {
  if (provider === 'demo') {
    return {
      provider,
      async send(phone, textMessage) {
        console.log(`[SMS демо] до ${phone}: ${textMessage}`);
      },
    };
  }
  throw new Error(`Няма настроен доставчик на SMS „${provider}“. Засега работи само SMS_PROVIDER=demo.`);
}
