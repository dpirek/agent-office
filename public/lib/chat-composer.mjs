export function initChatComposer() {
  const form = document.getElementById('office-board-form');
  const input = document.getElementById('office-board-input');
  const picker = document.getElementById('composer-emoji-picker');
  const toggle = document.getElementById('composer-emoji-toggle');
  let selection = [0, 0];
  const rememberSelection = () => { selection = [input.selectionStart, input.selectionEnd]; };
  for (const event of ['select', 'keyup', 'click', 'input', 'blur']) input.addEventListener(event, rememberSelection);
  const closePicker = () => { picker.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  function insert(text, wrap = false) {
    const [start, end] = selection;
    const selected = input.value.slice(start, end);
    const replacement = wrap ? text + selected + text : text;
    if (input.value.length - (end - start) + replacement.length > input.maxLength) return;
    input.focus();
    input.setRangeText(replacement, start, end, 'end');
    if (wrap) input.setSelectionRange(start + text.length, end + text.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  form.querySelectorAll('[data-composer-format]').forEach(button => {
    button.addEventListener('click', () => insert(button.dataset.composerFormat, true));
  });
  document.getElementById('composer-mention').addEventListener('click', () => insert('@'));
  toggle.addEventListener('click', () => {
    picker.hidden = !picker.hidden;
    toggle.setAttribute('aria-expanded', String(!picker.hidden));
    if (!picker.hidden) picker.querySelector('button').focus();
  });
  picker.addEventListener('click', event => {
    const button = event.target.closest('[data-emoji]');
    if (button) { insert(button.dataset.emoji); closePicker(); }
  });
  document.addEventListener('click', event => {
    if (!picker.contains(event.target) && !toggle.contains(event.target)) closePicker();
  });
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !picker.hidden) { closePicker(); toggle.focus(); }
  });
}
