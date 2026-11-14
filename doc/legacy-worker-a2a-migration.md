# Legacy worker migration specification: Agent Office and A2A v1.0

**Audience:** maintainers of worker clients written for Agent Office before the A2A refactor.  
**Target:** the current Agent Office implementation, using A2A protocol v1.0.  
**Guide revision:** 1.0 — November 14, 2026.  
**Status:** optional A2A migration guide, suitable for handing to a worker development team. Office also supports the [existing WebSocket integration](worker-websocket-api.md); migration is not required to keep using it.

## 1. Required outcome

Convert the legacy worker from an Office-specific WebSocket client into an A2A server. Keep the worker's existing model, tools, execution engine and local workspace where practical. Replace its registration, transport, task lifecycle and result-delivery boundary.

After migration, an Office administrator must be able to enter the worker's Agent Card URL, optionally configure its credentials, assign work, receive results, and continue or cancel an assignment without installing an Office-specific worker plugin.

Office is the **A2A client**. The worker is the **A2A server**. Office does not currently expose the Office Manager as an A2A server.

The [A2A v1.0 specification](https://a2a-protocol.org/v1.0.0/specification/) governs the protocol. This guide describes the subset Office exercises and its additional integration constraints. “Required for Office” means required for this integration; it does not redefine the A2A standard or imply that passing this guide's checklist certifies full protocol conformance. Implement the other applicable server requirements in the upstream specification as well.

Office has no npm dependencies. This migration does not require a particular language, framework, SDK, or npm package in the worker.

## 2. Architecture and ownership

```text
Office administrator
    │ adds worker URL and optional credentials
    ▼
Agent Office — A2A client
    │ GET Agent Card
    │ SendMessage / SendStreamingMessage
    │ GetTask / CancelTask
    ▼
Worker HTTPS service — A2A server
    │ authenticated request → task/context store → existing execution engine
    └ response / event stream → messages, status and artifacts
```

The worker must run an HTTP(S) service reachable **from the Office server**, not merely from the user's browser. A worker on a laptop or behind NAT needs a reachable endpoint or reverse proxy. A reverse proxy must preserve the A2A routes, headers and SSE response stream.

The worker owns remote task IDs, context IDs, execution, authorization, task history and recoverable results. Office owns its project/task board, assignment records, scheduling and imported deliverables. The two systems do not share local filesystem paths or process state.

A2A does not specify a “join Office” call. Office registration is an administrative configuration step; the agent does not need to implement it.

## 3. Legacy-to-A2A mapping

| Legacy Office worker behavior | Required migration |
|---|---|
| Open a persistent socket to `/ws/workers` | Expose an A2A HTTP(S) service and Agent Card. Office initiates requests. |
| Send `register` with `worker` and `credentials` | Publish capabilities in the Agent Card. Configure authentication on the agent service. |
| Receive `registered` / `connectionId` | No equivalent handshake. Successful discovery makes the agent available in Office. |
| Share `AI_HARNESS_WORKER_TOKEN` for registration | Use per-agent bearer credentials or configured authentication headers. The credential authorizes Office to call the worker. |
| Receive `type: "task"` with Office-generated `taskId` | Receive `SendMessage` or `SendStreamingMessage`; generate the remote task/context IDs on the server. |
| Assignment `message.role: "manager"` | Accept `message.role: "ROLE_USER"`. |
| Return `role: "agent"` | Return `role: "ROLE_AGENT"`. |
| Text parts use `kind: "text"` and `mimeType` | Use native v1.0 parts such as `{"text":"..."}`; use `mediaType` when applicable. |
| Emit `task_update` and wait for `task_update_ack` | Update the stored A2A Task; return it through polling or publish standard stream envelopes. No Office acknowledgment message exists. |
| `accepted`, `working`, `progress`, `completed`, `failed` strings | Use v1.0 `TASK_STATE_*` enum names on the wire. |
| Use `inReplyTo` to correlate every update | Correlate RPC responses by request `id`, messages by `messageId`, and task events by `taskId`/`contextId`. |
| Separate `direct_message` / `direct_message_response` protocol | Use the same A2A message operations; an immediate reply can return a Message without creating a Task. |
| Receive `task_cancel`, stop without acknowledgment | Handle `CancelTask`; return the actual resulting Task or the applicable protocol error. |
| Upload to `artifactUpload.url`, return `uploadedArtifactIds` | Return native A2A artifacts containing text, data, base64 bytes or URLs. |
| Receive injected `mcpServers`, `workspace`, `projectId`, `officeTaskId` transport fields | Read the assignment's standard message parts. Do not require these custom fields. |
| Fail all work when a socket disconnects | Keep execution/task state independent of the stream. Permit later `GetTask` recovery. |
| Reconnect and re-register with heartbeat messages | No custom heartbeat or reconnect protocol. Keep the service available and the task store recoverable. |
| Send custom `activity` model/tool/MCP telemetry | Keep internal telemetry locally; communicate useful user-facing progress through A2A status messages. |

The `/ws/workers` and `/api/worker-token` registration flows remain available for Office WebSocket workers, but are not used by A2A agents. The dashboard's `/ws` is not an alternate worker endpoint. This is also **not** a migration to A2A v0.3: do not implement the older `message/send`, `tasks/get`, `kind`-based schemas or lowercase role/state values as the target wire contract.

## 4. Agent Card and discovery

### 4.1 Discovery URL

Provide one of these to the Office administrator:

- A base URL such as `https://builder.example.com`. Office fetches `/.well-known/agent-card.json` at that origin.
- A full JSON URL such as `https://builder.example.com/agents/builder/card.json`.
- For a nonstandard discovery path, use the administrative API's `cardPath` option. An empty `cardPath` fetches the configured URL exactly.

Office sends `A2A-Version: 1.0` when fetching the card. Discovery must finish within 15 seconds. Office does not follow redirects; provide the final URL directly.

### 4.2 Example card

This is a basic card for a nonstreaming text/file worker. It illustrates discovery and capabilities, not a production authentication configuration. Add the upstream security declarations appropriate to the authentication actually enforced by your service.

```json
{
  "name": "Builder",
  "description": "Implements requested project changes and returns deliverables.",
  "version": "2.0.0",
  "supportedInterfaces": [
    {
      "url": "https://builder.example.com/a2a",
      "protocolBinding": "JSONRPC",
      "protocolVersion": "1.0"
    }
  ],
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "extendedAgentCard": false
  },
  "defaultInputModes": ["text/plain", "application/octet-stream"],
  "defaultOutputModes": ["text/plain", "application/json", "application/octet-stream", "application/zip"],
  "skills": [
    {
      "id": "implement-project-change",
      "name": "Implement project changes",
      "description": "Read supplied inputs, implement changes, and return updated files.",
      "tags": ["development", "testing"]
    }
  ]
}
```

Required for Office:

- A nonempty name, agent implementation version, capabilities object, skills array and nonempty default input/output mode arrays.
- At least one `supportedInterfaces` entry using `JSONRPC` or `HTTP+JSON`, with protocol version `1.0` or `1.0.x`. Office chooses the first compatible entry in card order.
- Text input support for Office assignments. Prefer `text/plain`; Office also recognizes `text`, `text/*` and `*/*` for task text.
- For binary project inputs, put `application/octet-stream` or `*/*` in **defaultInputModes**. The current file attachment implementation checks these default modes.
- An absolute HTTP(S) endpoint without embedded username/password credentials or a URL fragment.
- No required application-specific extension: Office rejects unknown required extensions.

The card's `version` is the worker software version. `supportedInterfaces[].protocolVersion` is the A2A protocol version. They serve different purposes.

Declare `streaming: true` only after implementing the streaming operations. Otherwise Office will choose a stream your worker cannot serve.

### 4.3 Register with Office

An administrator uses **Agent workers → Connect agent**, or **Add member → Add agent**. The equivalent Office administration request is:

```http
POST /api/sub-agents HTTP/1.1
Host: office.example.com
Content-Type: application/json
Cookie: office_session=ADMIN_SESSION

{"url":"https://builder.example.com","name":"Builder","token":"AGENT_BEARER_TOKEN"}
```

This request goes to **Office**, not to the agent. `name` is an optional local alias; otherwise Office uses the card's name. For an API key, use `headers`, for example `{"X-Agent-Key":"AGENT_API_KEY"}`, instead of `token`. Re-register the same name and URL with the complete credential configuration to update credentials.

The administrator retains the Office session. Do not put that session in the worker. The agent bearer token is a credential accepted by the worker service, not a replacement Office administrator credential.

## 5. Transport contract

Start with one supported binding. Implementing both HTTP bindings is optional for Office connectivity.

| Operation | JSON-RPC method at advertised endpoint | HTTP+JSON route relative to advertised base |
|---|---|---|
| Submit or continue | `SendMessage` | `POST /message:send` |
| Submit or continue with a stream | `SendStreamingMessage` | `POST /message:stream` |
| Read a task | `GetTask` | `GET /tasks/{id}` |
| Cancel a task | `CancelTask` | `POST /tasks/{id}:cancel` |
| Subscribe to an existing task | `SubscribeToTask` | `POST /tasks/{id}:subscribe` |

Office currently uses streaming submission when advertised, otherwise submission followed by polling. Its recovery path uses `GetTask`; do not depend on Office calling `SubscribeToTask` to recover. Other operations, including `ListTasks` and capability-dependent operations, remain governed by the upstream server specification even when the current Office workflow does not call them.

JSON-RPC requests use `Content-Type: application/json`. Normal responses use JSON; streaming responses use `text/event-stream`. The client sends `A2A-Version: 1.0` and configured credentials. Follow the upstream binding's HTTP/error requirements, not the old `{type:"error"}` socket format.

If an interface advertises `tenant`, Office includes it in JSON-RPC parameters. For HTTP+JSON it adds the encoded tenant segment before the operation path, for example `/a2a/acme/message:send` when the base is `/a2a` and tenant is `acme`.

### 5.1 Identifiers

| Identifier | Owner and use |
|---|---|
| JSON-RPC `id` | Office supplies it per call. Echo it unchanged in that call's response and every JSON-RPC SSE envelope for that call. It is not a task ID. |
| User `messageId` | Office supplies it per message. A continuation has a new message ID. |
| Agent `messageId` | Worker supplies a unique ID for each agent-authored message. |
| Task `id` | Worker generates it when creating a Task. `GetTask` and `CancelTask` use it. |
| Message/event `taskId` | Refers to the worker's Task `id`. |
| `contextId` | Worker supplies conversation context. Preserve it for continuations of the same task. |
| Office task/assignment ID | Office-internal bookkeeping. Do not substitute it for the worker's task ID. |

New Office assignments omit `taskId` and `contextId`. Return both IDs for a new Task. Return `contextId` on an agent Message, including a direct reply that does not create a Task.

## 6. Submission and polling examples

These JSON-RPC exchanges use illustrative IDs. Generate unique IDs in real use.

### 6.1 Receive an assignment

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-submit-1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "msg-request-1",
      "role": "ROLE_USER",
      "parts": [
        {"text": "Review the supplied research and create a summary."},
        {"text": "# Input file: research/notes.txt\nThe product must work offline."}
      ]
    },
    "configuration": {"returnImmediately": true}
  }
}
```

The worker should validate/authenticate, allocate and persist task/context IDs, schedule execution, and promptly return the Task. Do not wait for a long model/tool run before acknowledging a nonblocking submission.

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-submit-1",
  "result": {
    "task": {
      "id": "task-builder-1",
      "contextId": "context-builder-1",
      "status": {"state": "TASK_STATE_SUBMITTED"},
      "artifacts": []
    }
  }
}
```

