import test from 'node:test';
import assert from 'node:assert/strict';
import { initChatImages } from '../public/lib/chat-images.mjs';

class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; this.children = []; }
  setAttribute() {}
  prepend(...children) { this.children.unshift(...children); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  click() { this.dispatchEvent(new Event('click')); }
}
function fixture(t) {
  const original = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = original; });
  const form = new Element('form'), input = new Element('textarea'), tools = new Element('div');
  input.required = true;
  const errors = [];
  const images = initChatImages({ form, input, tools, onError: message => errors.push(message) });
  const paste = files => { const event = new Event('paste', { cancelable: true }); event.clipboardData = { files }; input.dispatchEvent(event); return event; };
  const file = new File(['image'], 'test.png', { type: 'image/png' });
  return { form, input, tools, errors, images, paste, file };
}

test('image composer accepts paste/drop, previews, removes, and permits image-only messages', t => {
  const { images, input, form, paste, file, errors } = fixture(t);
  assert.equal(paste([file]).defaultPrevented, true);
  assert.equal(images.count, 1);
  assert.equal(input.required, false);
  assert.equal(form.querySelectorAll('img').length, 1);
  images.setDisabled(true);
  paste([file]);
  assert.equal(images.count, 1);
  images.setDisabled(false);
  const drop = new Event('drop', { cancelable: true }); drop.dataTransfer = { files: [file] }; form.dispatchEvent(drop);
  assert.equal(images.count, 2);
  form.querySelectorAll('button')[0].click();
  assert.equal(images.count, 1);
  paste([new File(['x'], 'unsafe.svg', { type: 'image/svg+xml' })]);
  paste(Array(4).fill(file));
  assert.equal(errors.length, 2);
  assert.equal(images.count, 1);
  images.clear();
  assert.equal(images.count, 0);
  assert.equal(input.required, true);
});

test('image composer preserves files for retry and rejects stale reads after clearing a draft', async t => {
  const { images, paste, file } = fixture(t);
  const previous = globalThis.FileReader;
  const readers = [];
  globalThis.FileReader = class { readAsDataURL() { readers.push(this); } };
  t.after(() => { globalThis.FileReader = previous; });
  paste([file]);
  const read = images.read();
  readers[0].result = 'data:image/png;base64,aW1hZ2U='; readers[0].onload();
  assert.deepEqual(await read, [{ name: 'test.png', dataUrl: readers[0].result }]);
  assert.equal(images.count, 1);
  const stale = images.read();
  images.clear();
  readers[1].result = readers[0].result; readers[1].onload();
  await assert.rejects(stale, /draft changed/);
});
