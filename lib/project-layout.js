export const PROJECT_LAYOUT = {
  app: "Application source, runnable website, styles, runtime assets, and application tests.",
  docs: "Requirements, specifications, architecture notes, handoff documents, and general documentation.",
  designs: "Mockups, wireframes, design source files, design tokens, and exported design references.",
  research: "Research notes, source lists, findings, datasets, and analysis.",
  scripts: "Standalone automation, setup, maintenance, and utility scripts; runtime application scripts belong in app/.",
};

export const PROJECT_LAYOUT_POLICY = `Project workspace organization:
All agents share one project root. Organize deliverables by function in these stable folders:
${Object.entries(PROJECT_LAYOUT).map(([folder, description]) => `- ${folder}/: ${description}`).join("\n")}
Inspect the existing project files before planning or creating work. Reuse and update the canonical paths used by other agents; preserve unrelated files.
Never add task-ID, task-title, worker-name, delivery-date, or duplicate project-name wrapper folders. Use descriptive filenames within the functional folders, not a new folder for each task.
For every assignment, specify exact project-relative input and output paths in its description and acceptance criteria (for example research/competitors.md, designs/homepage.png, app/index.html, docs/requirements.md).
Package deliveries as a ZIP whose entries start directly with app/, docs/, designs/, research/, or scripts/. Even a single nested file must be packaged this way because raw uploads accept a plain filename. Do not add an enclosing task or project directory to the ZIP.
Preserve application-relative paths within app/ (for example app/index.html, app/styles.css, app/assets/logo.svg). Keep runtime dependencies together so the website remains runnable at /files/<project-id>/app/.
When continuing legacy work, identify existing inputs explicitly. If reorganizing it, update imports, links, and references together; do not silently move files or invent replacement paths. Confirm the delivered file listing follows this layout before reporting completion.`;
