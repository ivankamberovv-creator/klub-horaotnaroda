// Изпращане на писма: засега само кодът за вход.
// demo: писмото се печата в конзолата. smtp: тръгва през пощенска кутия на клуба (отделна от тази на сайта).
import nodemailer from 'nodemailer';

export function createMail({ provider = 'demo', host, port = 465, user, pass, from } = {}) {
  if (provider === 'demo') {
    return {
      name: 'demo',
      async send(to, subject, text) {
        console.log(`[Писмо демо] до ${to}: ${subject}\n${text}`);
      },
    };
  }
  if (provider === 'smtp') {
    // 465 е с шифроване от самото начало; на 587 връзката започва открита и се шифрова със STARTTLS
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined });
    return {
      name: 'smtp',
      async send(to, subject, text) {
        await transport.sendMail({ from, to, subject, text });
      },
    };
  }
  throw new Error(`Няма начин за пращане на писма „${provider}“. Има demo и smtp.`);
}
