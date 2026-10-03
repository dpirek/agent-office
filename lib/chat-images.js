import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectWorkspace } from './projects.js';
import { workspaceFileUrl } from '../public/lib/file-url.mjs';
import { MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES } from '../public/lib/chat-image-limits.mjs';

function decodeImage(image) {
  const match = typeof image?.dataUrl === 'string' && /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
  if (!match || match[2].length > Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4) throw new Error('Attach PNG, JPEG, GIF, or WebP images up to 5 MB each.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_CHAT_IMAGE_BYTES || bytes.toString('base64') !== match[2]) throw new Error('Invalid image data.');
  const detected = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg'
    : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) ? 'gif'
    : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'webp' : null;
  if (!detected || match[1] !== `image/${detected}`) throw new Error('Image content does not match its file type.');
  const stem = path.basename(String(image.name || 'image').replaceAll('\\', '/')).replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'image';
  return { bytes, mimeType: match[1], name: `${stem}.${detected === 'jpeg' ? 'jpg' : detected}` };
}

export async function saveChatImages(root, projectId, images = []) {
  if (!Array.isArray(images) || images.length > MAX_CHAT_IMAGES) throw new Error('Attach at most 4 images per message.');
  const decoded = images.map(decodeImage);
  const files = [];
  const artifacts = [];
  const rollback = async () => { await Promise.all(files.map(file => fs.rm(file, { force: true }))); };
  if (!decoded.length) return { artifacts, rollback };
  const projectRoot = await projectWorkspace(root, projectId);
  let directory = projectRoot;
  for (const segment of ['docs', 'chat-images']) {
    directory = path.join(directory, segment);
    await fs.mkdir(directory, { recursive: true });
    if (await fs.realpath(directory) !== directory) throw new Error('Image upload folder cannot be a symbolic link.');
  }
  try {
    for (const image of decoded) {
      const filename = `${crypto.randomUUID()}-${image.name}`;
      const file = path.join(directory, filename);
      await fs.writeFile(file, image.bytes, { flag: 'wx', mode: 0o600 });
      files.push(file);
      const workspacePath = `${projectId}/docs/chat-images/${filename}`;
      artifacts.push({ name: image.name, mimeType: image.mimeType, size: image.bytes.length, workspacePath, uri: workspaceFileUrl(workspacePath) });
    }
    return { artifacts, rollback };
  } catch (error) { await rollback(); throw error; }
}