The `result.task` wrapper belongs to `SendMessage`. It is not the response shape for every operation.

### 6.2 Read the current task

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-get-1",
  "method": "GetTask",
  "params": {"id": "task-builder-1"}
}
```

Return the Task **directly** in `result`:

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-get-1",
  "result": {
    "id": "task-builder-1",
    "contextId": "context-builder-1",
    "status": {
      "state": "TASK_STATE_COMPLETED",
      "message": {
        "messageId": "msg-result-1",
        "role": "ROLE_AGENT",
        "contextId": "context-builder-1",
        "taskId": "task-builder-1",
        "parts": [{"text": "The summary is ready."}]
      }
    },
    "artifacts": [
      {
        "artifactId": "artifact-summary-1",
        "name": "summary.txt",
        "parts": [{"text": "The product must support offline use."}]
      }
    ]
  }
}
```

A polling response must include recoverable output, not only the state of the latest stream event. Office can replace its accumulated artifact snapshot with the Task's returned `artifacts` array. Do not return an empty artifact array for a completed task whose files were only sent on a previous stream.

### 6.3 Immediate response without a Task

For a simple question, `SendMessage` may return:

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-question-1",
  "result": {
    "message": {
      "messageId": "msg-answer-1",
      "role": "ROLE_AGENT",
      "contextId": "context-question-1",
      "parts": [{"text": "I can review code and generate project files."}]
    }
  }
}
```

Do not emit an additional custom direct-message acknowledgment. Office treats this response as complete. Independent Office questions can start separate contexts; do not assume all requests to the same worker belong to one project or conversation.

### 6.4 HTTP+JSON equivalents

For HTTP+JSON, send the `params` body from section 6.1 to `/message:send`, without the JSON-RPC envelope. Return `{"task":{...}}` or `{"message":{...}}` as the response body.

`GET /tasks/task-builder-1` returns the Task itself as the body. `POST /tasks/task-builder-1:cancel` likewise returns the resulting Task; Office sends no cancellation request body for this binding. Configure the advertised base path correctly so Office does not duplicate path segments.

## 7. Lifecycle, continuation and cancellation

### 7.1 State mapping

| A2A wire state | Meaning to the worker | Office assignment state |
|---|---|---|
| `TASK_STATE_SUBMITTED` | Accepted and queued | `assigned` |
| `TASK_STATE_WORKING` | Executing | `working` |
| `TASK_STATE_INPUT_REQUIRED` | Paused for another message | `input_required` |
| `TASK_STATE_AUTH_REQUIRED` | Paused for authorization | `auth_required` |
| `TASK_STATE_COMPLETED` | Finished successfully | `completed` |
| `TASK_STATE_FAILED` | Execution failed | `failed` |
| `TASK_STATE_CANCELED` | Execution cancelled | `cancelled` |
| `TASK_STATE_REJECTED` | Agent declined the task | `rejected` |

`input_required` and `auth_required` are interrupted states, not terminal completion. The Office task board preserves its broader business statuses separately and exposes `a2aState`, `remoteTaskId`, `contextId` and `agentMessage` for the protocol state. Rejected work is unsuccessful on that board.

Do not send `timed_out`, `progress`, `accepted` or British-spelled `TASK_STATE_CANCELLED` as A2A state values. Office's local `timed_out` is not an A2A terminal state reported by the worker.

### 7.2 Ask for input

Return or publish an input-required status with an agent message explaining what is needed. Office displays a Reply action. The next message uses the same remote task and context:

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-continue-1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "msg-request-2",
      "role": "ROLE_USER",
      "taskId": "task-builder-1",
      "contextId": "context-builder-1",
      "parts": [{"text": "Use the enterprise audience and keep it under 500 words."}]
    },
    "configuration": {"returnImmediately": true}
  }
}
```

