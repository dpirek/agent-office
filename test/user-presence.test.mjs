import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedUsers } from '../lib/user-presence.js';
import { createOfficeChatService } from '../lib/office-chat.js';

test('presence deduplicates tabs, validates sessions, and excludes private fields', () => {
  const person = { id: '1', name: 'Alex', avatar: 'designer', role: 'member', email: 'private@example.com' };
  const sessions = new Map([['one', person], ['two', person], ['pending', { ...person, id: '2', role: 'pending' }]]);
  const first = {}, second = {};
  const sockets = new Map([[first, { token: 'one' }], [second, { token: 'two' }], [{}, { token: 'expired' }], [{}, { token: 'pending' }]]);
  const store = { session: token => sessions.get(token) };
  assert.deepEqual(connectedUsers(sockets, store), [{ id: '1', name: 'Alex', avatar: 'designer' }]);
  first.destroyed = true;
  assert.equal(connectedUsers(sockets, store).length, 1);
  sessions.delete('two');
  assert.deepEqual(connectedUsers(sockets, store), []);
});

test('human members use unique handles and human mentions do not dispatch agent work', () => {
  const users = [{ id: 'person-1', name: 'Office Manager', avatar: 'initials' }, { id: 'person-2', name: 'Office Manager', avatar: 'designer' }];
  const messages = [];
  const chat = createOfficeChatService({
    uiStateStore: { getOfficeChatMessages: () => messages, createOfficeChatMessage: message => { messages.push(message); return message; } },
    subAgentManager: { listWorkers: () => [] }, getOnlineUsers: () => users,
  });
  assert.equal(chat.list({ user: users[0] }).members.length, 3);
  const result = chat.postUserMessage({ user: users[0], text: '@user-person-2 Hello!' });
  assert.equal(result.managerMentioned, false);
  assert.deepEqual(result.dispatches, []);
  assert.equal(result.message.author, 'Office Manager');
  assert.equal(result.message.username, 'user-person-1');
  users.splice(0);
  assert.equal(chat.list().members.length, 1);
});

test('ended connections go offline; another open tab keeps the same person online', () => {
  const user = { id: 'person', name: 'Person', role: 'member' };
  const first = { readableEnded: true }, second = {};
  const sockets = new Map([[first, { token: 'one' }], [second, { token: 'two' }]]);
  const store = { session: () => user };
  assert.equal(connectedUsers(sockets, store).length, 1);
  second.writableEnded = true;
  assert.equal(connectedUsers(sockets, store).length, 0);
});

test('project members remain in chat as offline after their final tab disconnects', () => {
  const users = [{ id: 'one', name: 'Alex', role: 'member', email: 'private@example.com' }, { id: 'two', name: 'Sam', role: 'member' }];
  let online = [users[0]];
  const chat = createOfficeChatService({
    uiStateStore: { getOfficeChatMessages: () => [], requireProject() {} },
    getOnlineUsers: () => online,
    getProjectUsers: projectId => projectId === 'alpha' ? users : [],
  });
  const people = () => chat.list({ projectId: 'alpha' }).members.filter(member => member.type === 'human');
  assert.deepEqual(people().map(member => member.status), ['online', 'offline']);
  online = [];
  assert.deepEqual(people().map(member => member.status), ['offline', 'offline']);
  assert.equal(people()[0].email, undefined);
  assert.equal(chat.list({ projectId: 'beta' }).members.length, 1);
  online = [users[0]];
  assert.equal(people()[0].status, 'online');
});
