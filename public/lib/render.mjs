import { renderMarkdown } from "./markdown.mjs";
import { escapeHtml, formatTime } from "./format.mjs";

function createRenderer(elements) {
  const expandedTasks = new Set();

  function addMessage(role, text, extraClass = "") {
    elements.consoleNode.querySelector(".empty")?.remove();
    const item = document.createElement("div");
    item.className = `message ${role} ${extraClass}`;

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = role;

    const body = document.createElement("div");
    body.className = "body";
    body.classList.add("markdown-body");
    body.innerHTML = renderMarkdown(text);

    item.append(label, body);
    elements.consoleNode.append(item);
    elements.consoleNode.scrollTop = elements.consoleNode.scrollHeight;
  }

  function taskDetail(label, value, className = "") {
    return `<div class="task-detail ${className}"><span class="task-detail-label">${escapeHtml(label)}</span><span class="task-detail-value">${escapeHtml(value ?? "—")}</span></div>`;
  }

  function diagnosticDetails(details, prefix = "") {
    if (!details) return "";
    const request = details.request
      ? `${details.request.method || "GET"} ${details.request.url || "unknown URL"}${details.request.attempt ? ` (attempt ${details.request.attempt})` : ""}`
      : "Unknown request";
    const response = details.response
      ? `HTTP ${details.response.status}${details.response.statusText ? ` ${details.response.statusText}` : ""}\nHeaders: ${JSON.stringify(details.response.headers || {}, null, 2)}\nBody: ${details.response.body || "(empty response body)"}${details.response.truncated ? "\n(response body truncated)" : ""}`
      : "No HTTP response received.";
    const cause = details.cause ? JSON.stringify(details.cause, null, 2) : "No nested cause was provided.";
    return [
      taskDetail(`${prefix}Request`, request, "task-trace"),
      taskDetail(`${prefix}Response`, response, "task-trace"),
      taskDetail(`${prefix}Cause`, cause, "task-trace"),
      taskDetail(`${prefix}Trace`, details.stack || "No stack trace was provided.", "task-trace"),
    ].join("");
  }

  function renderTaskRows(tasks) {
    if (!tasks.length) return '<tr><td class="empty-table" colspan="5">No tasks yet.</td></tr>';
    return tasks.map((task, index) => {
      const expanded = expandedTasks.has(task.taskId);
      const detailsId = `task-details-${index}`;
      const callbackState = task.callbackDelivered === null
        ? "—"
        : task.callbackDelivered ? "delivered" : task.callbackError ? "failed" : "pending";
      const errorDetails = task.errorDetails || task.result?.error?.details;
      const failure = task.state === "failed"
        ? taskDetail("Error", task.error || task.result?.error?.message || "No error details were provided.", "task-error") + diagnosticDetails(errorDetails)
        : "";
      const callbackError = task.callbackError
        ? taskDetail("Callback error", task.callbackError, "task-error") + diagnosticDetails(task.callbackErrorDetails, "Callback ")
        : "";
      return `<tr class="task-row" data-task-id="${escapeHtml(task.taskId)}">
        <td title="${escapeHtml(task.messageId)}"><button type="button" class="task-toggle" aria-expanded="${expanded}" aria-controls="${detailsId}"><span class="chevron" aria-hidden="true">›</span><span class="message-id">${escapeHtml(task.messageId)}</span></button></td>
        <td>${escapeHtml(task.source)}</td>
        <td class="state-${escapeHtml(task.state)}">${escapeHtml(task.state)}</td>
        <td>${callbackState}</td>
        <td>${escapeHtml(formatTime(task.createdAt))}</td>
      </tr><tr id="${detailsId}" class="task-details-row"${expanded ? "" : " hidden"}>
        <td colspan="5" class="task-details-cell"><div class="task-details">
          ${taskDetail("Task ID", task.taskId)}
          ${taskDetail("Message ID", task.messageId)}
          ${taskDetail("Started", task.startedAt ? new Date(task.startedAt).toLocaleString() : "—")}
          ${taskDetail("Finished", task.finishedAt ? new Date(task.finishedAt).toLocaleString() : "—")}
          ${failure}${callbackError}
        </div></td>
      </tr>`;
    }).join("");
  }

  function renderAgentInfo(data) {
    const rows = [
      ["Name", data.agent.name],
      ["Role", data.agent.description],
      ["Workspace", data.execution.workspace],
      ["Tools", data.execution.tools.join(", ") || "none"],
      ["Model", data.provider.model],
      ["Provider", data.provider.name],
    ];
    elements.agentInfo.innerHTML = `<dl class="agent-grid">${rows.map(([key, value]) => `<div class="agent-row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
  }

  function renderLogs(tasks) {
    const events = tasks.slice(0, 8).reverse().flatMap((task) => {
      const shortId = task.messageId.length > 24 ? `${task.messageId.slice(0, 21)}…` : task.messageId;
      const entries = [{ at: task.createdAt, text: `Task ${shortId} queued`, error: false }];
      if (task.startedAt) entries.push({ at: task.startedAt, text: `Task ${shortId} started`, error: false });
      if (task.finishedAt) {
        entries.push({
          at: task.finishedAt,
          text: task.state === "failed" ? `Task failed: ${task.error || "unknown error"}` : `Task ${shortId} completed`,
          error: task.state === "failed",
        });
      }
      return entries;
    }).slice(-10);
    elements.logs.innerHTML = events.length
      ? events.map((event) => `<div class="log-row${event.error ? " error" : ""}"><span>${escapeHtml(formatTime(event.at))}</span><span>${escapeHtml(event.text)}</span></div>`).join("")
      : '<div class="log-row"><span>--:--:--</span><span>No task activity recorded.</span></div>';
  }

  function renderStatus(data) {
    elements.healthDot.className = "dot ok";
    elements.healthText.textContent = "Server online";
    elements.agentDescription.textContent = `${data.agent.name} — ${data.agent.description}`;
    elements.workspaceSummary.textContent = data.execution.workspace;
    elements.workspaceSummary.title = data.execution.workspace;
    elements.queueBadge.textContent = `${data.queue.active} active · ${data.queue.queued} queued`;

    const rows = [
      ["Provider", data.provider.name], ["Model", data.provider.model], ["Endpoint", data.provider.url],
      ["API key", data.provider.apiKeyConfigured ? "configured" : "missing", data.provider.apiKeyConfigured ? "yes" : "no"],
      ["Workspace", data.execution.workspace], ["Task history", data.execution.taskDatabase], ["Concurrency", data.execution.concurrency],
      ["Max turns", data.execution.maxTurns], ["Tools", data.execution.tools.join(", ") || "none"],
      ["Prompts", data.execution.systemPromptOverrides.join(", ") || "built-in defaults"],
      ["MCP", data.execution.mcpConfigured ? "configured" : "not configured"],
      ["Callbacks", `${data.callback.retries} attempts / ${data.callback.timeoutMs}ms`],
    ];
    elements.status.innerHTML = `<dl>${rows.map(([key, value, className]) => `<div class="row"><dt>${escapeHtml(key)}</dt><dd class="${className || ""}">${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
    elements.tasks.innerHTML = renderTaskRows(data.tasks);
    renderAgentInfo(data);
    renderLogs(data.tasks);
  }

  function renderOffline(error) {
    elements.healthDot.className = "dot bad";
    elements.healthText.textContent = `Offline: ${error.message}`;
  }

  function toggleTask(row) {
    const taskId = row.dataset.taskId;
    if (expandedTasks.has(taskId)) expandedTasks.delete(taskId);
    else expandedTasks.add(taskId);
    const toggle = row.querySelector(".task-toggle");
    const details = document.getElementById(toggle.getAttribute("aria-controls"));
    const expanded = expandedTasks.has(taskId);
    toggle.setAttribute("aria-expanded", String(expanded));
    details.hidden = !expanded;
  }

  return { addMessage, renderOffline, renderStatus, toggleTask };
}

export { createRenderer };
