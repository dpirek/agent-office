import assert from "node:assert/strict";
import test from "node:test";
import { formatConversationContext } from "../lib/conversation-context.js";
import { promptWithHistory } from "../lib/ws.js";

test("conversation context gives the newest topic and current request highest priority", () => {
  const history = [
    { label: "User", text: "Plan the Atlas analytics project." },
    { label: "Manager", text: "Atlas will use a blue dashboard." },
    { label: "User", text: "Now let's discuss the Beacon marketing site." },
    { label: "Manager", text: "Beacon should lead with the new research and use a green theme." },
  ];
  const prompt = formatConversationContext(history, "Build that project now.", { activeMessages: 2 });
  const olderIndex = prompt.indexOf("Atlas analytics project");
  const activeIndex = prompt.indexOf("Beacon marketing site");
  const currentIndex = prompt.indexOf("Build that project now");

  assert.match(prompt, /active recent topic.+default project context/is);
  assert.match(prompt, /Do not mix names, requirements, files, or decisions from older topics/);
  assert.match(prompt, /Older background[^]*Atlas analytics project/);
  assert.match(prompt, /Active recent topic[^]*Beacon marketing site/);
  assert.ok(olderIndex < activeIndex);
  assert.ok(activeIndex < currentIndex);
  assert.ok(prompt.lastIndexOf("Beacon") < currentIndex);
});

test("dashboard history is included before a vague current request", () => {
  const prompt = promptWithHistory("Continue building it.", [
    { role: "user", text: "We are building the Beacon website." },
    { role: "agent", text: "I completed the Beacon data research." },
  ]);
  assert.match(prompt, /Active recent topic/);
  assert.match(prompt, /Beacon website/);
  assert.ok(prompt.indexOf("Beacon website") < prompt.indexOf("Continue building it"));
});
