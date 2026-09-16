import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal host for testing the component contract without a browser dependency.
class ElementHost extends EventTarget {
  attributes = new Map();
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) {
    const previous = this.getAttribute(name);
    this.attributes.set(name, String(value));
    if (this.constructor.observedAttributes?.includes(name)) this.attributeChangedCallback(name, previous, String(value));
  }
}
const previousHTMLElement = globalThis.HTMLElement;
globalThis.HTMLElement = ElementHost;
const { default: OfficeComponent } = await import('../public/components/office-component.mjs');
if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
else globalThis.HTMLElement = previousHTMLElement;

class ExamplePanel extends OfficeComponent {
  model = { messages: [], projectId: 'central-office' };
  renders = 0;
  updates = 0;
  initializations = 0;
  render() { this.renders++; }
  initialize() {
    this.initializations++;
    this.update = () => this.updates++;
  }
}

test('component data and project attributes work before and after connection without shared state', () => {
  const first = new ExamplePanel();
  const second = new ExamplePanel();
  first.data = { messages: ['Hello'], projectId: 'alpha' };
  assert.equal(first.getAttribute('project-id'), 'alpha');
  assert.equal(first.updates, 0);
  first.connectedCallback();
  assert.equal(first.updates, 1);
  first.setAttribute('project-id', 'beta');
  assert.equal(first.data.projectId, 'beta');
  assert.equal(first.updates, 2);
  assert.deepEqual(second.data.messages, []);
  first.disconnectedCallback();
});

test('reconnecting preserves DOM and local state and replaces external subscriptions', () => {
  const source = new EventTarget();
  const panel = new ExamplePanel();
  let received = 0;
  panel.onConnect = () => source.addEventListener('update', () => received++, { signal: panel.connectionSignal });
  panel.connectedCallback();
  panel.data = { messages: ['Preserved draft'] };
  source.dispatchEvent(new Event('update'));
  const oldSignal = panel.connectionSignal;
  panel.disconnectedCallback();
  assert.equal(oldSignal.aborted, true);
  source.dispatchEvent(new Event('update'));
  assert.equal(received, 1);
  panel.connectedCallback();
  source.dispatchEvent(new Event('update'));
  assert.equal(received, 2);
  assert.equal(panel.renders, 1);
  assert.equal(panel.initializations, 1);
  assert.deepEqual(panel.data.messages, ['Preserved draft']);
  panel.disconnectedCallback();
});

test('component requests return asynchronous results and surface missing handlers and failures', async () => {
  const panel = new ExamplePanel();
  await assert.rejects(panel.request('missing'), /No handler for missing/);
  panel.addEventListener('save', event => {
    assert.equal(event.bubbles, true);
    assert.equal(event.detail.title, 'Task');
    event.detail.respondWith(Promise.resolve({ id: 'task-1' }));
  });
  assert.deepEqual(await panel.request('save', { title: 'Task' }), { id: 'task-1' });
  panel.addEventListener('fail', event => event.detail.respondWith(Promise.reject(new Error('API unavailable'))));
  await assert.rejects(panel.request('fail'), /API unavailable/);
});