Validate that the task belongs to the authenticated caller and matches the context. Resume the existing task; do not allocate a new task ID for this continuation. Do not reopen a terminal task under the same ID.

For auth-required work, an administrator updates the worker credentials and then resumes the task. Office does not perform an OAuth browser flow or automatically refresh tokens. Include instructions safe for a human to read; never put credential secrets into progress text or artifacts.

### 7.3 Cancel work

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-cancel-1",
  "method": "CancelTask",
  "params": {"id": "task-builder-1"}
}
```

The worker must coordinate cancellation with its execution engine: stop the relevant model request, subprocesses, tool operations and pending deliveries as appropriate. Persist the resulting state. When cancellation succeeds, return the Task directly in `result`, with `status.state: "TASK_STATE_CANCELED"` and the original IDs.

Return the applicable A2A error when the task is missing/inaccessible or cannot be cancelled. Office does not treat an error or lost request as proof that remote execution stopped. Do not send a legacy `task_cancel` acknowledgment or report cancellation while the worker continues publishing successful completion.

## 8. Streaming profile

Streaming is optional for the initial Office migration. A polling implementation with `streaming: false` is a useful first milestone.

If the card advertises streaming, Office uses `SendStreamingMessage` with `configuration.returnImmediately: false`. Return `Content-Type: text/event-stream`, flush events promptly, and disable proxy response buffering. For long work, emit the initial Task with IDs early so Office can recover even if the stream is interrupted.

Example JSON-RPC stream for request `rpc-stream-1`:

```text
data: {"jsonrpc":"2.0","id":"rpc-stream-1","result":{"task":{"id":"task-builder-1","contextId":"context-builder-1","status":{"state":"TASK_STATE_SUBMITTED"},"artifacts":[]}}}

