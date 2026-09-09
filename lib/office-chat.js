import crypto from "node:crypto";
import { assignOfficeTask, createOfficeTask } from "./office-tasks.js";

const MAX_CHAT_MESSAGE_LENGTH = 100_000;

function agentUsername(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
}

function officeChatMembers(subAgentManager) {
  return [
    { username: "office-manager", name: "Office Manager", type: "manager" },
    ...(subAgentManager?.listWorkers() || []).map((worker) => ({
      username: agentUsername(worker.name),
      name: worker.name,
      type: "agent",
      description: worker.description,
    })),
  ];
}

function mentionedMembers(text, members) {
  const handles = new Set(
    [...String(text || "").matchAll(/(^|\s)@([a-z0-9][a-z0-9-]*)\b/gi)]
      .map((match) => match[2].toLowerCase()),
  );
  return members.filter((member) => handles.has(member.username));
}

function createOfficeChatService({ uiStateStore, subAgentManager, onManagerMention = () => {} }) {
  let lastCreatedAt = uiStateStore.getOfficeChatMessages({ limit: 500 }).at(-1)?.createdAt || 0;

  function postMessage({ author = "You", username = "you", kind = "user", text, artifacts = [], taskId = null }) {
    const normalizedText = String(text || "").trim();
    if (!normalizedText) throw new Error("Message text is required.");
    if (normalizedText.length > MAX_CHAT_MESSAGE_LENGTH) throw new Error("Message is too long.");
    lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
    return uiStateStore.createOfficeChatMessage({
      id: crypto.randomUUID(),
      author: String(author || "You").slice(0, 100),
      username: agentUsername(username),
      kind: ["user", "manager", "agent", "system"].includes(kind) ? kind : "system",
      text: normalizedText,
      artifacts: Array.isArray(artifacts) ? artifacts : [],
      taskId,
      createdAt: lastCreatedAt,
    });
  }

  function postUserMessage({ text, priority = "medium" }) {
    const message = postMessage({ text });
    const members = officeChatMembers(subAgentManager);
    const mentions = mentionedMembers(text, members);
    const managerMentioned = mentions.some((member) => member.type === "manager");
    const dispatches = [];

    for (const member of mentions.filter((entry) => entry.type === "agent")) {
      try {
        const task = createOfficeTask(uiStateStore, { title: String(text).trim(), priority });
        const assigned = assignOfficeTask(uiStateStore, subAgentManager, { id: task.id, agent: member.name });
        dispatches.push({ ok: true, username: member.username, task: assigned });
      } catch (error) {
        dispatches.push({ ok: false, username: member.username, error: error.message });
        postMessage({
          author: "Office Manager",
          username: "office-manager",
          kind: "system",
          text: `Could not assign @${member.username}: ${error.message}`,
        });
      }
    }

    if (managerMentioned) {
      void Promise.resolve()
        .then(() => onManagerMention({ message, text: String(text).trim() }))
        .catch((error) => postMessage({
          author: "Office Manager",
          username: "office-manager",
          kind: "system",
          text: `Unable to respond: ${error.message}`,
        }));
    }

    return { message, managerMentioned, dispatches };
  }

  return {
    list({ after = 0, limit = 200 } = {}) {
      return {
        messages: uiStateStore.getOfficeChatMessages({ after, limit }),
        members: officeChatMembers(subAgentManager),
      };
    },
    postMessage,
    postUserMessage,
    postAssignment(task) {
      return postMessage({
        author: "Office Manager",
        username: "office-manager",
        kind: "manager",
        text: `@${agentUsername(task.agent)} Assigned task: ${task.title}`,
        taskId: task.messageId,
      });
    },
    postTaskResult(event, task) {
      const text = event === "completed"
        ? String(task.text || "Task completed.")
        : `Task ${event === "timed_out" ? "timed out" : "failed"}: ${task.error || "No details provided."}`;
      return postMessage({
        author: task.agent,
        username: agentUsername(task.agent),
        kind: "agent",
        text,
        artifacts: task.deliveredWork || [],
        taskId: task.messageId,
      });
    },
  };
}

export {
  MAX_CHAT_MESSAGE_LENGTH,
  agentUsername,
  createOfficeChatService,
  mentionedMembers,
  officeChatMembers,
};
