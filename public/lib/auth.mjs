export async function requireSession() {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to check your session. Reload to try again.");
  let { user } = await response.json();
  if (!user || user.role === "pending") {
    location.replace("/login");
    await new Promise(() => {});
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const result = await originalFetch(...args);
    const requestUrl = new URL(typeof args[0] === "string" || args[0] instanceof URL ? args[0] : args[0].url, location.href);
    if (result.status === 401 && requestUrl.origin === location.origin && requestUrl.pathname.startsWith("/api/") && !requestUrl.pathname.startsWith("/api/auth/")) location.replace("/login");
    return result;
  };
  return user;
}