data: {"jsonrpc":"2.0","id":"rpc-stream-1","result":{"statusUpdate":{"taskId":"task-builder-1","contextId":"context-builder-1","status":{"state":"TASK_STATE_WORKING","message":{"messageId":"msg-progress-1","role":"ROLE_AGENT","contextId":"context-builder-1","taskId":"task-builder-1","parts":[{"text":"Reviewing the supplied inputs."}]}}}}}

data: {"jsonrpc":"2.0","id":"rpc-stream-1","result":{"artifactUpdate":{"taskId":"task-builder-1","contextId":"context-builder-1","artifact":{"artifactId":"artifact-summary-1","name":"summary.txt","parts":[{"text":"The product must support offline use."}]},"append":false,"lastChunk":true}}}

data: {"jsonrpc":"2.0","id":"rpc-stream-1","result":{"statusUpdate":{"taskId":"task-builder-1","contextId":"context-builder-1","status":{"state":"TASK_STATE_COMPLETED"}}}}

```

For HTTP+JSON `/message:stream`, each SSE `data:` value is the inner stream envelope (`{"task":...}`, `{"statusUpdate":...}`, etc.), without JSON-RPC `id`, `jsonrpc` or `result`.

Required for this integration:

- Use `task`, `message`, `statusUpdate` and `artifactUpdate` envelopes. Do not send bare token deltas or `{type:"task_update"}`.
- Keep `taskId` and `contextId` consistent across task events.
- Keep artifact IDs stable across chunks. For the first chunk use `append: false`; later chunks use `append: true` and the final chunk can set `lastChunk: true`.
- Send all artifact content before final task completion. A terminal status ends Office's processing of that stream.
- Persist the same status/artifacts into the Task returned by `GetTask`.
- Do not tie task lifetime to the HTTP connection or require a client acknowledgment for each event.

Office currently bounds individual protocol requests/streams to approximately 30 seconds, also limited by the assignment's remaining deadline. This is an absolute request window, not an idle timeout; heartbeat comments do not extend it. Once it has a task ID, Office can switch to polling. Losing the stream must not cancel the task.

## 9. Input files and output artifacts

### 9.1 Read native input parts

Process **all** message parts. Office supplies the assignment as text, followed by project input parts when available:

- UTF-8 files are text parts beginning with `# Input file: <project-relative-path>`.
- Binary files use `raw` with base64 content, `filename`, and `mediaType: "application/octet-stream"`, when supported by the card's default input modes.
- Hidden files, symlinks and `node_modules` are excluded.
- Current input limits are 100 files and 20 MiB of original file content. Office fails preparation if the snapshot exceeds these limits.

