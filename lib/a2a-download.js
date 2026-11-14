import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19].includes(b)) || a >= 224);
  }
  // Global unicast only; excludes loopback, mapped IPv4, link-local and ULA.
  return net.isIPv6(address) && /^[23]/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}
export function downloadArtifact(url, { headers = {}, signal = AbortSignal.timeout(30_000), allowPrivate = false, limit = 100 * 1024 * 1024 } = {}) {
  const target = new URL(url);
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && net.isIP(hostname) && !publicAddress(hostname)) return Promise.reject(new Error('Cross-origin artifact URLs cannot access private networks.'));
  return new Promise((resolve, reject) => {
    const request = (target.protocol === 'https:' ? https : http).get(target, {
      headers, signal,
      lookup(host, options, callback) {
        dns.lookup(host, { all: true }, (error, addresses) => {
          if (error) return callback(error);
          if (!addresses.length || (!allowPrivate && addresses.some(entry => !publicAddress(entry.address)))) return callback(new Error('Cross-origin artifact URLs cannot access private networks.'));
          // Pass the validated addresses directly to the connection (no second DNS lookup).
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); reject(new Error(`Artifact download failed (HTTP ${response.statusCode}); redirects are not followed.`)); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > limit) response.destroy(new Error('Artifact exceeds the 100 MB limit.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}
