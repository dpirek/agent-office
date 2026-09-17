# Worker WebSocket API

Workers join the office by connecting to `ws://HOST:PORT/ws/workers` (or `wss://` in production). The office only considers a worker registered and assignable while that socket is connected.

For the normative integration contract, including validation, security, lifecycle, and reconnect requirements, see [Agent Worker Integration Specification](./sub-agent-spec.md).

## Register

The first client message must identify and authenticate the worker:

```json
{
  "type": "register",
  "credentials": { "token": "shared-worker-token" },
  "worker": {
    "name": "Dave the Developer",
    "description": "Completes coding tasks in its configured workspace.",
    "url": "ws://worker.example.com/agent",
    "capabilities": {
      "skills": [{ "id": "coding-task", "name": "Coding Task", "description": "Inspect and modify a workspace." }],
      "tools": ["list_files", "read_file", "write_file", "run_command"],
      "mcp": false,
      "workspaceArtifacts": true
    },
    "model": { "provider": "openrouter", "name": "openai/gpt-5.6-sol", "url": "https://openrouter.ai/api/v1" }
  }
}
```

Generate the token from **Dashboard → Live Worker Registry → Generate Token** or bootstrap it with the office's `AI_HARNESS_WORKER_TOKEN`. It may instead be supplied as an `Authorization: Bearer …` header. A successful registration returns a `registered` message containing the normalized worker record.

## Receive a task

```json
{
  "type": "task",
  "taskId": "task-generated-uuid",
  "priority": "high",
  "artifactUpload": {
    "url": "/api/worker-artifacts?taskId=task-generated-uuid&name=<filename>",
    "token": "task-specific-upload-token",
    "method": "POST",
    "contentType": "application/octet-stream"
  },
  "message": {
    "messageId": "msg-generated-uuid",
    "role": "manager",
    "parts": [{ "kind": "text", "mimeType": "text/plain", "text": "Prepare the release." }]
  }
}
```

## Answer a direct question

Simple `@worker` questions arrive without creating a task:

```json
{"type":"direct_message","message":{"messageId":"direct-generated-uuid","role":"user","parts":[{"kind":"text","mimeType":"text/plain","text":"@dave what version are you using?"}]}}
```

Reply on the same socket with:

```json
{"type":"direct_message_response","inReplyTo":"direct-generated-uuid","message":{"messageId":"reply-generated-uuid","role":"agent","parts":[{"kind":"text","mimeType":"text/plain","text":"Version 1.2.3."}]}}
```

The office posts the response to Central Office and returns a `direct_message_ack`. Do not include `taskId` or artifacts in a direct response.

Long-running task status checks use the same `direct_message` format. The text identifies the active task and requests progress, blockers, next step, and ETA. Reply normally and continue the assigned work.

## Send updates

Workers may send any number of `working` updates. `inReplyTo` is optional, but when present must match the task's `message.messageId`.

```json
{
  "type": "task_update",
  "taskId": "task-generated-uuid",
  "inReplyTo": "msg-generated-uuid",
  "status": { "state": "working" },
  "message": {
    "messageId": "update-generated-uuid",
    "role": "agent",
    "parts": [{ "kind": "text", "mimeType": "text/markdown", "text": "Tests are running." }]
  }
}
```

Each accepted update receives `{"type":"task_update_ack","taskId":"…","state":"working"}`.

## Stop a task

The office may send a cancellation while work is active:

```json
{"type":"task_cancel","taskId":"task-generated-uuid","inReplyTo":"msg-generated-uuid","reason":"Task stopped by the office manager."}
```

Abort the matching model request, commands, child processes, and artifact uploads immediately. No acknowledgement is required. The office marks the assignment `cancelled`; late updates cannot overwrite that state.

## Complete with deliverables

First upload the raw file bytes to the task-specific URL supplied with the assignment:

The bearer credential can be the assignment's upload token or the current worker
registration key. Both require an active task upload; completed or discarded
tasks cannot receive new files. No browser session is required.

Prefer this upload flow on Windows too: send the local file bytes and return the
received IDs in `uploadedArtifactIds`. A `C:\...` path or `file://` URI is local to
the worker and cannot be downloaded by the Office. With PowerShell, use `curl.exe`
and `--data-binary "@C:\path\delivery.zip"` when uploading raw bytes.

For legacy HTTP artifact URLs, the Office first downloads anonymously. If the
registered worker's HTTP(S) origin returns 401, it retries with the current worker
registration key. The worker's file server must accept that key. The key is never
sent to a different host, port, or protocol, including redirect destinations.
Use uploads or a signed download URL for files hosted elsewhere; a browser-session
download link will not work as a worker artifact URL.

```http
POST /api/worker-artifacts?taskId=task-generated-uuid&name=release.zip HTTP/1.1
Authorization: Bearer task-specific-upload-token
Content-Type: application/octet-stream

<raw file bytes>
```

The response contains an `artifactId`. Reference that ID in the final socket update:

```json
{
  "type": "task_update",
  "taskId": "task-generated-uuid",
  "inReplyTo": "msg-generated-uuid",
  "status": { "state": "completed" },
  "message": {
    "messageId": "result-generated-uuid",
    "role": "agent",
    "parts": [{ "kind": "text", "mimeType": "text/markdown", "text": "The release is ready." }]
  },
  "uploadedArtifactIds": ["artifact-generated-uuid"]
}
```

