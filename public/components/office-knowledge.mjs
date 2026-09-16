import OfficeComponent from "./office-component.mjs";
import { escapeHtml, scheduleTime, formatBytes, fetchJson } from "./office-format.mjs";

class OfficeKnowledge extends OfficeComponent {
  static hostAttributes = {"class": "panel knowledge-panel"};
  model = { skills: [] };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#journal-code" })
          ] }),
          this.createElement("h2", { textContent: "SKILL FILES" })
        ] }),
        this.createElement("button", { "class": "header-action", "id": "add-skill-file-button", "type": "button", textContent: "+ ADD SKILL FILE" })
      ] }),
      this.createElement("div", { "class": "skills-summary panel-body", children: [
        this.createElement("strong", { "id": "enabled-skills-count", textContent: "0 ENABLED" }),
        this.createElement("span", { textContent: "Enabled skill files are included in the active agent preset." })
      ] }),
      this.createElement("div", { "class": "skills-table-wrap panel-body", children: [
        this.createElement("table", { "class": "skills-table", children: [
          this.createElement("thead", { children: [
            this.createElement("tr", { children: [
              this.createElement("th", { textContent: "ENABLED" }),
              this.createElement("th", { textContent: "SKILL" }),
              this.createElement("th", { textContent: "FILE" }),
              this.createElement("th", { textContent: "SIZE" }),
              this.createElement("th", { textContent: "UPDATED" }),
              this.createElement("th", { textContent: "ACTIONS" })
            ] })
          ] }),
          this.createElement("tbody", { "id": "skills-body" })
        ] })
      ] }),
      this.createElement("input", { "id": "skill-file-input", "type": "file", "accept": ".md,text/markdown,text/plain", "multiple": "", "hidden": "" })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });
    const addLog = (source, text, tone = "") => this.emit("office-log", { source, text, tone });
    function renderSkills() {
      const body = $("#skills-body");
      if (!body) return;
      const enabled = state.skills.filter((skill) => skill.selected).length;
      $("#enabled-skills-count").textContent = `${enabled} ENABLED`;
      body.innerHTML = state.skills.length ? state.skills.map((skill) => `<tr>
        <td><input class="skill-toggle" type="checkbox" data-skill="${escapeHtml(skill.id)}" ${skill.selected ? "checked" : ""} aria-label="Enable ${escapeHtml(skill.name)}"></td>
        <td><strong class="skill-name">${escapeHtml(skill.name)}</strong></td>
        <td><span class="skill-file">${escapeHtml(skill.name)}/SKILL.md</span></td>
        <td>${formatBytes(new Blob([skill.content]).size)}</td>
        <td>${scheduleTime(skill.updatedAt)}</td>
        <td><button class="skill-delete" type="button" data-skill="${escapeHtml(skill.id)}">DELETE</button></td>
      </tr>`).join("") : `<tr class="empty-row"><td colspan="6">NO SKILL FILES ADDED</td></tr>`;
    }

    async function loadSkills() {
      try {
        const data = await fetchJson("/api/skills");
        state.skills = data.skills || [];
        renderSkills();
      } catch (error) {
        showToast(error.message, true);
      }
    }

    async function mutateSkills(method, payload) {
      const response = await fetch("/api/skills", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      state.skills = data.skills || [];
      renderSkills();
      return data;
    }

    function skillNameFromFile(file, content) {
      const frontMatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] || "";
      const declared = /^name\s*:\s*([^\n]+)$/m.exec(frontMatter)?.[1]?.trim();
      const candidate = declared || file.name.replace(/\.[^.]+$/, "");
      return candidate.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
    }
    $("#add-skill-file-button").addEventListener("click", () => $("#skill-file-input").click());
    $("#skill-file-input").addEventListener("change", async (event) => {
      const files = [...event.target.files];
      event.target.value = "";
      if (!files.length) return;
      const errors = [];
      let added = 0;
      for (const file of files) {
        try {
          if (file.size > 2_000_000) throw new Error(`${file.name} is larger than 2 MB.`);
          const content = await file.text();
          const name = skillNameFromFile(file, content);
          if (!name) throw new Error(`${file.name} does not have a valid skill name.`);
          await mutateSkills("POST", { name, content });
          added += 1;
        } catch (error) {
          errors.push(`${file.name}: ${error.message}`);
        }
      }
      if (added) {
        addLog("Knowledge", `Added ${added} skill file${added === 1 ? "" : "s"}`, "success");
        showToast(`${added} skill file${added === 1 ? "" : "s"} added.${errors.length ? ` ${errors.length} failed.` : ""}`, Boolean(errors.length));
      } else if (errors.length) showToast(errors[0], true);
    });
    $("#skills-body").addEventListener("change", async (event) => {
      const checkbox = event.target.closest("input.skill-toggle[data-skill]");
      if (!checkbox) return;
      checkbox.disabled = true;
      const selectedSkillIds = state.skills
        .filter((skill) => skill.id === checkbox.dataset.skill ? checkbox.checked : skill.selected)
        .map((skill) => skill.id);
      try {
        await mutateSkills("PUT", { selectedSkillIds });
        showToast(`Skill ${checkbox.checked ? "enabled" : "disabled"}.`);
      } catch (error) {
        showToast(error.message, true);
        renderSkills();
      }
    });
    $("#skills-body").addEventListener("click", async (event) => {
      const button = event.target.closest("button.skill-delete[data-skill]");
      if (!button) return;
      const skill = state.skills.find((entry) => entry.id === button.dataset.skill);
      if (!skill || !window.confirm(`Delete skill file “${skill.name}/SKILL.md”?`)) return;
      button.disabled = true;
      try {
        await mutateSkills("DELETE", { skillId: skill.id });
        addLog("Knowledge", `Deleted skill ${skill.name}`, "success");
        showToast(`${skill.name}/SKILL.md deleted.`);
      } catch (error) {
        showToast(error.message, true);
        button.disabled = false;
      }
    });

    this.load = loadSkills;
    this.update = renderSkills;
  }
}

customElements.define("office-knowledge", OfficeKnowledge);
export default OfficeKnowledge;
