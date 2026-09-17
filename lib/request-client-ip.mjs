import { isIP } from 'node:net';

function address(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  return isIP(ip) ? ip : null;
}

export function requestClientIp(req) {
  const peer = address(req.socket?.remoteAddress);
  const localProxy = peer === '::1' || (isIP(peer || '') === 4 && peer.startsWith('127.'));
  // Generated Nginx configurations overwrite X-Real-IP and append to X-Forwarded-For.
  // Never accept a client-supplied forwarding header from a direct remote connection.
  if (localProxy) {
    const realIp = address(req.headers?.['x-real-ip']);
    if (realIp) return realIp;
    const forwarded = req.headers?.['x-forwarded-for'];
    const lastHop = typeof forwarded === 'string' ? address(forwarded.split(',').at(-1)) : null;
    if (lastHop) return lastHop;
  }
  return peer;
}
