import { describe, expect, it } from "vitest";
import { normalizePermissions, WORKSPACE_TABS } from "@/lib/project";
import {
  buildWorkspacePath,
  parseWorkspacePath,
  parseWorkspaceRoute,
  readWorkspaceDestination,
  workspacePermissionTab,
  workspaceShareUrl,
  type WorkspaceDestination,
} from "@/lib/workspace-navigation";

const furniture: WorkspaceDestination = { projectId: "sample-house", section: "furniture", budgetScope: null };

describe("Furniture within the Distribution workspace", () => {
  it("opens and shares the furniture tab within Sample House distribution", () => {
    expect(buildWorkspacePath(furniture)).toBe("/projects/sample-house/distribution/furniture");
    expect(parseWorkspaceRoute("sample-house", ["distribution", "furniture"])).toEqual(furniture);
    expect(parseWorkspacePath("/projects/sample-house/distribution/furniture")).toEqual(furniture);
    expect(parseWorkspacePath("/projects/sample-house/distribution/furniture/")).toEqual(furniture);
    expect(workspaceShareUrl("https://houseplanner.example/?accessLink=private&invite=private#draft", furniture)).toBe("https://houseplanner.example/projects/sample-house/distribution/furniture");
    expect(readWorkspaceDestination("/projects/sample-house/distribution/furniture?project=other&section=budget")).toEqual(furniture);
  });

  it("keeps existing furniture links compatible and shares their canonical nested path", () => {
    expect(parseWorkspaceRoute("sample-house", ["furniture"])).toEqual(furniture);
    expect(parseWorkspacePath("/projects/sample-house/furniture")).toEqual(furniture);
    expect(readWorkspaceDestination("/?project=sample-house&section=furniture")).toEqual(furniture);
    expect(readWorkspaceDestination("/?section=furniture", "sample-house")).toEqual(furniture);
    expect(buildWorkspacePath(parseWorkspacePath("/projects/sample-house/furniture")!)).toBe("/projects/sample-house/distribution/furniture");
  });

  it.each([
    "/projects/sample-house/furniture/extra",
    "/projects/sample-house/furniture/furniture",
    "/projects/sample-house/distribution/furniture/extra",
    "/projects/sample-house/distribution/furniture//",
    "/projects/sample-house/distribution//furniture",
    "/projects/sample-house/distribution/furniture/folder/id",
    "/projects/sample-house/distribution/camera",
    "/projects/sample-house/distribution/%2Ffurniture",
    "/projects/sample-house/distribution/%E0%A4%A",
  ])("rejects unsupported or malformed furniture paths: %s", (path) => {
    expect(parseWorkspacePath(path)).toBeNull();
  });

  it("keeps demo furniture independent from the private project", () => {
    const demo = { ...furniture, projectId: "demo" };
    expect(parseWorkspacePath(buildWorkspacePath(demo))).toEqual(demo);
    expect(buildWorkspacePath(demo)).toBe("/projects/demo/distribution/furniture");
    expect(readWorkspaceDestination("/projects/demo/distribution/furniture?mode=demo")).toEqual(demo);
    expect(parseWorkspacePath("/projects/demo/furniture")).toEqual(demo);
    expect(buildWorkspacePath({ ...furniture, section: "distribution" })).toBe("/projects/sample-house/distribution");
  });

  it("inherits Distribution access without accepting a separate persisted furniture grant", () => {
    const denied = normalizePermissions({ distribution: false, furniture: true });
    const allowed = normalizePermissions({ distribution: true });
    expect(denied[workspacePermissionTab("furniture")]).toBe(false);
    expect(allowed[workspacePermissionTab("furniture")]).toBe(true);
    expect(denied).not.toHaveProperty("furniture");
    expect(WORKSPACE_TABS).not.toContain("furniture");
    expect(workspacePermissionTab("documents")).toBe("documents");
  });
});
