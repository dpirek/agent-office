function defineComponent(name, { classes = [], attributes = {}, template }) {
  if (customElements.get(name)) return;

  const content = document.createElement("template");
  content.innerHTML = template.trim();

  customElements.define(name, class extends HTMLElement {
    #mounted = false;

    connectedCallback() {
      if (this.#mounted) return;
      this.#mounted = true;
      this.classList.add(...classes);
      for (const [attribute, value] of Object.entries(attributes)) {
        if (!this.hasAttribute(attribute)) this.setAttribute(attribute, value);
      }
      this.replaceChildren(content.content.cloneNode(true));
    }
  });
}

export { defineComponent };
