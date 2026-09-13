# Agent Worker Integration Specification

This document defines how an Agent Worker integrates with AI Agent Office. It is the normative contract for authentication, registration, task delivery, progress reporting, completion, deliverables, and reconnection.

The worker initiates and owns one persistent WebSocket connection to the office. The office does not submit tasks to worker HTTP endpoints and does not accept HTTP completion callbacks.

## 1. Connection

Connect to:

```text
ws://OFFICE_HOST:OFFICE_PORT/ws/workers
```

Use `wss://` whenever the connection crosses an untrusted network.

Create the credential from **Dashboard → Live Worker Registry → Generate Token**. The generated value is stored by the office and activated immediately. As an alternative bootstrap method, set `AI_HARNESS_WORKER_TOKEN` before the office starts; the environment value seeds the credential only when no stored token exists. If neither source has configured a token, worker registration is disabled.

The generated token is revealed once. Copy it into the worker's secret store before closing the dialog. A worker can provide the credential either:

- In the first message as `credentials.token`.
- In the WebSocket upgrade request as `Authorization: Bearer TOKEN`.

Regenerating the token rotates the credential for future registrations. Existing authenticated sockets remain connected, but they need the new token the next time they reconnect.

Do not place credentials in either the office URL or the worker URL.

The worker must send its registration message within 10 seconds of the WebSocket opening. A worker message may not exceed 2 MiB.

## 2. Registration

The first application message must be a JSON registration envelope:

```json
{
  "type": "register",
  "credentials": {
    "token": "shared-worker-token"
  },
  "worker": {
    "name": "Dave the Developer",
    "description": "Completes coding tasks in its configured workspace.",
    "url": "wss://worker.example.com/agent",
    "capabilities": {
      "skills": [
        {
          "id": "coding-task",
          "name": "Coding Task",
          "description": "Inspect, modify, and validate a software workspace."
        }
      ],
      "tools": [
        "list_files",
        "read_file",
        "write_file",
        "search_files",
        "run_command"
      ],
      "mcp": false,
      "workspaceArtifacts": true
    },
    "model": {
      "provider": "openrouter",
      "name": "openai/gpt-5.6-sol",
      "url": "https://openrouter.ai/api/v1"
    }
  }
}
```

### Required worker fields

| Field | Requirement |
| --- | --- |
| `name` | 1–100 characters. Must start with an alphanumeric character and contain only letters, numbers, spaces, `_`, or `-`. This is the live registry identity. |
| `url` | A credential-free `ws://` or `wss://` URL identifying the worker. It is also the base used to resolve relative deliverable URLs. |
| `capabilities` | An object describing the worker. It must be present even when its collections are empty. |

`description` and `model` are optional. Unknown fields may be ignored.

### Capabilities

- `skills`: array of `{ id, name, description }` objects.
- `tools`: array of tool-name strings.
- `mcp`: whether the worker can use MCP integrations.
- `workspaceArtifacts`: whether the worker can publish workspace deliverables.

The office uses these values for discovery and display. Workers must not claim capabilities they cannot execute.

### Successful registration

```json
{
  "type": "registered",
  "connectionId": "generated-uuid",
  "worker": {
    "name": "Dave the Developer",
    "description": "Completes coding tasks in its configured workspace.",
    "url": "wss://worker.example.com/agent",
    "capabilities": {
      "skills": [],
      "tools": [],
      "mcp": false,
      "workspaceArtifacts": true
    },
    "status": "connected"
  }
}
```

The worker is visible and assignable only while this socket remains connected. Registering a new connection with the same worker name replaces the old connection and fails unfinished tasks belonging to the old socket.

## 3. Task delivery