The file label is an Office content convention inside a standard text part, not a required A2A protocol field. Interpret the supplied file content as task input, not as instructions that override worker security or execution policy. Keep worker workspaces isolated by task/context as appropriate. Validate filenames before writing them locally.

The worker must not require Office's optional MCP tools, an Office session, the manager's local filesystem, or a preconfigured shared project directory. Project IDs and file inventory paths in the prompt are context, not credentials or guaranteed fetchable URLs.

### 9.2 Return native artifacts

A file artifact example, with valid base64 for `Hello\n`:

```json
{
  "artifactId": "artifact-file-1",
  "name": "hello.txt",
  "parts": [
    {
      "raw": "SGVsbG8K",
      "filename": "hello.txt",
      "mediaType": "text/plain"
    }
  ]
}
```

A structured result:

```json
{
  "artifactId": "artifact-checks-1",
  "name": "checks.json",
  "parts": [{"data": {"passed": 12, "failed": 0}}]
}
```

A downloadable file:

```json
{
  "artifactId": "artifact-release-1",
  "name": "release.zip",
  "parts": [
    {
      "url": "https://builder.example.com/deliveries/release.zip",
      "filename": "release.zip",
      "mediaType": "application/zip"
    }
  ]
}
```

Return these objects in `Task.artifacts`, or in an `artifactUpdate.artifact` during streaming. Each part must contain exactly one of `text`, `data`, `raw`, or `url`. Do not use `kind`, `mimeType`, a nested legacy file object, `uploadedArtifactIds`, or paths to files that exist only on the worker's disk.

Office groups consecutive text or raw chunks with matching filename/media type into a single file. Use consistent metadata on appended chunks. Distinct data/URL parts are separate outputs. Prefer explicit, distinct filenames for independent files.

### 9.3 Project layout and file limits

For nested deliverables, return a ZIP whose entries are relative to the project root, for example:

```text
app/index.html
app/styles.css
docs/implementation.md
research/summary.txt
```

