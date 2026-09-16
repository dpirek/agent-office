# Office components

`public/index.html` mounts `<office-shell>`. The shell composes the navigation,
page panels, and toast. Components extend `OfficeComponent`, which extends the
shared `BaseComponent` used by `harness-chat.js`. Each component creates its DOM
with `this.createElement` and owns its controls, draft state, and rendering.
Light DOM keeps existing themes and native form behavior intact.

`app.mjs` coordinates routing, shared project/task/chat data, polling, and the
WebSocket. It communicates with components through the following API rather
than selecting their internal controls.

## Shared contract

- `element.data = { ... }` merges a view model and updates that component.
  Supply arrays/objects as read-only inputs; local editing state stays inside
  the owning component. Inputs can be assigned before connection.
- `projectId` / `project-id` identifies the project for components with
  project-specific data and requests.
- Notifications are bubbling `CustomEvent`s using `this.emit(name, detail)`.
- Async intent events include `detail.respondWith(promise)`. A coordinator
  must call it synchronously; the promise may resolve later. Components await
  it to manage pending controls and display errors. Missing handlers reject.
- DOM and local listeners initialize once. External listeners and observers
  attach in `onConnect` using `connectionSignal` and are removed on disconnect.
  Reconnecting preserves the component's DOM and draft state.

```js
const tasks = document.querySelector('office-task-queue');
tasks.data = { tasks: taskRecords, projects, projectId: 'central-office' };
tasks.filter = 'pending';

document.querySelector('office-shell').addEventListener('task-create', event => {
  const { title, priority, respondWith } = event.detail;
  respondWith(createTask({ title, priority }));
});
```

## Component APIs

| Component | Inputs and public methods | Outgoing events |
| --- | --- | --- |
| `office-shell` | `showPage(page)`, `syncPanelLayout()` | Bubbles child events |
| `office-topbar` | `data: { user, query, collapsed, projects, projectId }` | `office-search { query }`, `new-task`, `navigation-toggle`, `project-select { id }`, `project-create-open` |
| `office-account` | `load()` | `account-user-change { user }` |
| `office-search` | `search(query, projectId, projectName)`, `deactivate()` | `search-result-open { type, id, title, description, href }` |
| `office-navigation` | `data: { projects, projectId, page, online, context }`; `collapsed` property/attribute; `toggle()`, `openProjectDialog()` | `office-navigate { href }`, `project-select { id }`, `project-create { name, description, isPublic, memberIds, inviteEmails, respondWith }`, `sidebar-toggle { collapsed }` |
| `office-floor` | `data: { agents, selectedAgent }`; `meta` | `agent-select { name }` |
| `office-selected-agent` | `data: { agent, agents, tasks, activity, health, orchestrator, chatRunning, uptime, sessionId }`; `activeTab` / `active-tab` | — |
| `office-worker-registry` | `data: { workers, workerTokenConfigured, workerTokenName }` | `worker-token-change { configured, name }` (never emits the secret) |
| `office-task-summary` | `data: { tasks, projectId }` | Native task navigation links |
| `office-task-queue` | `data: { tasks, projects, projectId }`; `filter` attribute/property; `open()`, `revealTask(id)` | `task-create { title, priority, respondWith }`, `task-stop` / `task-delete { id, respondWith }`, `dashboard-refresh { respondWith }`, `task-filter-change { filter }` |
| `office-operations` | `data: { operations, workers, projectId }`; `open(operation?)`, `close()` | `operations-change { operations }` |
| `office-chat` | `data: { projects, projectId, officeChatMessages, officeChatMembers, chatRunning }`; `clearDraft()`, `syncComposer()` | `chat-send { text, respondWith }`, `chat-refresh { respondWith }`, `project-select { id }`, `file-open { href }` |
| `office-manager-chat` | `data: { chatMessages, projectId, health, socketReady, chatRunning }`; `clearDraft()`, `focusInput()` | `chat-send`, `chat-refresh`, `file-open` |
| `office-dashboard-chat` | `data: { messages, projectId, projectName }`; `clearDraft()` | `chat-send`, `chat-refresh`, `file-open` |
| `office-workspace` | `projectId`; `load({ quiet }?)`, `openFile(href)`, `reset()` | Notifications |
| `office-settings` | `data: { userRole }`; `load()`, `selectTab(tab)` | `configuration-change`, `office-theme-select { value }` |
| `office-knowledge` | `load()` | Notifications |
| `office-memory` | `projectId`; `load({ quiet }?)`; `data: { memoryRecords }` | Notifications |
| `office-system-log` | `data: { logs }` | — |
| `office-toast` | `show(message, error?)` | — |

Components may emit `office-notify { message, error }`,
`office-log { source, text, tone }`, and `office-activity { text, tone }`.
Settings, knowledge, operations, worker credentials, and workspace previews own
their feature-specific API calls. Shared chat/task/project requests go through
the coordinator so sibling views stay synchronized.

`lib/theme.js` applies the saved document theme before first paint and handles
`office-theme-select`. It publishes `office-theme-change` and
`office-theme-saved`; navigation and settings update their own UI in response.

`/login` and `/register` use standalone authentication documents. `/account`
is rendered by `office-account` inside the same application shell as other pages.

New-project requests resolve to `{ project, invitations }`. The navigation component
keeps the dialog open to present invitation links when supplied. Registration and
login preserve `?invite=` and redeem it through the authentication API.
