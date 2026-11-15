# Office WebSocket v2: worker upgrade guide

This is the implemented **Office WebSocket protocol version 2.0**. It borrows A2A lifecycle and content concepts but is **not an official A2A binding**. Standard A2A agents should continue using the existing Agent Card integration.

Workers still initiate an outbound connection to `ws://HOST/ws/workers` or `wss://HOST/ws/workers`. No inbound worker HTTP service, SDK, or npm dependency is required.

## Compatibility and migration

| Concern | Existing v1 worker | Opt-in v2 worker |
|---|---|---|
| Registration | No version, or `1.0` | Top-level `protocolVersion: "2.0"` |
| Task/disconnect | Task fails when socket disconnects | Task survives; reconcile on reconnect |
| Content | `kind`, `mimeType`, legacy roles | `text` or `data` parts; optional `mediaType` and `filename` |
| Questions | Separate direct-message exchange | Normal task envelope with `direct: true` |
| Clarification | Progress text only | `input_required` / `auth_required`, then `task_continue` |
| Cancellation | Immediately marked cancelled locally | Pending until worker reports a terminal outcome or rejects cancellation |
| Results | Uploaded file IDs | Uploaded file IDs plus inline/incremental artifacts |
| Recovery | No durable task reconciliation | `task_get` → authoritative `task_snapshot` |
| Duplicate events | Limited terminal-state protection | Durable sequence watermark and recent event receipts |

Drain active v1 tasks and disconnect the old worker before upgrading the same worker name. A registered v2 identity cannot silently downgrade to v1. Worker names must be unique across A2A, v1 and v2. Existing v1 workers need no changes.

## 1. Credentials and registration

In **Add member → WebSocket agent**, generate the shared Office worker token. Generating a replacement changes the credential used for new connections and shared-token HTTP requests. Existing connections are not forcibly terminated by token rotation.

Generate and persist a separate random **resume token** on the worker before its first v2 registration (32 random bytes encoded as base64url is recommended). This proves continuity of the named worker on reconnect. Keep it private alongside the shared Office token.

```json
{
  "type": "register",
  "protocolVersion": "2.0",
  "credentials": {
    "token": "OFFICE_SHARED_WORKER_TOKEN",
    "resumeToken": "worker-generated-persistent-secret-1234567890"
  },
  "worker": {
    "name": "Builder",
    "url": "wss://office.example.com/ws/workers",
    "description": "Builds and validates project deliverables.",
    "capabilities": {
      "skills": [{ "id": "build", "name": "Build", "description": "Implement software changes." }],
      "tools": ["read_file", "run_command"],
      "mcp": true,
      "workspaceArtifacts": true,
      "inputModes": ["text/plain"],
      "outputModes": ["text/*", "application/json"],
      "structuredResults": true,
      "artifactUpdates": true
    }
  }
}
```

The shared token can alternatively be supplied in the HTTP Upgrade `Authorization: Bearer …` header. The resume token belongs in `credentials.resumeToken`. It must contain 32–128 base64url characters. If omitted on first registration, Office generates one, but a lost registration response can then leave the worker without its reconnect credential. Generating it locally avoids that failure.

Office returns:

```json
{
  "type": "registered",
  "connectionId": "connection-uuid",
  "protocolVersion": "2.0",
  "features": ["recovery", "continuation", "confirmedCancellation", "contexts", "deduplication"],
  "resumeToken": "worker-generated-persistent-secret-1234567890",
  "limits": {
    "messageBytes": 2097152,
    "inlineArtifactBytes": 1048576,
    "partsBytes": 262144
  },
  "worker": {
    "name": "Builder",
    "protocol": "websocket",
    "protocolVersion": "2.0",
    "binding": "WebSocket v2",
    "status": "connected"
  }
}
```

The actual `worker` object also contains its normalized description, URL and capabilities. Verify `protocolVersion` before accepting work. All five `features` above are required behavior for v2. `structuredResults` and `artifactUpdates` are opt-in booleans; Office rejects their use unless advertised. Input/output modes must be nonempty arrays. Office requires text input; output parts must match advertised output modes (`text/*` and `*/*` wildcards are supported).

