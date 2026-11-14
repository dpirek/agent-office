import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Stage protocol-native artifacts, then reuse Office's atomic workspace delivery.
export async function storeA2AArtifacts(workspace, task, artifacts, client) {
  if (!artifacts.length) return [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-a2a-'));
  const files = []; let total = 0;
  try {
    for (const artifact of artifacts) {
      if (!artifact.artifactId || !Array.isArray(artifact.parts) || !artifact.parts.length) throw new Error('Invalid A2A artifact.');
      // Consecutive chunks of the same part kind form one output. Mixed media
      // parts are independent files, preserving their declared filenames.
      const groups = [];
      for (const part of artifact.parts) {
        const kinds = ['text', 'raw', 'url', 'data'].filter(key => Object.hasOwn(part, key));
        if (kinds.length !== 1) throw new Error('An A2A part must contain exactly one content field.');
        const kind = kinds[0]; const previous = groups.at(-1);
        if (previous && kind !== 'url' && kind !== 'data' && previous.kind === kind && previous.filename === part.filename && previous.mediaType === part.mediaType) previous.parts.push(part);
        else groups.push({ kind, filename: part.filename, mediaType: part.mediaType, parts: [part] });
      }
      for (const [index, group] of groups.entries()) {
        const chunks = [];
        for (const part of group.parts) {
          let bytes;
          if (group.kind === 'url') bytes = await client.download(part.url);
          else if (group.kind === 'raw') {
            if (typeof part.raw !== 'string' || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(part.raw)) throw new Error('Invalid base64 artifact.');
            bytes = Buffer.from(part.raw, 'base64');
          } else bytes = Buffer.from(group.kind === 'text' ? part.text : JSON.stringify(part.data, null, 2));
          total += bytes.length;
          if (total > 100 * 1024 * 1024) throw new Error('Task artifacts exceed the 100 MB delivery limit.');
          chunks.push(bytes);
        }
        const suffix = group.kind === 'text' ? '.txt' : group.kind === 'data' ? '.json' : '.bin';
        const name = group.filename || (groups.length === 1 ? artifact.name : `${artifact.name || artifact.artifactId}-${index + 1}`) || artifact.artifactId + suffix;
        const file = path.join(directory, String(files.length));
        await fs.writeFile(file, Buffer.concat(chunks));
        files.push({ artifactId: artifact.artifactId, name, mimeType: group.mediaType || (group.kind === 'text' ? 'text/plain' : group.kind === 'data' ? 'application/json' : 'application/octet-stream'), file });
      }
    }
    return await workspace.storeTaskArtifacts(task, files);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
