export function initSidebar() {
  const storageKey = "office-sidebar-collapsed";
  const root = document.documentElement;
  try {
    root.classList.toggle("sidebar-collapsed", localStorage.getItem(storageKey) === "true");
  } catch {
    // Navigation remains usable when storage is unavailable.
  }

  const toggle = document.getElementById("sidebar-toggle");
  const updateToggle = () => {
    const collapsed = root.classList.contains("sidebar-collapsed");
    const label = collapsed ? "Expand navigation" : "Collapse navigation";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  };
  updateToggle();
  toggle.addEventListener("click", () => {
    const collapsed = root.classList.toggle("sidebar-collapsed");
    updateToggle();
    try {
      localStorage.setItem(storageKey, String(collapsed));
    } catch {
      // Keep the current state even if it cannot be persisted.
    }
  });
}
