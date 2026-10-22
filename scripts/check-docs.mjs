import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function prose(markdown) {
  return markdown.replace(/```[^\n]*\n[\s\S]*?```/g, "")
    .replace(/~~~[^\n]*\n[\s\S]*?~~~/g, "").replace(/<!--[\s\S]*?-->/g, "");
}

export function headingAnchors(markdown) {
  const seen = new Map();
  return new Set([...prose(markdown).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map(match => {
    const base = match[1].toLowerCase().replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/ /g, "-");
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  }));
}

export function referenceError(root, file, target) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return null;
  const cleaned = target.replace(/^<|>$/g, "").split("?")[0];
  const [pathname, fragment] = cleaned.split("#");
  let destination;
  try { destination = resolve(dirname(file), decodeURIComponent(pathname || relative(dirname(file), file))); }
  catch { return `invalid URL encoding: ${target}`; }
  if (destination !== root && !destination.startsWith(`${root}${sep}`)) return `reference leaves repository: ${target}`;
  if (!existsSync(destination)) return `missing target: ${target}`;
  if (fragment && extname(destination) === ".md") {
    let anchor;
    try { anchor = decodeURIComponent(fragment); } catch { return `invalid anchor encoding: ${target}`; }
    const contents = readFileSync(destination, "utf8");
    const explicit = new RegExp(`(?:id|name)=["']${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(contents);
    if (!headingAnchors(contents).has(anchor) && !explicit) return `missing heading: ${target}`;
  }
  return null;
}


export function traceabilityErrors(root, records, requirements, taskIds, commitExists, archivedCommits = new Set()) {
  const errors = [], seen = new Set();
  if (!Array.isArray(records)) return ["Traceability must be an array"];
  for (const record of records) {
    if (!record || typeof record !== "object") { errors.push("Invalid traceability record"); continue; }
    const label = record.requirement || "unknown";
    if (!requirements.has(label) || seen.has(label)) errors.push(`Unknown or duplicate requirement: ${label}`);
    seen.add(label);
    if (typeof record.decision !== "string" || !record.decision.trim()) errors.push(`${label}: missing decision`);
    else {
      const error = referenceError(root, resolve(root, "README.md"), record.decision);
      if (error || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(record.decision)) errors.push(`${label}: decision must resolve locally`);
    }
    if (!Array.isArray(record.tasks) || !record.tasks.length) errors.push(`${label}: no tasks`);
    else for (const task of record.tasks) if (!taskIds.has(task)) errors.push(`${label}: unknown task ${task}`);
    if (!Array.isArray(record.commits) || !record.commits.length) errors.push(`${label}: no commits`);
    else for (const commit of record.commits) {
      const historicalReference = record.provenance === "private-history" && archivedCommits.has(commit);
      if (!/^[a-f0-9]{40}$/.test(commit) || (!historicalReference && !commitExists(commit))) errors.push(`${label}: missing commit object ${commit}`);
    }
    if (!Array.isArray(record.evidence) || !record.evidence.length) errors.push(`${label}: no evidence`);
    else for (const evidence of record.evidence) {
      if (typeof evidence !== "string" || !evidence.trim()) { errors.push(`${label}: empty evidence`); continue; }
      const error = referenceError(root, resolve(root, "README.md"), evidence);
      if (error || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(evidence)) errors.push(`${label}: evidence must resolve locally: ${evidence}`);
    }
  }
  for (const requirement of requirements) if (!seen.has(requirement)) errors.push(`Missing traceability: ${requirement}`);
  return errors;
}

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}

export function checkDocumentation(root) {
  const files = [...markdownFiles(resolve(root, "docs")), ...markdownFiles(resolve(root, "specs")),
    ...readdirSync(root).filter(name => name.endsWith(".md")).map(name => resolve(root, name)),
    resolve(root, ".github/pull_request_template.md"), resolve(root, ".specify/memory/constitution.md")];
  const errors = [];
  const archivePath = resolve(root, "docs/portfolio/private-history-references.json");
  let archivedFeatures = {};
  if (existsSync(archivePath)) {
    try {
      const archive = JSON.parse(readFileSync(archivePath, "utf8"));
      if (archive.scope !== "private-development-history" || !archive.features || typeof archive.features !== "object") throw new Error("invalid scope/features");
      for (const commits of Object.values(archive.features)) {
        if (!Array.isArray(commits) || commits.some(commit => !/^[a-f0-9]{40}$/.test(commit))) throw new Error("invalid historical commit identifier");
      }
      archivedFeatures = archive.features;
    } catch (error) { errors.push(`Invalid historical traceability manifest: ${error.message}`); }
  }
  let localReferences = 0;
  for (const file of files) {
    if (!existsSync(file)) { errors.push(`${relative(root, file)}: missing required document`); continue; }
    const content = prose(readFileSync(file, "utf8"));
    const references = [...content.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\)/g)]
      .map(match => match[1]);
    references.push(...[...content.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(match => match[1]));
    for (const target of references) {
      if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) localReferences++;
      const error = referenceError(root, file, target);
      if (error) errors.push(`${relative(root, file)}: ${error}`);
    }
    if (/\[NEEDS CLARIFICATION:|\[FEATURE NAME\]|\[PROJECT_NAME\]/.test(content)) {
      errors.push(`${relative(root, file)}: unresolved authored placeholder`);
    }
  }
  for (const featureName of readdirSync(resolve(root, "specs")).filter(name => /^\d{3}-/.test(name))) {
  const feature = resolve(root, "specs", featureName);
  for (const name of ["spec", "plan", "research", "data-model", "quickstart", "tasks", "analysis", "traceability", "validation", "convergence"]) {
    if (!existsSync(resolve(feature, `${name}.md`))) errors.push(`specs/${featureName}: missing ${name}.md`);
  }
  const specPath = resolve(feature, "spec.md"), tasksPath = resolve(feature, "tasks.md"), tracePath = resolve(feature, "traceability.md");
  if ([specPath, tasksPath, tracePath].every(existsSync)) {
    const requirements = new Set(readFileSync(specPath, "utf8").match(/FR-\d{3}/g));
    for (const path of [tasksPath, tracePath]) {
      const contents = readFileSync(path, "utf8");
      for (const requirement of requirements) if (!contents.includes(requirement)) errors.push(`${relative(root, path)}: unmapped ${requirement}`);
    }
  }
  const recordsPath = resolve(feature, "traceability.json");
  if (!existsSync(recordsPath)) errors.push("Missing structured traceability.json");
  else if ([specPath, tasksPath].every(existsSync)) {
    try {
      const required = new Set(readFileSync(specPath, "utf8").match(/FR-\d{3}/g));
      const taskContents = readFileSync(tasksPath, "utf8");
      const taskIds = new Set([...taskContents.matchAll(/^- \[[ xX]\] (T\d{3})\b/gm)].map(match => match[1]));
      const existsCommit = commit => {
        try { execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: root, stdio: "ignore" }); return true; }
        catch { return false; }
      };
      errors.push(...traceabilityErrors(root, JSON.parse(readFileSync(recordsPath, "utf8")), required, taskIds, existsCommit,
        new Set(archivedFeatures[featureName] || [])));
      const convergencePath = resolve(feature, "convergence.md");
      if (existsSync(convergencePath) && /\*\*Status\*\*: Converged/.test(readFileSync(convergencePath, "utf8"))
          && /^- \[ \] T\d{3}/m.test(taskContents)) errors.push("Converged feature contains incomplete tasks");
    } catch (error) { errors.push(`Invalid structured traceability: ${error.message}`); }
  }
  }
  const integration = JSON.parse(readFileSync(resolve(root, ".specify/integration.json"), "utf8"));
  if (integration.version !== "1.2.0" || integration.default_integration !== "codex") errors.push("Spec Kit pin/integration drift");
  const cases = resolve(root, "docs/development/cases");
  const caseFiles = markdownFiles(cases).filter(file => !file.endsWith(`${sep}README.md`));
  if (caseFiles.length !== 3) errors.push("Expected exactly three reconstructed design cases");
  for (const file of caseFiles) {
    if (!readFileSync(file, "utf8").includes("Reconstructed design")) errors.push(`${relative(root, file)}: missing retrospective status`);
  }
  return { documents: files.length, localReferences, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkDocumentation(root);
  for (const error of result.errors) console.error(error);
  console.log(`Documentation: ${result.documents} files, ${result.localReferences} local references, ${result.errors.length} errors.`);
  if (result.errors.length) process.exitCode = 1;
}
