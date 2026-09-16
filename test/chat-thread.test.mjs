import test from 'node:test';
import assert from 'node:assert/strict';
import { formatThreadRequest, threadReplyText, SILENT_THREAD_REPLY } from '../lib/chat-thread.js';

test('LLM request preserves thread hierarchy, speakers, and the current reply without future messages', () => {
  const parent = { id: 'root', replyToId: null, author: 'Alice', username: 'alice', kind: 'user', text: 'Can you check deployment?', projectId: 'project', createdAt: 1 };
  const previous = { ...parent, id: 'answer', replyToId: 'root', author: 'Office Manager', kind: 'manager', text: 'Which environment?', createdAt: 2 };
  const message = { ...parent, id: 'reply', replyToId: 'answer', author: 'Bob', text: 'Staging please', createdAt: 3 };
  const future = { ...parent, id: 'future', text: 'Should not be included', createdAt: 4 };
  const prompt = formatThreadRequest({ message, parent: previous, thread: [parent, previous, message, future] });
  const data = JSON.parse(prompt.slice(prompt.indexOf('{')));
  assert.equal(data.projectId, 'project');
  assert.equal(data.threadRoot.id, 'root');
  assert.equal(data.parentMessage.id, 'answer');
  assert.equal(data.latestReply.author, 'Bob');
  assert.equal(data.latestReply.replyToId, 'answer');
  assert.deepEqual(data.earlierThreadMessages.map(item => item.id), ['root', 'answer']);
  assert.ok(!prompt.includes(future.text));
  assert.match(prompt, /do not call tools/);
});

test('silent or empty model results produce no public reply; substantive responses are preserved', () => {
  assert.equal(threadReplyText(SILENT_THREAD_REPLY), null);
  assert.equal(threadReplyText(`  ${SILENT_THREAD_REPLY}\n`), null);
  assert.equal(threadReplyText(''), null);
  assert.equal(threadReplyText(undefined), null);
  assert.equal(threadReplyText('I will check staging.'), 'I will check staging.');
});