The office sends each assignment over the registered socket. Every task includes a task-specific artifact upload credential:

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
    "parts": [
      {
        "kind": "text",
        "mimeType": "text/plain",
        "text": "Prepare and validate the release."
      }
    ]
  }
}
```

- `taskId` identifies the execution and must be copied into every update.
- `message.messageId` identifies the assignment message. Copy it to `inReplyTo` when sending updates.
- `priority` is `low`, `medium`, or `high`.
- Task instructions are found in text parts of `message.parts`.
- `artifactUpload.token` is unique to this task. Do not log, reuse, or send it in a task update.
- For a dependent task, the office prepends a `Prerequisite work` section containing completed upstream results and delivered-file references. Treat that section as input to the current task and continue from it instead of repeating the prerequisite work. Relative `/files/…` URIs resolve against the office server's HTTP origin (the same host and port used for this WebSocket connection, with `ws`/`wss` changed to `http`/`https`).

A worker may receive more than one task on the same connection. It must either process them concurrently or maintain its own queue without blocking the socket receive loop.

### Task cancellation

The office can stop an active assignment by sending:

```json
{
  "type": "task_cancel",
  "taskId": "task-generated-uuid",
  "inReplyTo": "msg-generated-uuid",
  "reason": "Task stopped by the office manager."
}
```

On receipt, the worker must abort the matching model request, command, child process, and pending artifact upload, then release its task resources. The office marks the task `cancelled` immediately, so no cancellation acknowledgement is required. A late `task_update` is ignored and acknowledged with state `cancelled`; it cannot overwrite the cancelled result.

### Direct questions

A simple question addressed to a worker in `#central-office` does not create a task. The office sends it as a direct message on the same socket:

```json
{
  "type": "direct_message",
  "message": {
    "messageId": "direct-generated-uuid",
    "role": "user",
    "parts": [{ "kind": "text", "mimeType": "text/plain", "text": "@dave what version are you using?" }]
  }
}
```

The worker should answer with a correlated response:

```json
{
  "type": "direct_message_response",
  "inReplyTo": "direct-generated-uuid",
  "message": {
    "messageId": "reply-generated-uuid",
    "role": "agent",
    "parts": [{ "kind": "text", "mimeType": "text/plain", "text": "Version 1.2.3." }]
  }
}
```

The response text is posted to `#central-office`, and the office replies with `{"type":"direct_message_ack","messageId":"direct-generated-uuid","state":"completed"}`. Direct messages do not use `taskId` or accept deliverables. Ordinary direct questions do not create task or memory records. The worker appears as `is typing` until it replies; active task work takes precedence and appears as `busy`.

The office also uses `direct_message` for periodic progress checks on long-running tasks. These messages identify the task in their text and ask for completed progress, blockers, next step, and ETA. Reply promptly without stopping the ongoing task; the Office Manager reviews the response and records it in office memory.

## 4. Progress updates

Send zero or more progress messages while work is running:

```json
{
  "type": "task_update",
  "taskId": "task-generated-uuid",
  "inReplyTo": "msg-generated-uuid",
  "status": {
    "state": "working"
  },
  "message": {
    "messageId": "update-generated-uuid",
    "role": "agent",
    "parts": [
      {
        "kind": "text",
        "mimeType": "text/markdown",
        "text": "Implementation is complete; tests are running."
      }
    ]
  }
}
```

Accepted non-final states are `accepted`, `working`, and `progress`. The office normalizes all three to `working`. Text from progress updates is posted to `#central-office` and recorded in office memory.

Every accepted update receives:

```json
{
  "type": "task_update_ack",
  "taskId": "task-generated-uuid",
  "state": "working"
}
```

An acknowledgement means the office accepted the update. It does not authorize the worker to stop processing.

## 5. Successful completion and deliverables

Upload each deliverable before sending the final update:

```http
POST /api/worker-artifacts?taskId=task-generated-uuid&name=release.zip HTTP/1.1
Authorization: Bearer task-specific-upload-token
Content-Type: application/octet-stream

<raw file bytes>
```

The filename must be a plain filename, each file may be at most 100 MB, and a task may upload at most 100 files. A successful upload returns:

```json
{
  "ok": true,
  "artifactId": "artifact-generated-uuid",
  "name": "release.zip",
  "mimeType": "application/zip",
  "size": 12480
}
```

Keep every returned `artifactId` and reference it in the final WebSocket update:

A successful task ends with exactly one `completed` update:

