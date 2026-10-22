import { describe, expect, it } from "vitest";
import { BROWSER_SMOKE, selectBrowserTests } from "../scripts/ci-browser-scope.mjs";

describe("applicable bounded browser coverage", () => {
  it("justifies no browser run for skills, guides and release tooling", () => {
    expect(selectBrowserTests([".agents/skills/house-planner-release/SKILL.md", "AGENTS.md", "docs/operations/releases.md", "scripts/release-ci.mjs", ".github/workflows/ci.yml"])).toMatchObject({ required: false, tests: [] });
  });
  it("selects smoke and the affected purchase flow without the entire regression", () => {
    expect(selectBrowserTests(["app/components/ExpensesWorkspace.tsx", "lib/expenses.ts"])).toMatchObject({ required: true, tests: ["e2e/budget-purchase-links.spec.ts", BROWSER_SMOKE] });
  });
  it("covers unknown application paths, shared styles and dependencies with smoke", () => {
    for (const path of ["app/new-widget.tsx", "app/globals.css", "lib/new-domain.ts", "package-lock.json"]) expect(selectBrowserTests([path]).tests).toContain(BROWSER_SMOKE);
  });
  it("selects bounded project currency controls for schema, API and interface changes", () => {
    for (const path of ["lib/currency.ts", "lib/project-currency.ts", "lib/project.ts", "app/api/projects/route.ts", "app/components/ProjectCurrencyDialog.tsx", "app/HousePlanner.tsx"]) {
      expect(selectBrowserTests([path]).tests).toContain("e2e/project-currency.spec.ts");
      expect(selectBrowserTests([path]).tests).not.toContain("e2e/qa-regression.spec.ts");
    }
  });
  it("runs an edited routine spec but leaves guarded QA opt-in", () => {
    expect(selectBrowserTests(["e2e/countdown-completion.spec.ts"]).tests).toEqual(["e2e/countdown-completion.spec.ts"]);
    expect(selectBrowserTests(["e2e/qa-regression.spec.ts", "e2e/qa/fixtures.ts"]).required).toBe(false);
  });
  it("rejects malformed paths and does not treat path text as executable arguments", () => {
    for (const path of ["../app/a.ts", "/app/a.ts", "app//a.ts", "app/a\n.ts"]) expect(() => selectBrowserTests([path])).toThrow();
    expect(selectBrowserTests(["docs/$(command).md"]).tests).toEqual([]);
  });
});
