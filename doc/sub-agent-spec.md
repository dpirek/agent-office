# A2A v1.0 agents in Office

Office is an **A2A client/orchestrator**. Workers are standard A2A servers. Office uses Node built-ins only; there are no npm dependencies. The normative wire contract is the [A2A v1.0 specification](https://a2a-protocol.org/v1.0.0/specification/).

## Connect an agent

An administrator opens **Add member → Add agent**, enters the agent base URL (or a complete Agent Card `.json` URL), and optionally supplies a bearer token. Office fetches `/.well-known/agent-card.json` for a base URL and selects the first compatible advertised interface.

An agent must advertise a `supportedInterfaces` entry with `protocolVersion: "1.0"` (or `1.0.x`) and `protocolBinding: "JSONRPC"` or `"HTTP+JSON"`. Its endpoint must be reachable from Office. No changes to a standard agent's implementation are necessary. A2A does not define a “join Office” operation: adding an endpoint to the Office registry is an Office administration action, not an extra agent-side protocol.

The same operation is available to an authenticated Office administrator:

```http
POST /api/sub-agents
Content-Type: application/json
Cookie: office_session=...

{"url":"https://agent.example.com","name":"Builder","token":"optional-bearer-token"}
```

`name` is an optional local alias. `cardPath` optionally overrides the discovery path, including an empty string to fetch the configured URL exactly. `headers` can supply API-key or other authentication headers instead of `token`. Re-registering the same name and URL updates credentials. `DELETE /api/sub-agents` with `{"name":"Builder"}` removes an idle agent. Registry writes require an Office administrator; an agent credential does not grant Office administration access.

Credentials and endpoint configuration persist in the Office SQLite database. Protect that database as you protect provider API keys. Registry API responses never include stored credentials. Credentials are sent only to the configured origin; authenticated discovery and service URLs must share an origin. HTTP redirects are not followed. Prefer HTTPS outside local development.

## Protocol behavior

Every protocol request sends `A2A-Version: 1.0`. JSON-RPC uses `jsonrpc: "2.0"`, unique request IDs and standard method names. HTTP+JSON uses the advertised base URL plus the standard message/task routes, with the interface tenant when advertised.

| Operation | JSON-RPC | HTTP+JSON |
|---|---|---|
| Submit | `SendMessage` | `POST /message:send` |
| Submit and stream | `SendStreamingMessage` | `POST /message:stream` |
| Read status | `GetTask` | `GET /tasks/{id}` |
| Cancel | `CancelTask` | `POST /tasks/{id}:cancel` |
| Subscribe | `SubscribeToTask` | `POST /tasks/{id}:subscribe` |

Assignments send `messageId`, `role: "ROLE_USER"`, and native `parts`. New assignments omit `taskId` and `contextId`; the agent supplies them. Office accepts either a `Message` or `Task` response. It never requires a task for an immediate response.

Agents advertising streaming receive `SendStreamingMessage`. Office consumes `task`, `message`, `statusUpdate`, and `artifactUpdate` envelopes. Nonstreaming agents receive `SendMessage` with `configuration.returnImmediately: true`, followed by polling when necessary. If a stream ends or fails after a remote task ID was received, Office polls that task instead of resending the work. A failed initial submission with no task ID is reported as uncertain and is not automatically replayed.

Office retains local assignment IDs separately from server task IDs. Agent registration, task/context IDs, task state, and accumulated results survive Office restarts. Active tasks recover with `GetTask`. Interrupted tasks wait for a reply. The application task board uses its existing broad statuses; `a2aState`, `remoteTaskId`, `contextId`, and `agentMessage` expose the protocol state separately.

## Interrupted tasks and cancellation

`TASK_STATE_INPUT_REQUIRED` and `TASK_STATE_AUTH_REQUIRED` pause work without completing it. The task row shows the state and a **Reply** action. For auth-required tasks, update the agent credentials first. Replying sends a new message with the same server `taskId` and `contextId`. The manager tool also supports `manage_office_tasks` with action `continue`, task ID and text.

```http
PUT /api/tasks
Content-Type: application/json

{"id":"office-task-id","projectId":"project-id","action":"continue","text":"Use blue."}
```

For a direct chat question that pauses, send another direct message to the same agent in the same project to continue it.

Remote terminal states completed, failed, canceled and rejected are preserved in the A2A assignment. Office cancels remote work using `CancelTask` and only records cancellation when the returned task confirms it. Protocol errors remain errors; missing tasks and failed cancellation requests are not silently treated as success. Cancellation before local preparation finishes prevents submission.

Office waiting deadlines default to 30 minutes for assignments and 5 minutes for direct messages. A local timeout does **not** mean the remote task stopped; Office retains its remote ID. A later cancellation can reconcile a timed-out assignment.

## Files and results

Existing project files are supplied as native A2A message parts: UTF-8 files as labeled text, binary files as base64 `raw` parts when the agent advertises `application/octet-stream` or `*/*` input. Office excludes hidden files, symlinks and `node_modules`. Input snapshots are limited to 100 files and 20 MB; exceeding that limit fails clearly instead of silently omitting inputs.

Return standard A2A artifacts with `artifactId` and `parts`, using `text`, `data`, `raw` or `url` content. Include `filename` and `mediaType` for file parts. Office accumulates artifact updates, including append chunks, and materializes results into the assigned project on completion. Plain messages and structured results also work. ZIP files preserve project-relative directories; use ZIPs for nested deliverables.

Office supports URL artifacts, downloads them without following redirects, and sends agent credentials only to the configured origin. Cross-origin artifact downloads must resolve to public addresses; they cannot reach private networks. Deliveries are limited to 100 MB total; ZIP expansion retains the existing 500 MB/5,000-entry checks and path/symlink protections. Storage uses the existing atomic workspace merge.

Agents do not need Office MCP tools, `artifactUpload`, `uploadedArtifactIds`, callback endpoints, or custom progress messages. Optional Office MCP/context APIs remain separate tools and are not part of A2A.

## Scope and migration

- Supported: A2A v1.0 JSON-RPC and HTTP+JSON, streaming and polling, direct messages, task continuation, cancellation, native artifacts, configured auth headers, persisted task recovery.
- Not offered: a public A2A **server** for calling the Office Manager, gRPC-only peers, v0.3 compatibility, automatic OAuth login/refresh, mTLS client certificates, push-notification webhooks, Agent Card signature verification, or application-specific extensions. Required unknown extensions are rejected explicitly. Optional capabilities are not prerequisites for connecting an agent.
- The old `/ws/workers` transport and `/api/worker-token` registration flow have been removed. Existing socket workers must expose an A2A endpoint and be registered by URL. Legacy socket registry records do not become A2A endpoints automatically.
- Browser `/ws` remains an internal dashboard connection and is unrelated to the agent protocol.

## Verification

`node --test test/a2a.test.mjs test/worker-registry.test.mjs` exercises both HTTP bindings against standalone protocol fixtures, including native message responses, task polling, SSE chunks, multi-turn continuation, cancellation failures, restart recovery, credentials and artifact conversion. `npm test` runs the complete regression suite. These are implementation tests, not a claim of external A2A certification.