A subsequent connection must supply both the current Office shared token and the persisted resume token. A wrong/missing resume token does not replace the current worker. A new valid connection supersedes the previous socket. Keep worker identity stable across restarts. If a resume token is lost, there is no per-worker reset endpoint yet: reconcile old work operationally before provisioning a new worker name. Do not reset the entire Office merely to rotate a worker identity.

## 2. Receive work and persist before executing

```json
{
  "type": "task",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "projectId": "project-1",
  "officeTaskId": "office-task-1",
  "priority": "medium",
  "direct": false,
  "message": {
    "messageId": "message-123",
    "role": "user",
    "parts": [{ "text": "Build the report." }]
  }
}
```

Actual assignments may also include `context`, `artifactUpload` and `mcpServers` as in the [existing file and MCP contract](worker-websocket-api.md). Inputs are text instructions and project context; use the task-scoped Office tools to fetch project files. These are not A2A-style attached binary input parts.

- Office generates `taskId`, `contextId`, and outbound `messageId`.
- `contextId` is stable for one worker/project pair, including direct conversations and follow-up tasks. It is not an authorization credential. Keep per-task execution isolated even when context is shared.
- Persist the task, its context, received message ID and initial state **before** starting side effects.
- Deduplicate received task/continuation commands by task ID and message ID. Repeated commands must not start another execution.
- `direct: true` identifies a chat question. It uses the same lifecycle, snapshots and result format as ordinary work; Office posts its answer to chat instead of creating a task-board entry.
- Missing `direct` is equivalent to false. Do not send v1 `direct_message_response` frames for v2 work.

## 3. Status and event delivery

Every task has one increasing integer `sequence`, shared across status and artifact updates. Start with 1. Generate a unique `eventId` and persist the **exact event payload** before sending it.

```json
{
  "type": "task_update",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "eventId": "event-1",
  "sequence": 1,
  "state": "working",
  "message": { "role": "agent", "parts": [{ "text": "Running checks." }] }
}
```

```json
{
  "type": "task_update_ack",
  "taskId": "task-123",
  "eventId": "event-1",
  "sequence": 1,
  "state": "working"
}
```

Supported worker states:

| State | Meaning |
|---|---|
| `submitted` | Accepted/queued, not yet executing |
| `working` | Execution in progress |
| `input_required` | Pause and ask a question |
| `auth_required` | Pause for external authorization |
| `completed` | Work and deliverables are complete |
| `failed` | Execution failed |
| `cancelled` | Execution was actually stopped |
| `rejected` | Worker declined the assignment |

Use these lowercase values for **Office v2**, not A2A's `TASK_STATE_*` wire enum values. `timed_out` is Office-local and must not be emitted by the worker.

A status message is optional but should explain pauses, failures and rejections. Each part contains exactly one of `text` (string) or `data` (JSON). `data` requires `structuredResults: true`. Do not use `kind`, `mimeType`, `raw` or `url` in v2 inline parts.

Retry unacknowledged events with identical content, sequence and event ID. Office persists the sequence watermark and the most recent 256 event hashes. Exact recent retries are acknowledged with `duplicate: true`, including after reconnect/restart. Reusing a recent event ID with different serialized content produces `EVENT_CONFLICT`. Older events at or below the watermark are ignored and acknowledged as duplicates; their contents are not re-applied. This prevents duplicate appends; it is not an exactly-once guarantee for worker side effects.

If Office returns `SEQUENCE_GAP`, request reconciliation with `{"type":"task_sync"}` and answer the resulting `task_get` requests. Do not skip ahead with ordinary updates. Terminal task results are immutable; later ordinary updates cannot replace them.

## 4. Clarification and authorization

Send `input_required` or `auth_required` with a useful question/instruction. Office leaves the assignment open and pauses its local waiting timer. A task-board reply, or a reply to a paused direct conversation, produces:

```json
{
  "type": "task_continue",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "message": {
    "messageId": "new-message-456",
    "role": "user",
    "parts": [{ "text": "Use the blue variant." }]
  }
}
```

Persist the new message ID and resume the existing task. Keep its sequence counter and context; do not create another job. Authorization itself happens out of band: `auth_required` does not perform OAuth or supply external service secrets automatically. Continuation resets Office's waiting deadline to 30 minutes.

## 5. Confirm or reject cancellation

```json
{
  "type": "task_cancel",
  "requestId": "cancel-1",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "reason": "Task stopped by the office manager."
}
```

