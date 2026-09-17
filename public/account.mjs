import { USER_AVATARS, renderUserAvatar } from './lib/user-avatars.mjs';

export async function renderAccount(root, { onAuthenticated = () => {}, onSignedOut = () => location.replace("/login"), onUserChanged = () => {}, mode = "account" } = {}) {
  root.innerHTML = `<div class="account-body"><div class="account-heading"><span class="account-eyebrow">YOUR WORKSPACE, CONNECTED</span><h1 id="account-title">Welcome back</h1><p id="account-description">Checking your session…</p></div><p id="account-message" role="status" aria-live="polite" hidden></p><div id="account-content"></div></div>`;
  const content = root.querySelector("#account-content");
  const message = root.querySelector("#account-message");
  const title = root.querySelector("#account-title");
  const description = root.querySelector("#account-description");
  function notify(text) { message.textContent = text; message.hidden = !text; }
  let session;
  const invitationCode = mode === 'account' ? null : new URLSearchParams(location.search).get('invite');
  let invitationInfo, invitationAccepted = false;
  async function api(path, body, method = "POST") {
    const response = await fetch(path, body === undefined ? { cache: "no-store" } : {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  function button(text, action) {
    const element = document.createElement("button");
    element.type = "button"; element.textContent = text;
    element.addEventListener("click", async () => {
      element.disabled = true; notify("");
      try { await action(); } catch (error) { notify(error.message); }
      finally { element.disabled = false; }
    });
    return element;
  }
  function form(mode) {
    notify("");
    root.classList.remove("is-profile");
    content.replaceChildren();
    const registration = mode === "register";
    title.textContent = registration ? (session.needsSetup ? "Create administrator account" : "Create your account") : "Welcome back";
    description.textContent = registration ? (session.needsSetup ? "The first account manages users and office access." : "Create an account to start your own project.") : "Sign in to your office.";
    if (invitationInfo) description.textContent = registration
      ? `Create your account to join ${invitationInfo.projectName}. You will get access automatically.`
      : `Sign in to join ${invitationInfo.projectName}.`;
    document.title = `${registration ? "Create account" : "Sign in"} · Agent Office`;
    const element = document.createElement("form");
    function field(label, name, type, autocomplete) {
      const wrapper = document.createElement("label"); wrapper.textContent = label;
      const input = document.createElement("input"); input.name = name; input.type = type; input.autocomplete = autocomplete; input.required = true;
      if (type === "password") input.maxLength = 256;
      else input.maxLength = name === "name" ? 100 : 254;
      input.placeholder = name === "name" ? "Your full name" : name === "email" ? "you@example.com" : name === "confirmation" ? "Re-enter your password" : registration ? "Choose a password" : "Enter your password";
      if (name === "email") { input.autocapitalize = "none"; input.spellcheck = false; }
      if (name === "password") {
        const group = document.createElement("span"); group.className = "password-field";
        const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = "Show"; toggle.setAttribute("aria-label", "Show password"); toggle.setAttribute("aria-pressed", "false");
        toggle.addEventListener("click", () => { const show = input.type === "password"; input.type = show ? "text" : "password"; toggle.textContent = show ? "Hide" : "Show"; toggle.setAttribute("aria-label", show ? "Hide password" : "Show password"); toggle.setAttribute("aria-pressed", String(show)); });
        group.append(input, toggle); wrapper.append(group);
      } else wrapper.append(input);
      element.append(wrapper);
    }
    if (registration) field("Name", "name", "text", "name");
    field("Email", "email", "email", "username");
    if (invitationInfo) { element.elements.email.value = invitationInfo.email; element.elements.email.readOnly = true; }
    field("Password", "password", "password", mode === "login" ? "current-password" : "new-password");
    if (registration) field("Confirm password", "confirmation", "password", "new-password");
    const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = registration ? "Create account" : "Sign in";
    element.append(submit);
    element.addEventListener("submit", async (event) => {
      event.preventDefault(); notify(""); submit.disabled = true;
      submit.textContent = registration ? "Creating account…" : "Signing in…";
      try {
        const body = Object.fromEntries(new FormData(element));
        if (invitationCode) body.invitation = invitationCode;
        if (registration && body.password !== body.confirmation) throw new Error("Passwords do not match.");
        if (registration) await api("/api/auth/register", body);
        await api("/api/auth/login", registration ? { ...body, invitation: undefined } : body);
        invitationAccepted = Boolean(invitationCode);
        await load();

      } catch (error) { notify(error.message); }
      finally { submit.disabled = false; submit.textContent = registration ? "Create account" : "Sign in"; }
    });
    content.append(element);
    const actions = document.createElement("div"); actions.className = "account-actions";
    actions.append(document.createTextNode(registration ? "Already have an account?" : "New to Agent Office?"));
    const link = document.createElement("a");
    link.href = registration ? "/login" : "/register";
    if (invitationCode) link.href += `?invite=${encodeURIComponent(invitationCode)}`;
    link.textContent = registration ? "Sign in" : "Create an account";
    actions.append(link);
    content.append(actions);
  }
  async function account() {
    root.classList.add("is-profile");
    if (mode !== "account") document.title = "Your account · Agent Office";
    const user = session.user;
    title.textContent = "Your account";
    description.textContent = "Manage your identity and access to the shared office.";
    content.replaceChildren();
    const panels = { profile: content, appearance: content, users: content };
    if (mode === 'account') {
      const tabs = document.createElement('nav');
      tabs.className = 'account-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Account sections');
      const sections = [['profile', 'Profile'], ['appearance', 'Appearance'], ...(user.role === 'admin' ? [['users', 'Users']] : [])];
      const buttons = [];
      const selectTab = (id, focus = false) => {
        root.dataset.accountTab = id;
        buttons.forEach(button => {
          const selected = button.dataset.tab === id;
          button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
          panels[button.dataset.tab].hidden = !selected;
          if (selected && focus) button.focus();
        });
      };
      content.append(tabs);
      for (const [id, label] of sections) {
        const tab = document.createElement('button');
        tab.type = 'button'; tab.id = `account-tab-${id}`; tab.dataset.tab = id; tab.textContent = label;
        tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `account-panel-${id}`);
        const panel = document.createElement('section');
        panel.id = `account-panel-${id}`; panel.className = 'account-tab-panel'; panel.tabIndex = 0;
        panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
        panels[id] = panel; buttons.push(tab); tabs.append(tab); content.append(panel);
        tab.addEventListener('click', () => selectTab(id));
        tab.addEventListener('keydown', event => {
          const index = buttons.indexOf(tab);
          const target = { ArrowRight: (index + 1) % buttons.length, ArrowLeft: (index + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[event.key];
          if (target === undefined) return;
          event.preventDefault(); selectTab(buttons[target].dataset.tab, true);
        });
      }
      selectTab(sections.some(([id]) => id === root.dataset.accountTab) ? root.dataset.accountTab : 'profile');
    }
    const profile = document.createElement("section"); profile.className = "account-profile";
    const avatar = document.createElement("div"); avatar.className = "account-avatar"; avatar.setAttribute("aria-hidden", "true"); renderUserAvatar(avatar, user);
    const identity = document.createElement("div"); identity.className = "account-identity";
    const name = document.createElement("h2"); name.textContent = user.name;
    const email = document.createElement("p"); email.textContent = user.email;
    const badge = document.createElement("span"); badge.className = `account-badge ${user.role}`; badge.textContent = user.role === "admin" ? "Administrator" : user.role;
    identity.append(name, email, badge);
    const logout = button("Sign out", async () => { await api("/api/auth/logout", {}); onSignedOut(); }); logout.className = "account-signout";
    profile.append(avatar, identity, logout); panels.profile.append(profile);
    const picker = document.createElement(mode === 'account' ? 'section' : 'details'); picker.className = 'account-avatar-picker';
    const summaryLabel = document.createElement(mode === 'account' ? 'h2' : 'summary'); summaryLabel.textContent = 'Change avatar'; picker.append(summaryLabel);
    const avatarForm = document.createElement('form'); avatarForm.className = 'avatar-choice-form';
    const choices = document.createElement('fieldset'); choices.className = 'avatar-choices';
    const legend = document.createElement('legend'); legend.textContent = 'Choose your avatar'; choices.append(legend);
    for (const choice of USER_AVATARS) {
      const label = document.createElement('label'); label.className = 'avatar-choice';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'avatar'; radio.value = choice.id; radio.checked = choice.id === (user.avatar || 'initials');
      const preview = document.createElement('span'); preview.className = 'avatar-choice-preview'; preview.setAttribute('aria-hidden', 'true'); renderUserAvatar(preview, { ...user, avatar: choice.id });
      const caption = document.createElement('span'); caption.textContent = choice.label;
      label.append(radio, preview, caption); choices.append(label);
    }
    const saveAvatar = document.createElement('button'); saveAvatar.type = 'submit'; saveAvatar.textContent = 'Save avatar';
    const avatarStatus = document.createElement('span'); avatarStatus.className = 'avatar-save-status'; avatarStatus.setAttribute('role', 'status');
    avatarForm.append(choices, saveAvatar, avatarStatus); picker.append(avatarForm); panels.appearance.append(picker);
    avatarForm.addEventListener('submit', async event => {
      event.preventDefault(); saveAvatar.disabled = true; avatarStatus.textContent = 'Saving…';
      try {
        const result = await api('/api/auth/profile', { avatar: new FormData(avatarForm).get('avatar') }, 'PATCH');
        Object.assign(user, result.user);
        onUserChanged(user);
        renderUserAvatar(avatar, user);
        avatarStatus.textContent = 'Avatar saved.';
      } catch (error) { avatarStatus.textContent = error.message; }
      finally { saveAvatar.disabled = false; }
    });
    if (user.role === "pending") {
      const pending = document.createElement("section"); pending.className = "account-notice";
      const heading = document.createElement("h2"); heading.textContent = "Awaiting approval";
      const text = document.createElement("p"); text.textContent = "An administrator needs to approve your account before you can enter the office.";
      pending.append(heading, text, button("Check access", async () => { await load(); })); content.append(pending); return;
    }
    const summary = document.createElement("section"); summary.className = "account-access";
    summary.innerHTML = `<span class="account-eyebrow">WORKSPACE ACCESS</span><h2>One office. Shared work.</h2><p>You can work with shared projects, files, agent tools, and office settings.</p>`;
    if (user.role === 'member') summary.querySelector('p').textContent = user.projectIds?.length === 0
      ? 'You can join public projects or create your own. Ask an administrator for access to other private projects.'
      : 'You can work in public projects, private projects assigned to you, and projects you create.';
    const enter = document.createElement("a"); enter.href = "/dashboard"; enter.className = "enter-office"; enter.textContent = "Open your office →"; summary.append(enter);
    panels.profile.append(summary);
    if (user.role !== "admin") return;
    const heading = document.createElement("div"); heading.className = "account-section-heading";
    heading.innerHTML = `<div><span class="account-eyebrow">ADMINISTRATION</span><h2>Users</h2><p>Approve new members and manage who can access the office.</p></div>`;
    panels.users.append(heading);
    const [{ users }, { projects }] = await Promise.all([api('/api/users'), api('/api/projects')]);
    const count = document.createElement("span"); count.className = "account-badge"; count.textContent = `${users.length} ${users.length === 1 ? "user" : "users"}`; heading.append(count);
    const roleGuide = document.createElement("div"); roleGuide.className = "account-role-guide";
    roleGuide.innerHTML = `<div><strong>Administrator</strong><span>Office access, users & factory reset</span></div><div><strong>Member</strong><span>Shared projects, tools & settings</span></div><div><strong>Pending</strong><span>Awaiting approval · no office access</span></div>`; panels.users.append(roleGuide);
    const list = document.createElement("div"); list.className = "account-user-list"; panels.users.append(list);
    const activeAdmins = users.filter(entry => entry.role === "admin" && !entry.disabled).length;
    for (const entry of users) {
      const row = document.createElement("section"); row.className = "user-card";
      const label = document.createElement("div"); label.textContent = `${entry.name}${entry.id === user.id ? " (you)" : ""}`;
      const email = document.createElement("small"); email.textContent = `${entry.email}${entry.disabled ? " · Disabled" : ""}`; label.append(email);
      const select = document.createElement("select"); select.setAttribute("aria-label", `Role for ${entry.email}`);
      for (const role of ["pending", "member", "admin"]) { const option = document.createElement("option"); option.value = role; option.textContent = role; select.append(option); }
      select.value = entry.role;
      const save = button("Save role", async () => { await api("/api/users", { id: entry.id, role: select.value }, "PATCH"); await load(); });
      const disable = button(entry.disabled ? "Enable" : "Disable", async () => { await api("/api/users", { id: entry.id, disabled: !entry.disabled }, "PATCH"); await load(); });
      save.disabled = true;
      select.addEventListener("change", () => { save.disabled = select.value === entry.role; });
      if (entry.role === "admin" && !entry.disabled && activeAdmins === 1) {
        select.disabled = true; disable.disabled = true;
        select.title = disable.title = "At least one active administrator must remain.";
      }
      const controls = document.createElement("div"); controls.className = "account-user-controls"; controls.append(select, save, disable);
      const status = document.createElement("span"); status.className = `account-badge ${entry.disabled ? "disabled" : entry.role}`; status.textContent = entry.disabled ? "Disabled" : entry.role === "pending" ? "Awaiting approval" : "Active";
      row.append(label, status, controls); list.append(row);
      if (entry.role !== 'admin') {
        const access = document.createElement('details'); access.className = 'user-project-access';
        const summary = document.createElement('summary');
        summary.textContent = `Project access · ${entry.projectIds == null ? 'All projects' : `${entry.projectIds.length} selected`}`;
        const form = document.createElement('form'); form.className = 'project-access-form';
        const scopeLabel = document.createElement('label'); scopeLabel.textContent = 'Access to projects';
        const scope = document.createElement('select'); scope.setAttribute('aria-label', `Project access for ${entry.email}`);
        for (const [value, text] of [['all', 'All projects, including future projects'], ['selected', 'Selected projects, plus public projects']]) {
          const option = document.createElement('option'); option.value = value; option.textContent = text; scope.append(option);
        }
        scope.value = entry.projectIds == null ? 'all' : 'selected'; scopeLabel.append(scope); form.append(scopeLabel);
        const choices = document.createElement('fieldset'); choices.className = 'project-access-choices';
        const legend = document.createElement('legend'); legend.textContent = 'Allowed projects'; choices.append(legend);
        for (const project of projects) {
          const label = document.createElement('label');
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'projectId'; checkbox.value = project.id;
          checkbox.checked = entry.projectIds?.includes(project.id) || false;
          label.append(checkbox, document.createTextNode(project.name)); choices.append(label);
        }
        const syncScope = () => { choices.hidden = scope.value === 'all'; };
        scope.addEventListener('change', syncScope); syncScope();
        const hint = document.createElement('p'); hint.textContent = 'Public projects remain visible to all approved members. Selecting no projects restricts existing private projects. Members automatically get access to projects they create.';
        const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Save project access';
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        form.append(choices, hint, submit, status); access.append(summary, form); row.append(access);
        form.addEventListener('submit', async event => {
          event.preventDefault(); submit.disabled = true; status.textContent = 'Saving…';
          try {
            const projectIds = scope.value === 'all' ? null : new FormData(form).getAll('projectId');
            await api('/api/users', { id: entry.id, projectIds }, 'PATCH');
            entry.projectIds = projectIds;
            summary.textContent = `Project access · ${projectIds === null ? 'All projects' : `${projectIds.length} selected`}`;
            status.textContent = 'Project access saved.';
          } catch (error) { status.textContent = error.message; }
          finally { submit.disabled = false; }
        });
      }
    }
  }
  async function load() {
    session = await api("/api/auth/session");
    if (invitationCode && !invitationInfo) invitationInfo = (await api(`/api/auth/invitation?code=${encodeURIComponent(invitationCode)}`)).invitation;
    if (session.user) {
      if (invitationInfo && !invitationAccepted) {
        title.textContent = `Join ${invitationInfo.projectName}`;
        description.textContent = `This invitation is for ${invitationInfo.email}. You are signed in as ${session.user.email}.`;
        content.replaceChildren();
        const actions = document.createElement('div'); actions.className = 'invitation-actions';
        content.append(actions);
        if (session.user.email.toLowerCase() === invitationInfo.email.toLowerCase()) {
          const join = button('Join project', async () => {
          const result = await api('/api/auth/accept-invitation', { invitation: invitationCode });
          invitationAccepted = true; onAuthenticated(result.user, invitationInfo.projectId);
          });
          join.className = 'invitation-primary';
          actions.append(join);
        }
        actions.append(button('Use another account', async () => {
          await api('/api/auth/logout', {});
          location.replace(`/login?invite=${encodeURIComponent(invitationCode)}`);
        }));
        return;
      }
      if (mode !== "account" && session.user.role !== "pending") { onAuthenticated(session.user, invitationInfo?.projectId); return; }
      onUserChanged(session.user);
      await account();
    } else if (mode === "account") location.replace("/login");
    else form(mode);
  }
  try { await load(); }
  catch (error) {
    if (invitationCode) { title.textContent = 'Invitation unavailable'; description.textContent = 'Ask the project owner for a new invitation link.'; }
    notify(error.message);
  }

}
