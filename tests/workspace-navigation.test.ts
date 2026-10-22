import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectView from "@/app/projects/[projectId]/[[...view]]/page";
import { getSessionMember } from "@/lib/auth";
import {
  WORKSPACE_SECTIONS,
  buildWorkspacePath,
  parseWorkspacePath,
  parseWorkspaceRoute,
  readWorkspaceDestination,
  workspaceShareUrl,
  type WorkspaceDestination,
} from "@/lib/workspace-navigation";

const base: WorkspaceDestination = { projectId: "sample-house", section: "overview", budgetScope: null };

vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("404"); }) }));
vi.mock("@/lib/auth", () => ({ getSessionMember: vi.fn(async () => null), publicMember: vi.fn((member) => member) }));
vi.mock("@/app/AuthGateway", () => ({ default: function AuthGateway() { return null; } }));

describe("workspace URLs", () => {
  it.each(WORKSPACE_SECTIONS)("round-trips the %s section", (section) => {
    const destination = { ...base, section };
    expect(parseWorkspacePath(buildWorkspacePath(destination))).toEqual(destination);
  });

  it("opens the project root in Overview", () => {
    expect(parseWorkspaceRoute("sample-house", undefined)).toEqual(base);
    expect(parseWorkspacePath("/projects/sample-house")).toEqual(base);
    expect(parseWorkspacePath("/projects/sample-house/")).toEqual(base);
  });

  it.each(["chapter", "type", "subcategory"] as const)("round-trips %s categories and all its sheets", (key) => {
    const category: WorkspaceDestination = { ...base, section: "budget", budgetScope: { key, label: "Pisos" } };
    expect(buildWorkspacePath(category)).toBe(`/projects/sample-house/budget/${key}/Pisos`);
    expect(parseWorkspacePath(buildWorkspacePath(category))).toEqual(category);
    const all: WorkspaceDestination = { ...category, budgetScope: { key, all: true } };
    expect(buildWorkspacePath(all)).toBe(`/projects/sample-house/budget/${key}`);
    expect(parseWorkspacePath(buildWorkspacePath(all))).toEqual(all);
  });

  it.each(["Instalación eléctrica", "Baño / cocina", "PVC 100%", "#1? A&B + C", "Niños 🏠", "  Pisos  ", "%2F literal"])("preserves the exact category name %s", (label) => {
    const destination: WorkspaceDestination = { ...base, section: "budget", budgetScope: { key: "chapter", label } };
    const path = buildWorkspacePath(destination);
    expect(parseWorkspacePath(path)).toEqual(destination);
    expect(parseWorkspacePath(new URL(path, "https://houseplanner.example").pathname)).toEqual(destination);
  });

  it("does not decode already decoded Next.js params twice", () => {
    expect(parseWorkspaceRoute(base.projectId, ["budget", "chapter", "%2F literal / PVC 100%"])).toEqual({
      ...base, section: "budget", budgetScope: { key: "chapter", label: "%2F literal / PVC 100%" },
    });
  });

  it.each(["documents", "aesthetics"] as const)("round-trips stable folder IDs in %s", (section) => {
    const destination: WorkspaceDestination = { ...base, section, folderId: "nested-folder_123" };
    expect(buildWorkspacePath(destination)).toBe(`/projects/sample-house/${section}/folder/nested-folder_123`);
    expect(parseWorkspacePath(buildWorkspacePath(destination))).toEqual(destination);
    expect(parseWorkspaceRoute(base.projectId, [section, "folder", destination.folderId!])).toEqual(destination);
    expect(parseWorkspacePath(`/projects/sample-house/${section}`)).toEqual({ ...base, section });
    expect(buildWorkspacePath({ ...base, section, folderId: null })).toBe(`/projects/sample-house/${section}`);
  });

  it.each(["Instalación eléctrica", "Niños 🏠", "#1? A&B + C", "PVC 100%", "%2F literal"])("preserves encoded folder ID %s", (folderId) => {
    const destination: WorkspaceDestination = { ...base, section: "documents", folderId };
    const path = buildWorkspacePath(destination);
    expect(parseWorkspacePath(path)).toEqual(destination);
    expect(readWorkspaceDestination(new URL(path, "https://houseplanner.example"))).toEqual(destination);
    expect(parseWorkspaceRoute(base.projectId, ["documents", "folder", folderId])).toEqual(destination);
  });

  it.each(["", " ", ".", "..", "parent/child", "parent\\child", "folder\u0000", "folder\u001f", "folder\u007f"])("rejects invalid folder ID %j", (folderId) => {
    expect(parseWorkspaceRoute(base.projectId, ["documents", "folder", folderId])).toBeNull();
    expect(parseWorkspacePath(`/projects/sample-house/aesthetics/folder/${encodeURIComponent(folderId)}`)).toBeNull();
    expect(() => buildWorkspacePath({ ...base, section: "documents", folderId })).toThrow("Invalid folder destination");
  });

  it.each(WORKSPACE_SECTIONS.filter((section) => section !== "documents" && section !== "aesthetics"))("rejects folder destinations in %s", (section) => {
    expect(parseWorkspaceRoute(base.projectId, [section, "folder", "folder-id"])).toBeNull();
    expect(() => buildWorkspacePath({ ...base, section, folderId: "folder-id" })).toThrow("Invalid folder destination");
  });

  it.each([
    "/projects/sample-house/documents/folder", "/projects/sample-house/documents/folder/",
    "/projects/sample-house/documents/folder//", "/projects/sample-house/documents/folders/id",
    "/projects/sample-house/aesthetics/folder/id/child", "/projects/sample-house/aesthetics/folder/%E0%A4%A",
    "/projects/sample-house/documents/folder/%2F", "/projects/sample-house/aesthetics/folder/%5C",
  ])("rejects malformed folder paths: %s", (path) => {
    expect(parseWorkspacePath(path)).toBeNull();
  });

  it.each([
    "/projects", "/projects/", "/projects//budget", "/projects/sample-house/unknown",
    "/projects/sample-house/documents/extra", "/projects/sample-house/budget/unknown",
    "/projects/sample-house/budget/chapter/Pisos/extra", "/projects/sample-house//budget",
    "/projects/sample-house/budget/chapter//", "/projects/sample-house/budget/chapter/%E0%A4%A",
    "/projects/%2F/budget", "/projects/%00/budget", "/other/sample-house/budget",
  ])("rejects unknown or malformed paths: %s", (path) => {
    expect(parseWorkspacePath(path)).toBeNull();
  });

  it("supports legacy links, using the active project only when needed", () => {
    expect(readWorkspaceDestination("/?project=sample-house&section=distribution&invite=secret")).toEqual({ ...base, section: "distribution" });
    expect(readWorkspaceDestination("/?project=sample-house")).toEqual(base);
    expect(readWorkspaceDestination("/?section=budget", "personal-user")).toEqual({ ...base, projectId: "personal-user", section: "budget" });
    expect(readWorkspaceDestination("/", "sample-house")).toEqual(base);
    expect(readWorkspaceDestination("/")).toBeNull();
    expect(readWorkspaceDestination("/?project=sample-house&section=missing")).toBeNull();
    expect(readWorkspaceDestination("/missing?project=sample-house&section=budget")).toBeNull();
  });

  it("prefers the canonical path over obsolete query parameters", () => {
    expect(readWorkspaceDestination(new URL("https://houseplanner.example/projects/sample-house/documents?project=other&section=budget"))).toEqual({ ...base, section: "documents" });
  });

  it("shares a canonical URL without invitation or draft parameters", () => {
    expect(workspaceShareUrl("https://houseplanner.example/?invite=secret&draft=private#editor", { ...base, section: "distribution" })).toBe("https://houseplanner.example/projects/sample-house/distribution");
  });

  it("shares a stable folder URL without access, invitation, or draft tokens", () => {
    const destination: WorkspaceDestination = { ...base, section: "documents", folderId: "child ID #2" };
    const sharedUrl = workspaceShareUrl("https://houseplanner.example/projects/other?accessLink=secret&invite=secret&draft=private#editor", destination);
    expect(sharedUrl).toBe("https://houseplanner.example/projects/sample-house/documents/folder/child%20ID%20%232");
    expect(readWorkspaceDestination(sharedUrl)).toEqual(destination);
    expect(readWorkspaceDestination(`${sharedUrl}?project=other&section=budget&accessLink=secret`)).toEqual(destination);
  });
});

