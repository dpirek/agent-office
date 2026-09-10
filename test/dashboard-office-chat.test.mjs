import assert from "node:assert/strict";
import test from "node:test";
import { renderDashboardOfficeChatMessages } from "../public/lib/dashboard-office-chat.mjs";

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
