// Писмата с кода за вход: тръгват ли наистина през SMTP. Срещу малък пощенски сървър, пуснат само за проверката.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createMail } from '../src/mail.js';

/** Пощенски сървър с най-малкото от SMTP, колкото да приеме едно писмо и да го запомни */
function fakeSmtp() {
  const letters = [];
  const server = net.createServer((socket) => {
    let buffer = '', inData = false, letter = null;
    socket.write('220 proba.invalid ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          letter.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          letters.push(letter);
          socket.write('250 OK\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        if (/^(EHLO|HELO)/i.test(line)) socket.write('250 proba.invalid\r\n');
        else if (/^MAIL FROM:/i.test(line)) { letter = { from: line.slice(10), to: [] }; socket.write('250 OK\r\n'); }
        else if (/^RCPT TO:/i.test(line)) { letter.to.push(line.slice(8)); socket.write('250 OK\r\n'); }
        else if (/^DATA/i.test(line)) { inData = true; socket.write('354 Go\r\n'); }
        else if (/^QUIT/i.test(line)) { socket.end('221 Bye\r\n'); return; }
        else socket.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, letters, port: server.address().port })));
}

test('писмото с кода тръгва през SMTP: от адреса на клуба, до клиента, с кирилица в темата и текста', async () => {
  const smtp = await fakeSmtp();
  try {
    const mail = createMail({ provider: 'smtp', host: '127.0.0.1', port: smtp.port, from: 'Клуб „Хора от Народа“ <klub@primer.bg>' });
    await mail.send('maria@primer.bg', 'Код за вход: 123456', 'Здравейте,\n\nВашият код е 123456.\n');
    assert.equal(smtp.letters.length, 1);
    const letter = smtp.letters[0];
    assert.ok(letter.from.includes('klub@primer.bg'), letter.from);
    assert.equal(letter.to.length, 1);
    assert.ok(letter.to[0].includes('maria@primer.bg'), letter.to[0]);
    // темата и текстът са кодирани за пренос; разкодирани трябва да са същите
    const subject = /^Subject: (.*(?:\r\n[ \t].*)*)/m.exec(letter.data)[1].replace(/\r\n[ \t]/g, '');
    const decoded = subject.replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=\s*/gi, (_, kind, body) => kind.toUpperCase() === 'B'
      ? Buffer.from(body, 'base64').toString('utf8')
      : Buffer.from(body.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));
    assert.equal(decoded.trim(), 'Код за вход: 123456');
    assert.match(letter.data, /Content-Type: text\/plain; charset=utf-8/i);
    const body = letter.data.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const text = /Content-Transfer-Encoding: base64/i.test(letter.data) ? Buffer.from(body, 'base64').toString('utf8')
      : Buffer.from(body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
    assert.ok(text.includes('Вашият код е 123456.'), text);
  } finally {
    smtp.server.close();
  }
});

test('пощата отказва: грешката стига до този, който праща', async () => {
  const server = net.createServer((socket) => socket.end('554 Не приемам писма\r\n'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const mail = createMail({ provider: 'smtp', host: '127.0.0.1', port: server.address().port, from: 'klub@primer.bg' });
    await assert.rejects(() => mail.send('maria@primer.bg', 'Код', 'Текст'));
  } finally {
    server.close();
  }
});

test('демото само печата писмото; непознат начин за пращане спира сървъра с ясна грешка', async () => {
  const mail = createMail({ provider: 'demo' });
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try { await mail.send('maria@primer.bg', 'Код за вход: 123456', 'Текст'); } finally { console.log = log; }
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('maria@primer.bg') && lines[0].includes('123456'));
  assert.throws(() => createMail({ provider: 'gulab' }), /gulab/);
});