describe("project view server route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the destination through authentication together with invitation parameters", async () => {
    const result = await ProjectView({ params: Promise.resolve({ projectId: base.projectId, view: ["budget", "chapter", "Pisos / Baños"] }), searchParams: Promise.resolve({ invite: "invite-token" }) });
    expect(result.props).toMatchObject({ initialUser: null, initialMode: "default", initialInvite: "invite-token", initialDestination: { ...base, section: "budget", budgetScope: { key: "chapter", label: "Pisos / Baños" } } });
    expect(getSessionMember).toHaveBeenCalledOnce();
  });

  it("opens the project root in Overview and keeps demo query compatibility", async () => {
    const result = await ProjectView({ params: Promise.resolve({ projectId: base.projectId }), searchParams: Promise.resolve({ mode: "demo", invite: ["ignored", "duplicate"] }) });
    expect(result.props).toMatchObject({ initialMode: "demo", initialInvite: "", initialDestination: base });
  });

  it("passes a nested folder destination through authentication", async () => {
    const result = await ProjectView({ params: Promise.resolve({ projectId: base.projectId, view: ["documents", "folder", "child-folder-id"] }), searchParams: Promise.resolve({}) });
    expect(result.props).toMatchObject({ initialDestination: { ...base, section: "documents", folderId: "child-folder-id" } });
    expect(getSessionMember).toHaveBeenCalledOnce();
  });

  it.each([undefined, "demo"])("passes the nested furniture tab through authentication in %s mode", async (mode) => {
    const result = await ProjectView({ params: Promise.resolve({ projectId: base.projectId, view: ["distribution", "furniture"] }), searchParams: Promise.resolve({ mode }) });
    expect(result.props).toMatchObject({ initialMode: mode || "default", initialDestination: { ...base, section: "furniture" } });
    expect(getSessionMember).toHaveBeenCalledOnce();
  });

  it("returns 404 for an unknown view before reading the session", async () => {
    await expect(ProjectView({ params: Promise.resolve({ projectId: base.projectId, view: ["unknown"] }), searchParams: Promise.resolve({}) })).rejects.toThrow("404");
    expect(getSessionMember).not.toHaveBeenCalled();
  });

  it("returns 404 for unsupported nested sections", async () => {
    await expect(ProjectView({ params: Promise.resolve({ projectId: base.projectId, view: ["distribution", "camera"] }), searchParams: Promise.resolve({}) })).rejects.toThrow("404");
    expect(getSessionMember).not.toHaveBeenCalled();
  });
});
