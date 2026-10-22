import { WORKSPACE_TABS, type WorkspaceTab } from "./project";

export const WORKSPACE_SECTIONS = [...WORKSPACE_TABS, "furniture", "access", "analytics"] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

/** Furniture uses the same model and source-document access as Distribution. */
export function workspacePermissionTab(section: Exclude<WorkspaceSection, "access" | "analytics">): WorkspaceTab {
  return section === "furniture" ? "distribution" : section;
}

export type BudgetRouteScope = {
  key: "chapter" | "type" | "subcategory";
  label?: string;
  all?: boolean;
};

export type WorkspaceDestination = {
  projectId: string;
  section: WorkspaceSection;
  budgetScope: BudgetRouteScope | null;
  folderId?: string | null;
};

const BUDGET_SCOPE_KEYS = ["chapter", "type", "subcategory"] as const;

function isWorkspaceSection(value: string): value is WorkspaceSection {
  return WORKSPACE_SECTIONS.some((section) => section === value);
}

function isBudgetScopeKey(value: string): value is BudgetRouteScope["key"] {
  return BUDGET_SCOPE_KEYS.some((key) => key === value);
}

function isProjectId(value: string) {
  return value.trim().length > 0 && value !== "." && value !== ".." && !/[\\/\u0000-\u001f\u007f]/.test(value);
}

/** Next.js has already decoded each value in params; do not decode these again. */
export function parseWorkspaceRoute(projectId: string, view: string[] | undefined): WorkspaceDestination | null {
  if (!isProjectId(projectId)) return null;
  const segments = view ?? [];
  const section = segments[0] ?? "overview";
  if (!isWorkspaceSection(section)) return null;
  if (segments.length <= 1) return { projectId, section, budgetScope: null };
  if (section === "distribution" && segments.length === 2 && segments[1] === "furniture") {
    return { projectId, section: "furniture", budgetScope: null };
  }
  if ((section === "documents" || section === "aesthetics") && segments.length === 3 && segments[1] === "folder") {
    const folderId = segments[2];
    if (!isProjectId(folderId)) return null;
    return { projectId, section, budgetScope: null, folderId };
  }
  if (section !== "budget" || segments.length > 3 || !isBudgetScopeKey(segments[1])) return null;
  if (segments.length === 2) return { projectId, section, budgetScope: { key: segments[1], all: true } };
  if (!segments[2]) return null;
  return { projectId, section, budgetScope: { key: segments[1], label: segments[2] } };
}

export function parseWorkspacePath(pathname: string): WorkspaceDestination | null {
  // A trailing slash is equivalent to its canonical path, while missing interior
  // segments are invalid. Splitting before decoding preserves slashes in labels.
  const path = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const segments = path.split("/");
  if (segments[0] !== "" || segments[1] !== "projects" || segments.length < 3) return null;
  try {
    const projectId = decodeURIComponent(segments[2]);
    const view = segments.slice(3).map((segment) => decodeURIComponent(segment));
    return parseWorkspaceRoute(projectId, view);
  } catch {
    return null;
  }
}

export function buildWorkspacePath(destination: WorkspaceDestination): string {
  const { projectId, section, budgetScope, folderId } = destination;
  if (!isProjectId(projectId) || !isWorkspaceSection(section)) throw new Error("Invalid workspace destination");
  const path = `/projects/${encodeURIComponent(projectId)}/${section === "furniture" ? "distribution/furniture" : section}`;
  if (folderId !== undefined && folderId !== null) {
    if ((section !== "documents" && section !== "aesthetics") || !isProjectId(folderId)) throw new Error("Invalid folder destination");
    return `${path}/folder/${encodeURIComponent(folderId)}`;
  }
  if (section !== "budget" || !budgetScope) return path;
  if (!isBudgetScopeKey(budgetScope.key)) throw new Error("Invalid budget category");
  if (budgetScope.all) return `${path}/${budgetScope.key}`;
  if (!budgetScope.label) throw new Error("A budget category label is required");
  return `${path}/${budgetScope.key}/${encodeURIComponent(budgetScope.label)}`;
}

/** Reads canonical paths or the existing root ?project=…&section=… links. */
export function readWorkspaceDestination(url: URL | string, fallbackProjectId?: string): WorkspaceDestination | null {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url, "http://workspace.local") : url;
  } catch {
    return null;
  }
  if (parsed.pathname !== "/") return parseWorkspacePath(parsed.pathname);
  const projectId = parsed.searchParams.get("project") || fallbackProjectId;
  if (!projectId) return null;
  const section = parsed.searchParams.get("section");
  return parseWorkspaceRoute(projectId, section === null ? undefined : [section]);
}

/** Shared links only contain the destination, never draft or invitation tokens. */
export function workspaceShareUrl(origin: string, destination: WorkspaceDestination): string {
  return new URL(buildWorkspacePath(destination), new URL(origin).origin).href;
}