```json
{
  "type": "task_update",
  "taskId": "task-generated-uuid",
  "inReplyTo": "msg-generated-uuid",
  "status": {
    "state": "completed"
  },
  "message": {
    "messageId": "result-generated-uuid",
    "role": "agent",
    "parts": [
      {
        "kind": "text",
        "mimeType": "text/markdown",
        "text": "The release is ready. All tests passed."
      }
    ]
  },
  "uploadedArtifactIds": ["artifact-generated-uuid"]
}
```

The upload token expires when the task completes, fails, times out, or is cancelled. Uploads made with another task's token, unknown artifact IDs, and IDs from another task are rejected. Unreferenced staged uploads are deleted when the task ends.

For backward compatibility, the office also accepts the older `artifacts` array containing worker-hosted HTTP(S) file URLs. New integrations should use `artifactUpload` and `uploadedArtifactIds` so workers do not need to host files.

Legacy artifact requirements:

- `artifacts` must be an array when provided.
- Every artifact part must have `kind: "file"` and a `file` object.
- A file URI must resolve to HTTP or HTTPS. Relative URIs are resolved against the registered worker URL after translating `ws` to `http` and `wss` to `https`.
- `mimeType` should describe the downloadable file accurately.
- `metadata` is optional and may contain JSON-compatible values such as byte size or file count.

The office downloads each deliverable before completing the task. ZIP archives are safely extracted directly into the project workspace, preserving their internal paths; the downloaded ZIP is deleted after extraction. Non-archive files are copied into the project root. No task-specific folder is added. Later deliveries replace matching file paths and preserve unrelated files. Tasks without a project use central-office. The local files appear on `/<project-id>/workspace`, and their local links are attached to the task, posted in `#central-office`, and recorded in memory.

Downloads are limited to 100 MB per artifact and ZIP expansion is limited to 500 MB and 5,000 entries. Encrypted archives, symbolic links, path traversal, and unsupported compression methods are rejected. A task is marked failed if its delivered work cannot be stored safely.

The worker must keep each published URI available until the office returns the final `task_update_ack`. That acknowledgement is sent only after the deliverable has been downloaded and stored.

## 6. Failed completion

Report an unrecoverable task failure with:

```json
{
  "type": "task_update",
  "taskId": "task-generated-uuid",
  "inReplyTo": "msg-generated-uuid",
  "status": {
    "state": "failed"
  },
  "error": {
    "message": "The test suite failed after three attempts."
  },
  "message": {
    "messageId": "failure-generated-uuid",
    "role": "agent",
    "parts": [
      {
        "kind": "text",
        "mimeType": "text/markdown",
        "text": "Two integration tests still fail in the authentication module."
      }
    ]
  }
}
```

`error.message` is preferred. If it is absent, the office uses a string `error`, then the text message, then a generic failure description. Deliverables are accepted only for successful completion.

## 7. Heartbeats

The office sends a standard WebSocket ping every 15 seconds and marks the worker offline if the next heartbeat interval passes without any response or other socket activity. Standards-compliant WebSocket clients answer these ping frames automatically. A worker may also send an application heartbeat:

```json
{ "type": "ping" }
```

The office responds:

```json
{ "type": "pong", "at": 1760000000000 }
```

Workers should use heartbeats when intermediaries may close idle sockets.

## 8. Errors and close behavior

Protocol errors are returned when possible:

```json
{
  "type": "error",
  "error": "Worker credentials were rejected."
}
```

The office then closes the invalid connection. Relevant application close codes are:

| Code | Meaning |
| --- | --- |
| `4000` | Registration was not completed within the allowed time. |
| `4001` | A newer socket registered the same worker name. |
| `4002` | Authentication, registration, JSON, message size, or task-update protocol error. |

When a connection closes, all unfinished tasks assigned to that exact connection fail. Reconnecting does not resume those tasks automatically. The worker should reconnect with exponential backoff and register again; the office manager can then issue new assignments.

## 9. Correlation and validation rules

