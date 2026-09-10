import assert from "node:assert/strict";
import test from "node:test";
import { postDashboardOfficeChat, renderDashboardOfficeChatMessages } from "../public/lib/dashboard-office-chat.mjs";

test("dashboard office chat renders messages without user-list or composer controls", () => {
  const markup = renderDashboardOfficeChatMessages([{
    author: "Office Manager",
    username: "office-manager",
    kind: "manager",
    text: "**Build complete.**",
    createdAt: "2026-09-10T12:00:00.000Z",
  }]);

  assert.match(markup, /Office Manager/);
  assert.match(markup, /<strong>Build complete\.<\/strong>/);
  assert.match(markup, /assets\/avatars\/manager\.png/);
  assert.doesNotMatch(markup, /office-chat-members|office-board-composer|textarea/);
});

test("dashboard office chat posts messages through the central office API", async () => {
  let request;
  const result = await postDashboardOfficeChat(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ok: true }) };
  }, "@builder status update?");

  assert.deepEqual(result, { ok: true });
  assert.equal(request.url, "/api/chat");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { text: "@builder status update?" });
});