Do not add a task-ID, date, worker-name or duplicate project-name wrapper directory. Office currently sanitizes individual non-ZIP filenames; use ZIPs to preserve directories. Deliver only intended changes, preserve unrelated work, and update references when moving files. Office merges matching paths into the project workspace.

| Office limit/policy | Worker integration consequence |
|---|---|
| 100 MiB aggregate output content per delivery | Split or reduce oversized output before completion. Base64 encoding adds wire overhead. |
| 128 MiB JSON response / SSE-event buffer limit | Do not send a single oversized base64 response; large files may need URL parts. |
| ZIP expansion: 500 MiB and 5,000 entries | Avoid oversized bundles; ZIP64, encrypted archives, unsafe paths and symlinks are rejected. |
| Artifact HTTP fetch: approximately 30 seconds | Make URLs immediately downloadable when publishing completion. |
| No HTTP redirects | Return the final download URL, not a redirector. |
| Same-origin downloads may receive agent credentials | Use the configured origin for authenticated delivery. |
| Cross-origin downloads receive no agent credentials and must resolve publicly | Use directly accessible public/signed URLs; do not point to another private service. |

A remote task can complete successfully but still fail Office's local import if the output is unsafe, unavailable or too large. Treat imported-file verification as part of integration acceptance.

## 10. Authentication, errors and recovery

### 10.1 Authentication

Choose authentication supported by your service and advertise it accurately in the Agent Card. Office can send a configured bearer token or other permitted authentication headers. It does not perform OAuth login/refresh, supply mTLS client certificates, or negotiate custom required extensions.

For authenticated integration, the configured discovery URL and selected service endpoint must share the same origin (scheme, hostname and port). Office will not forward the configured credentials to a different service origin. Use HTTPS for remote deployments. Authorize task reads, continuations and cancellation against the caller; knowing a task ID alone must not grant access.

Keep secrets out of names, descriptions, status messages, artifact metadata and model-visible prompts. Old Office registration tokens are not automatically credentials for the new worker service.

### 10.2 Errors