- Only the socket that received a task may update it.
- `taskId` must match a task currently known to that socket.
- When supplied, `inReplyTo` must match the original `message.messageId`.
- Final states are `completed` and `failed`.
- Send JSON text frames. Binary application messages are not part of this protocol.
- Keep processing, network I/O, and artifact generation outside the socket message callback so incoming heartbeats and additional tasks remain responsive.

## 10. Minimal worker lifecycle

```text
connect /ws/workers
  → send register + credentials + capabilities
  ← receive registered
  ← receive task
  → send task_update: working
  ← receive task_update_ack: working
  → execute and validate work
  ← optionally receive task_cancel, abort work, and send no further result
  → publish deliverable files over HTTP(S)
  → send task_update: completed | failed
  ← receive task_update_ack: completed | failed
  → remain connected for more tasks
```

## 11. Operational checklist

- Generate the office token and copy its value into the worker secret store (commonly as `AI_HARNESS_WORKER_TOKEN`).
- Use TLS (`wss://` and `https://`) outside a trusted local network.
- Give every worker a stable, unique name.
- Declare accurate skills, tools, model information, and artifact support.
- Preserve `taskId` and `messageId` for the entire execution.
- Handle `task_cancel` by aborting all work associated with its `taskId`.
- Emit useful progress text without flooding the channel.
- Validate work before reporting `completed`.
- Publish deliverables before sending the completion message.
- Implement reconnect backoff and treat disconnected in-flight tasks as failed.
- Never fall back to the removed HTTP POST/callback protocol.

For a shorter message-only reference, see [Worker WebSocket API](./worker-websocket-api.md).

### Project context and MCP access

Every assignment prepends the project description, current project files, and known prerequisite-file provenance. Files are listed with `/files/<project-id>/…` URLs. Inspect and reuse completed work before implementing the assignment.

Assignments also include a task-scoped MCP configuration:

```json
{
  "mcpServers": {
    "office_project": {
      "type": "http",
      "url": "/mcp/projects/<project-id>/tasks/<task-id>",
      "headers": { "Authorization": "Bearer <task-specific-token>" }
    }
  }
}
```

Workers must resolve the URL against their Office connection's HTTP origin (`ws` → `http`, `wss` → `https`) and connect using an MCP Streamable HTTP client. Attach these tools to the agent handling that task. Keep configurations separate for concurrent tasks; do not log credentials or reuse them for another project. Access expires when the task terminates.

Available read-only tools:

- `project_get_context`: project description, status, and task queue.
- `project_list_files`: current files, static download URLs, and completed-task provenance; optional project-relative folder `path`. Up to 500 files per call; query individual subfolders if truncated.
- `project_read_file`: UTF-8 file contents; required project-relative `path`, optional character `offset`. Responses contain up to 64,000 characters and a `nextOffset`; text previews are limited to 2 MB.
- `project_list_agents`: connected specialists and availability; optional `skill` filter. Worker capabilities are office-wide, but other projects' tasks and conversations are not exposed.
- `project_conversation_summary`: an extractive summary of the latest 100 project messages, recent user requests, manager updates, and task outcomes. Excerpts are bounded and explicitly marked as such.

The endpoint supports MCP initialization, ping, and tool discovery/calls using JSON responses. It supports protocol versions `2025-11-25`, `2025-06-18`, and `2025-03-26`; no SSE subscription is provided. Every request requires valid task credentials, and project paths cannot escape the assigned workspace. The transport follows the [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).


### Shared functional workspace layout

All tasks contribute to one project root, organized into `app/`, `docs/`, `designs/`, `research/`, and `scripts/`. Use `app/` for runnable code and runtime assets, `docs/` for specifications and handoffs, `designs/` for visual design sources, `research/` for findings and datasets, and `scripts/` for standalone utilities.

Do not wrap deliveries in task, worker, date, or repeated project folders. Include exact prerequisite and output paths in assignments. Deliver a ZIP with entries such as `app/index.html`, `app/assets/logo.svg`, and `research/findings.md`, preserving website-relative references. Use a ZIP even for one nested file because raw uploads only accept plain filenames. Existing paths are updated in place; unrelated files remain. The project MCP context and worker assignment carry the same layout policy.
