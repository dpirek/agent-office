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

Generate the token from **Agents → Live Worker Registry → Generate Token** or bootstrap it with the office's `AI_HARNESS_WORKER_TOKEN`. It may instead be supplied as an `Authorization: Bearer …` header. A successful registration returns a `registered` message containing the normalized worker record.

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

Worker-reported final states are `completed` or `failed`; the office may additionally finalize an assignment as `cancelled` or `timed_out`. The office downloads final deliverables before acknowledging completion. ZIP files are extracted into a task-specific shared-workspace folder and then deleted; non-archive files are copied there directly. Local file links are attached to the corresponding task and chat message and are available on `/workspace`.