For JSON-RPC, return the standard response envelope with the request's `id` and an `error` object. Examples of applicable codes include parse error `-32700`, invalid request `-32600`, method not found `-32601`, invalid params `-32602`, task not found `-32001`, and task not cancelable `-32002`.

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-cancel-1",
  "error": {
    "code": -32002,
    "message": "This task has already completed."
  }
}
```

Follow the upstream HTTP+JSON error/status mapping when using that binding; do not reuse a JSON-RPC envelope as its normal response. Request-level rejection is distinct from an accepted Task that later enters `TASK_STATE_FAILED` or `TASK_STATE_REJECTED`.

### 10.3 Recovery and deadlines

Office persists endpoint configuration, assignment metadata and remote task/context IDs. After an Office restart it queries known active remote tasks rather than resubmitting their original work. The worker should persist enough task state to make those queries useful, including completed artifacts and their accessibility. Define and document a retention policy appropriate to your deployment.

Office polls active nonstreaming/recovering tasks roughly every two seconds, subject to request duration and errors. Default local waiting deadlines are 30 minutes for assignments and 5 minutes for direct questions; individual assignments can use other bounded deadlines. Input/auth-required tasks pause without being marked completed. Resume uses the same task/context IDs.

A stream closing, Office restarting, or Office timing out is **not** a cancellation request. Only an actual `CancelTask` request should trigger the cancellation operation. A local timeout can leave remote execution running.

If Office never received a remote task ID, it cannot reliably distinguish “not accepted” from “accepted but response lost.” It reports failure/uncertainty and does not automatically replay the submission. A worker may implement deduplication keyed to authenticated caller and message ID, but must follow the upstream idempotency rules; do not assume A2A guarantees exactly-once execution.

## 11. Recommended migration sequence

1. **Separate execution from the old socket.** Make the existing engine callable with a task/context and a stream of local status/result events.
2. **Add a task store.** Store server-generated IDs, caller ownership, status, messages, artifacts and execution/cancellation handles. Persist durable fields independently from an HTTP connection.
3. **Implement a nonstreaming A2A binding.** Support submission, retrieval, continuation and cancellation behavior. Apply the other upstream requirements for your server's advertised capabilities.
4. **Publish an accurate Agent Card.** Start with `streaming: false`; advertise only implemented modes and capabilities.
5. **Replace artifact uploads.** Convert the engine's outputs into native artifact parts. Return ZIPs for nested project outputs.
6. **Remove mandatory Office dependencies.** Do not require socket registration, injected MCP configuration, Office-upload credentials, custom progress acknowledgments or Office-issued task IDs.
7. **Validate with Office.** Register a test URL, assign small work, inspect the task board and downloaded output, then exercise interruption, cancellation and recovery.
8. **Add streaming if useful.** Keep polling authoritative and enable the advertised capability only when the stream passes acceptance checks.
9. **Cut over deliberately.** Drain or explicitly stop legacy work before disabling its socket runner. Re-register the new endpoint in Office. Do not execute the same queued job through both integrations.

Office's old socket registry records do not automatically migrate into callable endpoints. A worker that cannot yet expose an HTTP service can use a separately deployed A2A gateway in front of its engine; that gateway must own the same task/lifecycle guarantees. Alternatively, keep using the built-in Office WebSocket integration without migrating.

## 12. Acceptance checklist

Use a disposable test project and real worker endpoint. Retain request/response logs with secrets redacted.

| Test | Expected result |
|---|---|
| Discover and register | Office reads the card and lists the worker's name and skills. |
| Reject an invalid/expired credential | No work executes; the client receives an authentication failure. |
| Submit text-only work | Worker accepts native parts and returns a Message or a Task. |
| Immediate question | A `result.message` response appears in Office without a fabricated remote task. |
| Long nonstreaming work | Submission returns IDs promptly; `GetTask` eventually supplies final output. |
| File inputs | Worker reads all supplied parts, including labeled text files and supported base64 files. |
| Text/data/raw output | Each output is imported into the intended project. |
| Nested ZIP output | Directory structure is preserved without an extra task wrapper folder. |
| URL output | Download succeeds with the documented origin/auth/size rules. |
| Input required | Office shows the question; replying resumes the original task/context with a new message ID. |
| Auth required | Updating credentials and resuming does not create duplicate work. |
| Successful cancellation | Worker stops relevant execution and returns the cancelled Task. |
| Cancellation denied | Office surfaces the error and does not falsely mark the task cancelled. |
| Unknown or another caller's task | Read/continue/cancel cannot expose or alter unauthorized work. |
| Stream interruption, if streaming is advertised | Office recovers by `GetTask`, with no duplicate submission or missing artifacts. |
| Worker/Office restart | Known tasks remain queryable or return an accurate documented error; no false success. |
| Office waiting timeout | Worker does not mistake the disconnected client for an implicit cancellation. |
| Artifact import failure | Office reports a clear failure; inaccessible URLs and oversized/unsafe files are not silently accepted. |
| Concurrent tasks/projects | IDs, workspaces, status messages, credentials and artifacts do not cross between assignments. |

Office's local regression fixtures can be run with:

```sh
node --test test/a2a.test.mjs test/worker-registry.test.mjs
```

Those tests exercise the Office implementation against protocol fixtures. They do not validate your external worker automatically. Run the acceptance cases against your worker, and use upstream conformance tooling when claiming general A2A conformance.

## 13. Known Office scope

Supported today: JSON-RPC and HTTP+JSON v1.0 agents, native messages/tasks, stream submission, polling, interrupted-task continuation, cancellation, artifact import and persisted assignment recovery.

Not provided by the current Office integration: gRPC-only connectivity, A2A v0.3 compatibility, push-notification webhooks, Agent Card signature verification, automatic OAuth flows/refresh, mTLS client certificates, custom required extensions, or an inbound A2A endpoint for invoking the Office Manager. Do not make these prerequisites for this migration. A worker may support additional standard capabilities for other clients.

## 14. References and implementation traceability

- [A2A v1.0 specification](https://a2a-protocol.org/v1.0.0/specification/) — authoritative protocol semantics and bindings.
- [Official JavaScript SDK](https://github.com/a2aproject/a2a-js) — reference implementation; use v1.0-compatible documentation, not old v0.3 examples. Installing it is not a requirement of this guide.
- [Office integration overview](sub-agent-spec.md) — current operator-facing configuration and support scope.
- [Office client](../lib/a2a-client.js) — discovery, transport selection, headers, RPC/REST and SSE handling.
- [Office assignment manager](../lib/sub-agents.js) — task state, continuation, cancellation and recovery behavior.
- [Project inputs](../lib/worker-task-context.js) and [artifact import](../lib/a2a-artifacts.js) — current content conventions and limits.
- [Registration API](../api/sub-agents.js) and [interoperability fixtures](../test/a2a.test.mjs).
