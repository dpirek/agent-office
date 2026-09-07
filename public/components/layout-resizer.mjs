import { defineComponent } from "./define-component.mjs";

defineComponent("layout-resizer", {
  classes: ["layout-resizer"],
  attributes: { role: "separator", tabindex: "0", "aria-valuemin": "0", "aria-valuemax": "100" },
  template: '<span class="resize-grip" aria-hidden="true"></span>',
});