Office shows cancellation as pending. Persist/deduplicate `requestId`, stop the model request, tools and child processes, then send the next sequenced `task_update` with `state: "cancelled"`. Do not confirm while execution continues. If completion won the race, report the actual completed result.

If cancellation cannot be performed:

```json
{
  "type": "task_cancel_response",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "requestId": "cancel-1",
  "error": { "code": "NOT_CANCELABLE", "message": "The final transaction is already committing." }
}
```

Office acknowledges with `task_cancel_response_ack`, clears the pending request and exposes the error in task details. The task remains active. Repeated operator cancellation while pending uses the same request ID. After reconnection, Office resends a pending cancellation only after reconciling a nonterminal snapshot. A disconnection, timeout or failed send never proves the task stopped.

## 6. Structured results and incremental artifacts

For a structured chat/result message:

```json
{
  "type": "task_update",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "eventId": "result-2",
  "sequence": 2,
  "state": "completed",
  "message": { "parts": [{ "data": { "passed": 12, "failed": 0 }, "mediaType": "application/json" }] }
}
```

Message data is retained and rendered as JSON text. Use artifacts to deliver files. Artifact updates require `artifactUpdates: true`:

```json
{
  "type": "artifact_update",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "eventId": "artifact-1",
  "sequence": 1,
  "append": false,
  "artifact": {
    "artifactId": "report",
    "name": "report.txt",
    "parts": [{ "text": "First section.\n", "filename": "report.txt", "mediaType": "text/plain" }]
  }
}
```

Office responds with `artifact_update_ack`. Use the same artifact ID with `append: true` for subsequent chunks; `append: false` replaces the artifact. Consecutive text parts with the same filename and media type are concatenated at materialization. Data parts are separate JSON outputs. Artifacts are accumulated durably but are imported into the project only on completion.

A `task_update` may supply `artifacts` as a complete replacement array. Omitting it preserves accumulated artifacts; supplying `[]` clears them. `artifactId` must be stable and unique within the task. Use explicit filenames for predictable output names.

Binary and large files retain the v1 HTTP upload path: upload bytes using the latest `artifactUpload` credential and return `uploadedArtifactIds` on completion. ZIP uploads preserve directory structure. Inline artifacts and referenced uploads are staged together through the existing atomic workspace import. If import fails, Office returns an error without advancing the event sequence or marking the task complete; fix/reupload and retry.

Limits:

- Socket JSON message/frame buffer: 2 MiB; avoid batching frames beyond this limit.
- Each `parts` array: 1–100 parts and 256 KiB serialized JSON, including accumulated parts of an artifact.
- Inline artifact collection: at most 100 artifacts and 1 MiB serialized JSON. This keeps complete recovery snapshots below the socket limit.
- Artifact IDs: nonempty strings up to 200 characters. Event IDs: nonempty strings up to 200 characters.
- Filenames: plain names, at most 255 characters; use uploaded ZIPs for nested paths.
- Combined delivery: 100 MiB before ZIP expansion; existing ZIP restrictions and expansion limits still apply.

## 7. Reconnect and restart recovery

A disconnect removes worker availability for new assignments but preserves existing v2 task records. Reconnect with exponential backoff/jitter and the same identity credentials. After `registered`, Office sends one `task_get` for each active or locally timed-out task:

```json
{
  "type": "task_get",
  "requestId": "snapshot-request-1",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "lastSequence": 1,
  "lastCommandMessageId": "message-123",
  "uploadsReset": true
}
```

The actual request includes fresh `artifactUpload`/MCP credentials when configured. **Every `task_get` resets the task's upload session.** Old upload IDs/tokens must be discarded; reupload any pending deliverables before reporting completion. This also applies to explicit `task_sync`, which reconciles all unfinished/timed-out tasks for the worker.

Answer with the full authoritative snapshot before sending more events:

```json
{
  "type": "task_snapshot",
  "requestId": "snapshot-request-1",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "eventId": "snapshot-event-1",
  "sequence": 4,
  "state": "working",
  "message": { "parts": [{ "text": "Still building; connection restored." }] },
  "artifacts": []
}
```

A snapshot must include the full `artifacts` array, even when empty. Its sequence is the latest durable task event sequence (0 if none), and must be at least Office's `lastSequence`. Snapshots may bridge gaps. Snapshot event IDs are unique to a response; a retransmission of that response must remain byte-for-byte equivalent in its parsed JSON serialization. Office acknowledges with `task_snapshot_ack`, including the request/event IDs and sequence. After acknowledgment, continue with `sequence + 1`.

