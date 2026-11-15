// Снимките към офертите и новините. Качват се от управлението, пазят се във файлове до базата.
import crypto from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from './core.js';

const MAX_BYTES = 2 * 1024 * 1024;

/** Познава вида по първите байтове, не по името на файла: приемат се само JPEG, PNG и WebP. */
function kindOf(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** Записва снимка, дошла като base64 (може и с „data:image/…;base64,“ отпред). Връща адреса ѝ: /uploads/<име>. */
export function saveImage(dir, base64) {
  const raw = String(base64 ?? '').replace(/^data:[^;,]+;base64,/, '');
  if (!raw || !/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw new AppError('bad_image', 'Това не е снимка.');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length > MAX_BYTES) throw new AppError('image_too_big', 'Снимката е по-голяма от 2 MB. Намалете я и опитайте пак.', 413);
  const kind = kindOf(buf);
  if (!kind) throw new AppError('bad_image', 'Приемат се само снимки JPEG, PNG или WebP.');
  mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.${kind}`;
  writeFileSync(join(dir, name), buf);
  return `/uploads/${name}`;
}
