async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function fetchStatus() {
  return jsonRequest("/api/status");
}

function fetchTask(taskId) {
  return jsonRequest(`/api/tasks/${encodeURIComponent(taskId)}`);
}

function submitTask(prompt) {
  return jsonRequest("/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

export { fetchStatus, fetchTask, submitTask };
