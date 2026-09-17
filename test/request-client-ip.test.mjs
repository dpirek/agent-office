import test from 'node:test';
import assert from 'node:assert/strict';
import { requestClientIp } from '../lib/request-client-ip.mjs';
const request = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('direct HTTP clients use their socket address and cannot spoof proxy headers', () => {
  assert.equal(requestClientIp(request('::ffff:203.0.113.7', { 'x-real-ip': '192.0.2.5', 'x-forwarded-for': '192.0.2.6' })), '203.0.113.7');
  assert.equal(requestClientIp(request('2001:db8::7')), '2001:db8::7');
});
test('local Nginx connections use its overwritten real IP or appended forwarding address', () => {
  assert.equal(requestClientIp(request('127.0.0.1', { 'x-real-ip': '203.0.113.8', 'x-forwarded-for': '192.0.2.1, 203.0.113.8' })), '203.0.113.8');
  assert.equal(requestClientIp(request('::1', { 'x-real-ip': '2001:db8::8' })), '2001:db8::8');
  assert.equal(requestClientIp(request('::ffff:127.0.0.1', { 'x-forwarded-for': '192.0.2.1, 203.0.113.8' })), '203.0.113.8');
});
test('invalid or missing IPs never become log text', () => {
  assert.equal(requestClientIp(request('127.0.0.1', { 'x-real-ip': 'invalid\ntext', 'x-forwarded-for': 'also invalid' })), '127.0.0.1');
  assert.equal(requestClientIp({}), null);
});
