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

The token must match `AI_HARNESS_WORKER_TOKEN`. It may instead be supplied as an `Authorization: Bearer …` header. A successful registration returns a `registered` message containing the normalized worker record.

## Receive a task

```json
{
  "type": "task",
  "taskId": "task-generated-uuid",
  "priority": "high",
  "message": {
    "messageId": "msg-generated-uuid",
    "role": "manager",
    "parts": [{ "kind": "text", "mimeType": "text/plain", "text": "Prepare the release." }]
  }
}
```

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

## Complete with deliverables

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
  "artifacts": [{
    "artifactId": "workspace-generated-uuid",
    "name": "release.zip",
    "parts": [{ "kind": "file", "file": { "name": "release.zip", "mimeType": "application/zip", "uri": "https://worker.example.com/release.zip" } }],
    "metadata": { "fileCount": 3, "size": 12480 }
  }]
}
```

Final states are `completed` or `failed`. Progress and final messages are posted to `#central-office`; deliverables are attached to the corresponding task and chat message.
