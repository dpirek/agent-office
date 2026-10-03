import { CHAT_IMAGE_TYPES, MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES } from './chat-image-limits.mjs';

export function initChatImages({ form, input, tools, onError, onChange = () => {} }) {
  let entries = [], disabled = false, revision = 0;
  const picker = document.createElement('input');
  picker.type = 'file'; picker.accept = CHAT_IMAGE_TYPES.join(','); picker.multiple = true; picker.hidden = true;
  const add = document.createElement('button');
  add.type = 'button'; add.className = 'chat-attach-button'; add.title = 'Add images (up to 4, 5 MB each)'; add.setAttribute('aria-label', 'Add images');
  add.innerHTML = '<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use href="/assets/bootstrap-icons/bootstrap-icons.svg#image"></use></svg>';
  const previews = document.createElement('div');
  previews.className = 'chat-image-previews'; previews.setAttribute('aria-label', 'Attached images'); previews.hidden = true;
  form.prepend(previews, picker);
  tools.prepend(add);
  const render = () => {
    input.required = !entries.length;
    previews.hidden = !entries.length;
    previews.replaceChildren(...entries.map(entry => {
      const figure = document.createElement('figure');
      const image = document.createElement('img'); image.src = entry.url; image.alt = entry.file.name;
      const caption = document.createElement('figcaption'); caption.textContent = entry.file.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.disabled = disabled;
      remove.setAttribute('aria-label', `Remove ${entry.file.name}`);
      remove.addEventListener('click', () => { if (disabled) return; URL.revokeObjectURL(entry.url); entries = entries.filter(item => item !== entry); revision++; render(); });
      figure.append(image, caption, remove); return figure;
    }));
    onChange();
  };
  const addFiles = files => {
    if (disabled) return;
    const incoming = [...files];
    if (entries.length + incoming.length > MAX_CHAT_IMAGES) return onError('Attach at most 4 images per message.');
    if (incoming.some(file => !CHAT_IMAGE_TYPES.includes(file.type) || !file.size || file.size > MAX_CHAT_IMAGE_BYTES)) return onError('Choose PNG, JPEG, GIF, or WebP images up to 5 MB each.');
    entries.push(...incoming.map(file => ({ file, url: URL.createObjectURL(file) })));
    revision++; render();
  };
  add.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => { addFiles(picker.files); picker.value = ''; });
  input.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) { event.preventDefault(); addFiles(files); }
  });
  form.addEventListener('dragover', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
  form.addEventListener('drop', event => {
    if (event.dataTransfer?.files.length) { event.preventDefault(); addFiles(event.dataTransfer.files); }
  });
  return {
    get count() { return entries.length; },
    clear() { entries.forEach(entry => URL.revokeObjectURL(entry.url)); entries = []; revision++; render(); },
    setDisabled(value) { disabled = value; add.disabled = picker.disabled = value; previews.querySelectorAll('button').forEach(button => { button.disabled = value; }); },
    async read() {
      const current = revision;
      const images = await Promise.all(entries.map(({ file }) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, dataUrl: reader.result });
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.readAsDataURL(file);
      })));
      if (current !== revision) throw new Error('The attachment draft changed. Please send again.');
      return images;
    },
  };
}
