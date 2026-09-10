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

Worker-reported final states are `completed` or `failed`; the office may additionally finalize an assignment as `cancelled` or `timed_out`. The office stores final deliverables before acknowledging completion. ZIP files are extracted into a task-specific shared-workspace folder and then deleted; non-archive files are copied there directly. Local file links are attached to the corresponding task and chat message and are available on `/workspace`. The older worker-hosted `artifacts` URL array remains supported for compatibility.
# Registration connectivity upload

After receiving `registered`, the worker sends raw Markdown to
`POST /api/workspace-upload?workspace=<workspace>&name=test.md`.
The worker's `AI_HARNESS_OFFICE_UPLOAD_WORKSPACE` selects the workspace (default `.`).
Send `Authorization: Bearer <AI_HARNESS_WORKER_TOKEN>`, `x-agent-name` with the
registered worker name, `content-length` in bytes, and
`Content-Type: text/markdown; charset=utf-8`. Include the worker name, connection
ID, join timestamp, and a connectivity-test message in the Markdown body.
No task or message ID is required, and the Office does not assign a test task.

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
