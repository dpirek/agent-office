import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createUiStateStore } from '../lib/ui-state.js';
import { createOfficeChatService } from '../lib/office-chat.js';
import { createApiRouter } from '../api/index.js';
import { saveChatImages } from '../lib/chat-images.js';
import { renderChatArtifacts } from '../public/lib/markdown.mjs';
import { MAX_CHAT_IMAGE_BYTES } from '../public/lib/chat-image-limits.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=', 'base64');
const image = { name: 'photo.png', dataUrl: `data:image/png;base64,${png.toString('base64')}` };
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-chat-images-'));
  const store = createUiStateStore(path.join(root, 'state.sqlite'));
  const workspace = path.join(root, 'workspace');
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const alpha = store.createProject({ name: 'Alpha' }), beta = store.createProject({ name: 'Beta' });
  const mentions = [];
  const service = createOfficeChatService({ uiStateStore: store, onManagerMention: data => mentions.push(data) });
  const router = createApiRouter({ uiStateStore: store, sharedWorkspaceRoot: workspace, officeChatService: service });
  async function post(body, user = { id: 'member', name: 'Member', role: 'member', projectIds: [alpha.id] }) {
    const req = Readable.from([Buffer.from(JSON.stringify({ projectId: alpha.id, text: '', ...body }))]);
    req.method = 'POST'; req.user = user;
    const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
    await router(req, res, new URL('http://office.test/api/chat'));
    return res;
  }
  return { root, workspace, store, alpha, beta, mentions, post };
}

test('image-only chat persists workspace files and artifact previews and passes images to the manager', async t => {
  const { post, store, alpha, workspace, mentions } = await setup(t);
  const response = await post({ images: [image, image] });
  assert.equal(response.status, 201);
  const message = store.getOfficeChatMessages({ projectId: alpha.id })[0];
  assert.equal(message.text, '');
  assert.equal(message.artifacts.length, 2);
  assert.notEqual(message.artifacts[0].workspacePath, message.artifacts[1].workspacePath);
  for (const artifact of message.artifacts) {
    assert.ok(artifact.workspacePath.startsWith(`${alpha.id}/docs/chat-images/`));
    assert.deepEqual(await fs.readFile(path.join(workspace, artifact.workspacePath)), png);
    assert.equal(artifact.mimeType, 'image/png');
    assert.match(renderChatArtifacts([artifact]), /<img src="\/files\//);
  }
  assert.doesNotMatch(JSON.stringify(message), /data:image/);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].images[0].dataUrl, image.dataUrl);
  assert.ok(mentions[0].text.includes(message.artifacts[0].workspacePath));
  const reply = await post({ text: 'Another angle', replyToId: message.id, images: [image] });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.message.replyToId, message.id);
  assert.equal(reply.body.message.artifacts.length, 1);
});

test('member uploads larger than the old chat limit stay scoped and use safe filenames', async t => {
  const { post, alpha, beta, workspace, store } = await setup(t);
  const bytes = Buffer.concat([png, Buffer.alloc(140_000)]);
  const large = { name: '../../escape.png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  assert.equal((await post({ projectId: beta.id, images: [large] })).status, 403);
  const saved = await post({ images: [large] });
  assert.equal(saved.status, 201);
  const artifact = saved.body.message.artifacts[0];
  assert.equal(artifact.name, 'escape.png');
  assert.equal((await fs.stat(path.join(workspace, artifact.workspacePath))).size, bytes.length);
  assert.equal(store.getOfficeChatMessages({ projectId: beta.id }).length, 0);
  assert.equal((await post({ images: [image] }, null)).status, 403);
  assert.ok(artifact.workspacePath.startsWith(alpha.id));
});

test('invalid, oversized and excess images leave no chat messages or uploaded files', async t => {
  const { post, store, alpha, workspace } = await setup(t);
  const oversized = Buffer.concat([png, Buffer.alloc(MAX_CHAT_IMAGE_BYTES)]);
  for (const images of [
    [image, { name: 'bad.png', dataUrl: 'data:image/png;base64,aGVsbG8=' }],
    [{ ...image, dataUrl: image.dataUrl.replace('image/png', 'image/jpeg') }],
    [{ name: 'script.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }],
    [{ ...image, dataUrl: `data:image/png;base64,${oversized.toString('base64')}` }],
    Array(5).fill(image), {},
  ]) assert.equal((await post({ images })).status, 400);
  assert.equal((await post({ images: [image], replyToId: 'missing' })).status, 400);
  assert.equal((await post({ text: '' })).status, 400);
  assert.equal(store.getOfficeChatMessages({ projectId: alpha.id }).length, 0);
  await assert.rejects(fs.stat(workspace), { code: 'ENOENT' });
});

test('failed message creation rolls back uploads; upload directories cannot escape via symlinks', async t => {
  const { post, store, alpha, workspace, root } = await setup(t);
  const create = store.createOfficeChatMessage;
  store.createOfficeChatMessage = () => { throw new Error('Database unavailable'); };
  assert.equal((await post({ images: [image] })).status, 400);
  assert.deepEqual(await fs.readdir(path.join(workspace, alpha.id, 'docs/chat-images')), []);
  store.createOfficeChatMessage = create;
  const other = store.createProject({ name: 'Linked' });
  await fs.mkdir(path.join(workspace, other.id));
  await fs.symlink(root, path.join(workspace, other.id, 'docs'));
  await assert.rejects(saveChatImages(workspace, other.id, [image]), /symbolic link/);
  await assert.rejects(fs.stat(path.join(root, 'chat-images')), { code: 'ENOENT' });
});
