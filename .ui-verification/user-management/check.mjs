import { chromium } from '/private/tmp/pwtest/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const artifactRoot = path.join(root, '.ui-verification/user-management');
const runtime = await mkdtemp(path.join(artifactRoot, 'run-'));
const server = spawn(process.execPath, ['server.js'], { cwd: root, env: {
  ...process.env, PORT: '0', AI_HARNESS_DATA_DIR: runtime,
  AI_HARNESS_WORKSPACE: path.join(runtime, 'workspace'), AI_HARNESS_SHARED_WORKSPACE: path.join(runtime, 'shared'),
}, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 10000);
    server.stdout.on('data', (chunk) => { const match = chunk.toString().match(/listening on (http:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
  browser = await chromium.launchPersistentContext(path.join(runtime, 'chrome-profile'), { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForURL('**/account');
  await page.getByRole('heading', { name: 'Create administrator account' }).waitFor();
  await page.locator("#account-view").getByLabel('Name', { exact: true }).fill('Office Admin');
  await page.locator("#account-view").getByLabel('Email', { exact: true }).fill('admin@example.com');
  await page.locator("#account-view").getByLabel('Password', { exact: true }).fill('test secure password 123');
  await page.locator("#account-view").getByLabel('Confirm password').fill('test secure password 123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
  assert.equal(await page.locator('.user-card').count(), 1);
  await page.screenshot({ path: path.join(artifactRoot, 'admin.png'), fullPage: true });
  const registered = await page.evaluate(async () => {
    const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Office Member', email: 'member@example.com', password: 'test secure password 123', role: 'admin' }) });
    return response.json();
  });
  assert.equal(registered.user.role, 'pending');
  await page.reload();
  const memberRow = page.locator('.user-card').filter({ hasText: 'member@example.com' });
  await memberRow.getByRole('combobox').selectOption('member');
  await memberRow.getByRole('button', { name: 'Save role' }).click();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.waitForURL('**/central-office/dashboard');
  await page.evaluate(() => { window.accountNavigationCheck = true; });
  await page.getByRole('link', { name: 'Account and users' }).click();
  await page.waitForURL('**/account');
  assert.equal(await page.evaluate(() => window.accountNavigationCheck), true);
  await page.goBack();
  await page.waitForURL('**/central-office/dashboard');
  await page.goForward();
  await page.waitForURL('**/account');
  await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifactRoot, 'admin.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(artifactRoot, 'admin-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator("#account-view").getByLabel('Email', { exact: true }).fill('member@example.com');
  await page.locator("#account-view").getByLabel('Password', { exact: true }).fill('test secure password 123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Office Member', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Users', exact: true }).count(), 0);
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.waitForURL('**/central-office/dashboard');
  const socketRevoked = await page.evaluate(async () => {
    const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const closed = new Promise(resolve => { socket.onclose = () => resolve(true); });
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return Promise.race([closed, new Promise(resolve => setTimeout(() => resolve(false), 3000))]);
  });
  assert.equal(socketRevoked, true);
  await page.goto(origin);
  await page.waitForURL('**/account');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.locator("#account-view").getByLabel('Confirm password').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(artifactRoot, 'registration-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser verification passed: setup, registration, approval, role restrictions, office navigation, logout, WebSocket revocation, mobile layout.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  if (server.exitCode === null && server.signalCode === null) await once(server, 'exit').catch(() => {});
  await rm(runtime, { recursive: true, force: true });
}
