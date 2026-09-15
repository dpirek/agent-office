import { renderAccount } from "../account.mjs";

export async function requireSession() {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to check your session. Reload to try again.");
  let { user } = await response.json();
  if (!user || user.role === "pending") {
    history.replaceState(null, "", "/account");
    document.title = "Account · AI Agent Office";
    document.body.dataset.page = "account";
    document.body.classList.add("account-limited");
    document.querySelectorAll("[data-view]").forEach(panel => { panel.hidden = panel.dataset.view !== "account"; });
    document.querySelectorAll(".operations-grid, .bottom-grid, .right-column").forEach(panel => { panel.hidden = true; });
    document.querySelectorAll(".nav-item").forEach(link => {
      link.classList.toggle("active", link.dataset.section === "account");
      link.removeAttribute("aria-current");
    });
    document.querySelector('[data-section="account"]').setAttribute("aria-current", "page");
    document.querySelector("#health-text").textContent = "SIGN IN";
    user = await new Promise(resolve => {
      void renderAccount(document.querySelector("#account-view"), { onAuthenticated: resolve });
    });
    document.body.classList.remove("account-limited");
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const result = await originalFetch(...args);
    const requestUrl = new URL(typeof args[0] === "string" || args[0] instanceof URL ? args[0] : args[0].url, location.href);
    if (result.status === 401 && requestUrl.origin === location.origin && requestUrl.pathname.startsWith("/api/") && !requestUrl.pathname.startsWith("/api/auth/")) location.replace("/account");
    return result;
  };
  return user;
}