If your task store genuinely has no record:

```json
{
  "type": "task_snapshot",
  "requestId": "snapshot-request-1",
  "taskId": "task-123",
  "contextId": "context-project-1",
  "error": { "code": "TASK_NOT_FOUND", "message": "No durable task record exists." }
}
```

Office reports failure/uncertainty; it does not automatically replay the original task or continuation. Inspect `lastCommandMessageId` to determine whether your durable message log contains Office's most recent command. If a continuation was not received, report your actual paused state and let the user resume again. Do not invent completion or silently restart work to hide missing state.

Office persists identities, contexts, task state, inline artifacts and deduplication receipts in its SQLite database. The worker must independently persist tasks, message IDs, event sequence, unacknowledged events and final artifacts. A snapshot is authoritative task retrieval, not a request to execute the job again. Worker process restart recovery of its actual tools/processes remains the worker implementation's responsibility.

Default Office waiting limits are 30 minutes for assignments and 5 minutes for direct questions; configured limits are bounded to 60 minutes. Disconnection does not extend the deadline. Paused tasks suspend the waiting timer. A local timeout does not cancel remote execution; retain state and report the eventual terminal outcome on reconciliation. Office can reconcile that outcome after a timeout. There is no automatic task-retention purge in the current Office implementation; define retention and backups operationally.

## 8. Errors and transport behavior

Application errors after successful v2 registration return a `type: "error"` frame with `code`, `error`, and available task/event/request IDs. They do not normally close the socket. Useful codes include `INVALID_STATE`, `INVALID_PARTS`, `INVALID_ARTIFACT`, `UNSUPPORTED_CONTENT`, `CAPABILITY_REQUIRED`, `TASK_NOT_FOUND`, `SYNC_REQUIRED`, `SEQUENCE_GAP`, `STALE_SNAPSHOT`, `EVENT_CONFLICT`, and `LIMIT_EXCEEDED`. Fix the cause; do not advance sequence on rejection. Storage errors may use `INVALID_REQUEST` with a specific explanation.

Malformed JSON, oversized frames, failed authentication or invalid registration close the connection. Registration must arrive within 10 seconds. Reply to WebSocket ping control frames; Office sends a heartbeat every 15 seconds and disconnects unresponsive workers. An application `{"type":"ping"}` receives `pong`, but use a WebSocket library/runtime that handles control pings correctly.

The shared token grants the same legacy HTTP privileges as before. The resume token binds reconnects to a worker name; it does not replace the shared token or grant HTTP access. Do not log either credential. Use TLS outside trusted local environments.

## 9. Upgrade acceptance checklist

1. Verify an unchanged v1 worker still registers and completes work.
2. Register v2 and verify the selected version, optional capabilities and stored resume token.
3. Persist a task before execution; process duplicate outbound message IDs without repeating side effects.
4. Send status and artifact events; retry identical events and verify one append/import.
5. Pause for input and authorization; resume the same task/context with a new message ID.
6. Confirm cancellation only after stopping execution; test rejection and completion/cancel races.
7. Disconnect during execution; reconnect with the resume token and answer snapshots without resubmission.
8. Restart Office and the worker independently; recover task state, sequence and final output.
9. Reupload pending binary files after `uploadsReset`; verify mixed inline/uploaded delivery.
10. Exercise a missing task, sequence gap, stale socket, wrong context, wrong resume token, unsupported media type and artifact import failure.
11. Confirm structured direct replies reach chat and task results reach the assigned project.
12. Verify a timed-out task is not implicitly cancelled or automatically executed twice.

Run Office's regression fixtures with:

```sh
node --test test/ws-v2.test.mjs test/worker-disconnect.test.mjs test/dual-worker-integration.test.mjs test/a2a.test.mjs
```

These tests exercise Office and its fixtures; run the checklist against your actual worker too.

Implementation: [v2 task manager](../lib/ws-v2-agents.js), [socket handler](../lib/worker-ws.js), [transport routing](../lib/sub-agents.js), [artifact materialization](../lib/a2a-artifacts.js). Protocol inspiration: [A2A v1.0](https://a2a-protocol.org/v1.0.0/specification/).
