import { timingSafeEqual } from 'node:crypto';

export function safeTokenEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function bearerToken(value) {
  return /^Bearer\s+(.+)$/i.exec(String(value || ''))?.[1] || '';
}