Worker-reported final states are `completed` or `failed`; the office may additionally finalize an assignment as `cancelled` or `timed_out`. The office stores final deliverables before acknowledging completion. ZIP files are extracted directly into the project workspace with their internal paths preserved and then deleted; non-archive files are copied to the project root. Later deliveries replace matching file paths and preserve unrelated files. No task-specific folder is added. Local file links are attached to the corresponding task and chat message and are available on `/<project-id>/workspace`. The older worker-hosted `artifacts` URL array remains supported for compatibility.
# Registration connectivity upload

After receiving `registered`, the worker sends raw Markdown to
`POST /api/workspace-upload?workspace=<workspace>&name=test.md`.
The worker's `AI_HARNESS_OFFICE_UPLOAD_WORKSPACE` selects the workspace (default `.`).
Send `Authorization: Bearer <AI_HARNESS_WORKER_TOKEN>`, `x-agent-name` with the
registered worker name, `content-length` in bytes, and
`Content-Type: text/markdown; charset=utf-8`. Include the worker name, connection
ID, join timestamp, and a connectivity-test message in the Markdown body.
No task or message ID is required, and the Office does not assign a test task.
This endpoint accepts the same registration key as `/ws/workers`, without a
browser login. The `x-agent-name` must match a currently connected worker.

Once the file is saved, the Office posts a group-chat notice confirming that
the agent joined and can send files. This notice is recorded once per worker
name and is not repeated by upload retries, reconnects, or Office restarts.

Use the Office's HTTP origin: translate `ws://` to `http://` and `wss://` to
`https://`, keeping the host and port. The built-in Office listener uses HTTP;
HTTPS requires a TLS-enabled proxy. Sending HTTPS directly to the HTTP port
produces `HPE_INVALID_METHOD` with a TLS packet beginning `16 03`.

For a local Office on port 8005, configure the worker with:

```dotenv
AI_HARNESS_OFFICE_URL=ws://127.0.0.1:8005/ws/workers
AI_HARNESS_OFFICE_HTTP_URL=http://127.0.0.1:8005
```

`AI_HARNESS_OFFICE_HTTP_URL` is an optional worker override; when omitted,
uploads derive their HTTP(S) origin from `AI_HARNESS_OFFICE_URL`. Remove or
correct a stale HTTPS override when connecting directly to the HTTP listener.
Restart the worker after changing its environment. For a remote worker,
replace `127.0.0.1` with the Office host reachable from that worker.

### Project MCP tools

Task messages include `mcpServers.office_project` with a relative HTTP endpoint and task-scoped authorization header. Resolve it against the Office HTTP origin and connect the assigned agent's MCP client. The tools expose only that project's context, files and conversation summary, plus connected specialists' public capabilities and availability. Credentials expire when the task ends. See [Project context and MCP access](sub-agent-spec.md#project-context-and-mcp-access) for the configuration and tool arguments.


### Shared functional workspace layout

All tasks contribute to one project root, organized into `app/`, `docs/`, `designs/`, `research/`, and `scripts/`. Use `app/` for runnable code and runtime assets, `docs/` for specifications and handoffs, `designs/` for visual design sources, `research/` for findings and datasets, and `scripts/` for standalone utilities.

Do not wrap deliveries in task, worker, date, or repeated project folders. Include exact prerequisite and output paths in assignments. Deliver a ZIP with entries such as `app/index.html`, `app/assets/logo.svg`, and `research/findings.md`, preserving website-relative references. Use a ZIP even for one nested file because raw uploads only accept plain filenames. Existing paths are updated in place; unrelated files remain. The project MCP context and worker assignment carry the same layout policy.

### Worker context authentication and project identity

Workers can use their current registration token as `Authorization: Bearer …` for
read-only `GET /api/memory`, `GET /api/tasks`, and `GET /api/chat` requests, without
a browser session. Include `projectId` in the query string to read the relevant
project. This shared credential also authorizes the file-upload endpoints above;
it does not grant account administration or task/chat/memory mutation access.
Rotating the worker token revokes its
HTTP access immediately.

Project MCP endpoints accept either the registration token or the supplied
short-lived task token. Task tokens remain restricted to their assigned project.
Tool schemas advertise a required `projectId` argument matching the endpoint;
a mismatched payload is rejected. Older clients omitting that argument remain
compatible, using the endpoint's project scope.

Download an existing project file with the worker registration key using
`GET /api/workspace-file-asset?projectId=<project-id>&path=docs/contract.md`.
The path is relative to that project's delivery folder; omit `workspace` when
using `projectId`. The legacy `workspace` query remains for non-project files.
The Office authenticates its own artifact downloads to this endpoint on the first
request, using its listening address or configured `AI_HARNESS_PUBLIC_ORIGIN`.
During task delivery, a project-scoped download must match the task's project.

Task and direct-message envelopes include `context.project` (`id`, `name`) and
`context.task` (`id`, `title`, `workerTaskId`), plus `officeTaskId`. The task is
`null` for general project conversations. Project and task identity also appear
in the message text. Workers should pass this context to their tools per request,
not store it in shared process-wide state when running concurrent tasks.
