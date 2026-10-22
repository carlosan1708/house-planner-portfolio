// @vitest-environment jsdom

import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthGateway from "@/app/AuthGateway";
import Home from "@/app/page";
import { getSessionMember } from "@/lib/auth";
import { type WorkspaceDestination } from "@/lib/workspace-navigation";

const auth = vi.hoisted(() => {
  const getIdToken = vi.fn(async () => "firebase-session-token");
  const user = { getIdToken, emailVerified: true };
  const credential = { user };
  return {
    user,
    getIdToken,
    signInWithEmailAndPassword: vi.fn(async () => credential),
    signInWithPopup: vi.fn(async () => credential),
    createUserWithEmailAndPassword: vi.fn(async () => credential),
    signOut: vi.fn(async () => undefined),
    updateProfile: vi.fn(async () => undefined),
    sendEmailVerification: vi.fn(async () => undefined),
  };
});

vi.mock("firebase/auth", () => ({ ...auth, GoogleAuthProvider: class GoogleAuthProvider {} }));
vi.mock("@/lib/firebase-client", () => ({ firebaseAuth: {} }));
vi.mock("@/lib/usage-client", () => ({ useUsageTracking: () => undefined, flushUsageBeforeTransition: async () => undefined }));
vi.mock("@/lib/auth", () => ({ getSessionMember: vi.fn(async () => null), publicMember: (member: unknown) => member }));
vi.mock("@/app/SiteFooter", () => ({ default: () => null }));
vi.mock("@/app/HousePlanner", () => ({
  default: function MockHousePlanner(props: { mode: string; initialDestination?: WorkspaceDestination | null; user?: { readOnlyLink?: boolean; anonymousLink?: boolean; name?: string; projectName?: string }; initialLanguage?: string; onSwitchMode: () => void }) {
    const [initialMode] = useState(props.mode);
    const [firstLanguage] = useState(props.initialLanguage);
    return createElement("section", { "data-mode": props.mode, "data-initial-mode": initialMode, "data-destination": JSON.stringify(props.initialDestination), "data-read-only-link": String(props.user?.readOnlyLink === true), "data-anonymous-link": String(props.user?.anonymousLink === true), "data-language": props.initialLanguage, "data-first-language": firstLanguage, "data-user-name": props.user?.name, "data-project-name": props.user?.projectName }, createElement("button", { onClick: props.onSwitchMode }, "Switch workspace mode"));
  },
}));

const destination: WorkspaceDestination = { projectId: "sample-house", section: "budget", budgetScope: { key: "chapter", label: "Pisos" } };
const directPath = "/projects/sample-house/budget/chapter/Pisos";
const approvedUser = { name: "Owner", email: "owner@example.test", projectId: "personal-owner", projectName: "My workspace", isPersonal: true, role: "admin" as const, status: "approved" as const, permissions: { overview: true, activity: true, budget: true, quotes: true, expenses: true, documents: true, notes: true, aesthetics: true, distribution: true, approvals: true, plan: true, decisions: true, site: true }, folderAccess: { mode: "all" as const, folderIds: [], allowUnfiled: true } };
const nativeWindow = window;
let root: Root | null = null;
let container: HTMLDivElement;
let reload: ReturnType<typeof vi.fn>;
let requests: Array<{ url: string; method?: string; body: Record<string, unknown> }>;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user.emailVerified = true;
  vi.mocked(getSessionMember).mockResolvedValue(null);
  nativeWindow.localStorage.clear();
  nativeWindow.localStorage.setItem("house-planner-language", "en");
  nativeWindow.history.replaceState({}, "", "/");
  reload = vi.fn();
  requests = [];
  // JSDOM's Location.reload is non-configurable. Keep its real history/URL
  // while substituting only the reload operation after a mocked session POST.
  const location = {
    get href() { return nativeWindow.location.href; },
    get pathname() { return nativeWindow.location.pathname; },
    get search() { return nativeWindow.location.search; },
    get hash() { return nativeWindow.location.hash; },
    reload,
  };
  vi.stubGlobal("window", new Proxy({}, { get: (_, key) => key === "location" ? location : Reflect.get(nativeWindow, key, nativeWindow) }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body || "{}")) });
    return new Response(JSON.stringify({ ok: true, projectId: "sample-house" }), { status: 200 });
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function renderGateway(options: Partial<Parameters<typeof AuthGateway>[0]> = {}, strict = false) {
  await act(async () => {
    const gateway = createElement(AuthGateway, { initialUser: null, initialMode: "default", initialInvite: "", ...options });
    root!.render(strict ? createElement(StrictMode, null, gateway) : gateway);
  });
  await act(async () => { await new Promise((resolve) => nativeWindow.setTimeout(resolve, 1)); });
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label || item.textContent?.includes(label));
  expect(button, `Missing button: ${label}`).toBeDefined();
  await act(async () => { button!.click(); });
}

describe("invited account mailbox verification", () => {
  it("sends verification for an unverified invited user without minting a session or opening the project", async () => {
    auth.user.emailVerified = false;
    await renderGateway({ initialInvite: "private-invite", initialDestination: destination });
    expect(container.textContent).toContain("PROJECT INVITATION");
    await clickButton("Continue with Google");
    expect(auth.sendEmailVerification).toHaveBeenCalledOnce();
    expect(auth.sendEmailVerification).toHaveBeenCalledWith(auth.user);
    expect(auth.getIdToken).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("We sent a verification link to your email");
    expect(container.querySelector('[data-mode="real"]')).toBeNull();
  });

  it("allows a verified invited user to establish the session with its invitation and destination", async () => {
    await renderGateway({ initialInvite: "private-invite", initialDestination: destination });
    expect(container.textContent).toContain("PROJECT INVITATION");
    await clickButton("Continue with Google");
    expect(auth.sendEmailVerification).not.toHaveBeenCalled();
    expect(auth.getIdToken).toHaveBeenCalledWith(true);
    expect(requests).toEqual([{ url: "/api/session", method: "POST", body: { inviteToken: "private-invite", requestedProjectId: "sample-house" } }]);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("workspace destination during authentication", () => {
  it("opens a public link without Firebase login, preserving the selected view and language", async () => {
    nativeWindow.history.replaceState({}, "", `${directPath}?accessLink=public-token&lang=es`);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body || "{}")) });
      return new Response(JSON.stringify({ ok: true, projectId: "sample-house", publicAccess: true, defaultLanguage: "en" }), { status: 200 });
    }));
    await renderGateway({ initialDestination: destination, initialAccessLink: "public-token", initialLanguage: "es" }, true);
    expect(requests).toEqual([{ url: "/api/access-links/redeem", method: "POST", body: { token: "public-token", requestedProjectId: "sample-house" } }]);
    expect(auth.signInWithPopup).not.toHaveBeenCalled();
    expect(auth.signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="password"]')).toBeNull();
    expect(nativeWindow.location.pathname).toBe(directPath);
    expect(nativeWindow.location.search).toBe("?lang=es");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("uses the server link language when a public root URL omits lang", async () => {
    nativeWindow.history.replaceState({}, "", "/?accessLink=public-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, projectId: "sample-house", publicAccess: true, defaultLanguage: "es" }), { status: 200 })));
    await renderGateway({ initialAccessLink: "public-token" });
    expect(nativeWindow.location.pathname).toBe("/projects/sample-house/overview");
    expect(nativeWindow.location.search).toBe("?lang=es");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("forwards the explicit language and anonymous read-only context after guest redemption", async () => {
    await renderGateway({ initialLanguage: "es", initialDestination: destination, initialUser: { ...approvedUser, projectId: "sample-house", isPersonal: false, role: "viewer", readOnlyLink: true, anonymousLink: true, linkDefaultLanguage: "en" } });
    const workspace = container.querySelector('[data-mode="real"]');
    expect(workspace?.getAttribute("data-language")).toBe("es");
    expect(workspace?.getAttribute("data-anonymous-link")).toBe("true");
  });

  it("blocks an expired public link without showing credentials or project data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Link expired" }), { status: 410 })));
    await renderGateway({ initialAccessLink: "expired-public-token" });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Link expired");
    expect(container.querySelector('input[name="password"]')).toBeNull();
    expect(container.querySelector('[data-mode]')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("accepts a root capability for another project through the server Home page without substituting the active project", async () => {
    nativeWindow.history.replaceState({}, "", "/?accessLink=private-reader-token&connection=keep");
    vi.mocked(getSessionMember).mockResolvedValue({ uid: "owner", ...approvedUser });
    await act(async () => { root!.render(await Home({ searchParams: Promise.resolve({ accessLink: "private-reader-token", connection: "keep" }) })); });
    await act(async () => { await new Promise(resolve => nativeWindow.setTimeout(resolve, 1)); });
    expect(requests).toEqual([{ url: "/api/access-links/redeem", method: "POST", body: { token: "private-reader-token" } }]);
    expect(nativeWindow.location.pathname).toBe("/projects/sample-house/overview");
    expect(nativeWindow.location.search).toBe("?connection=keep");
    expect(container.querySelector('[data-mode]')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("uses the link project for a legacy root section even when another project is signed in", async () => {
    nativeWindow.history.replaceState({}, "", "/?accessLink=public-token&section=documents&lang=es");
    vi.mocked(getSessionMember).mockResolvedValue({ uid: "owner", ...approvedUser });
    await act(async () => { root!.render(await Home({ searchParams: Promise.resolve({ accessLink: "public-token", section: "documents", lang: "es" }) })); });
    expect(requests[0].body).toEqual({ token: "public-token" });
    expect(nativeWindow.location.pathname).toBe("/projects/sample-house/documents");
    expect(nativeWindow.location.search).toBe("?lang=es");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("uses the first enabled section for a capability without a destination", async () => {
    nativeWindow.history.replaceState({}, "", "/?accessLink=public-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, projectId: "sample-house", publicAccess: true, defaultLanguage: "es", defaultSection: "documents" }), { status: 200 })));
    await renderGateway({ initialAccessLink: "public-token" });
    expect(nativeWindow.location.pathname).toBe("/projects/sample-house/documents");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("retains an explicitly requested legacy project through the server Home page when accepting a root capability", async () => {
    nativeWindow.history.replaceState({}, "", "/?accessLink=private-reader-token&project=sample-house&section=documents");
    vi.mocked(getSessionMember).mockResolvedValue({ uid: "owner", ...approvedUser });
    await act(async () => { root!.render(await Home({ searchParams: Promise.resolve({ accessLink: "private-reader-token", project: "sample-house", section: "documents" }) })); });
    await act(async () => { await new Promise(resolve => nativeWindow.setTimeout(resolve, 1)); });
    expect(requests[0].body).toEqual({ token: "private-reader-token", requestedProjectId: "sample-house" });
    expect(nativeWindow.location.pathname).toBe("/projects/sample-house/documents");
    expect(nativeWindow.location.search).toBe("");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("offers any account read-only entry and accepts the link in the sign-in session before removing the capability", async () => {
    nativeWindow.history.replaceState({ marker: "next" }, "", `${directPath}?accessLink=private-reader-token&connection=keep&mode=demo#selected`);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body || "{}")) });
      return String(input) === "/api/access-links/redeem"
        ? new Response(JSON.stringify({ error: "Sign in required" }), { status: 401 })
        : new Response(JSON.stringify({ ok: true, projectId: "sample-house" }), { status: 200 });
    }));
    await renderGateway({ initialDestination: destination, initialAccessLink: "private-reader-token", initialMode: "demo" });
    expect(container.textContent).toContain("READ-ONLY ACCESS LINK");
    expect(container.textContent).toContain("Sign in or create an account");
    expect(container.textContent).not.toContain("Use the invited email");
    expect(container.querySelector('[data-mode]')).toBeNull();
    await clickButton("Continue with Google");
    expect(requests).toEqual([{ url: "/api/access-links/redeem", method: "POST", body: { requestedProjectId: "sample-house", token: "private-reader-token" } }, { url: "/api/session", method: "POST", body: { requestedProjectId: "sample-house", accessLinkToken: "private-reader-token" } }]);
    expect(nativeWindow.location.pathname).toBe(directPath);
    expect(nativeWindow.location.search).toBe("?connection=keep");
    expect(nativeWindow.location.hash).toBe("#selected");
    expect(nativeWindow.history.state).toEqual({ marker: "next" });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("redeems a signed-in personal user's link only once in StrictMode before rendering project data", async () => {
    nativeWindow.history.replaceState({}, "", `${directPath}?accessLink=private-reader-token&google=connected`);
    await renderGateway({ initialDestination: destination, initialAccessLink: "private-reader-token", initialUser: approvedUser }, true);
    expect(requests).toEqual([{ url: "/api/access-links/redeem", method: "POST", body: { token: "private-reader-token", requestedProjectId: "sample-house" } }]);
    expect(container.querySelector('[data-mode]')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
    expect(nativeWindow.location.pathname).toBe(directPath);
    expect(nativeWindow.location.search).toBe("?google=connected");
  });

  it("also redeems pending users before showing their approval screen", async () => {
    nativeWindow.history.replaceState({}, "", `${directPath}?accessLink=private-reader-token`);
    await renderGateway({ initialDestination: destination, initialAccessLink: "private-reader-token", initialUser: { ...approvedUser, status: "pending" } });
    expect(requests[0].url).toBe("/api/access-links/redeem");
    expect(container.textContent).not.toContain("Your access is pending approval.");
    expect(container.querySelector('[data-mode]')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("canonicalizes a root read link to the redeemed project when no destination was specified", async () => {
    nativeWindow.history.replaceState({}, "", "/?accessLink=private-reader-token&connection=keep");
    await renderGateway({ initialAccessLink: "private-reader-token", initialUser: approvedUser });
    expect(requests[0].body).toEqual({ token: "private-reader-token" });
    expect(nativeWindow.location.pathname).toBe("/projects/sample-house/overview");
    expect(nativeWindow.location.search).toBe("?connection=keep");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("retains a revoked link for retry and can recover to the user's current project without loading the shared project", async () => {
    nativeWindow.history.replaceState({}, "", `${directPath}?accessLink=revoked-token&connection=keep`);
    const redeem = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/projects") return new Response(JSON.stringify(init?.method === "PATCH" ? { ok: true } : { projects: [{ id: "personal-owner", kind: "personal" }] }), { status: 200 });
      return new Response(JSON.stringify({ error: "Access link has been revoked" }), { status: 403 });
    });
    vi.stubGlobal("fetch", redeem);
    await renderGateway({ initialDestination: destination, initialAccessLink: "revoked-token", initialUser: approvedUser }, true);
    expect(redeem).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Access link has been revoked");
    expect(container.querySelector('[data-mode]')).toBeNull();
    expect(nativeWindow.location.search).toContain("accessLink=revoked-token");
    expect(reload).not.toHaveBeenCalled();
    await clickButton("Try again");
    expect(redeem).toHaveBeenCalledTimes(2);
    await clickButton("Open my current project");
    expect(nativeWindow.location.pathname).toBe("/projects/personal-owner/overview");
    expect(nativeWindow.location.search).toBe("?connection=keep");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps the read capability and destination when the sign-in session rejects the link", async () => {
    nativeWindow.history.replaceState({}, "", `${directPath}?accessLink=expired-token`);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ error: String(input) === "/api/access-links/redeem" ? "Sign in required" : "Access link has expired" }), { status: String(input) === "/api/access-links/redeem" ? 401 : 403 })));
    await renderGateway({ initialDestination: destination, initialAccessLink: "expired-token" });
    await clickButton("Continue with Google");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Access link has expired");
    expect(nativeWindow.location.pathname).toBe(directPath);
    expect(nativeWindow.location.search).toBe("?accessLink=expired-token");
    expect(reload).not.toHaveBeenCalled();
  });

  it("forwards the link read-only flag into an approved real workspace", async () => {
    nativeWindow.history.replaceState({}, "", directPath);
    await renderGateway({ initialDestination: destination, initialUser: { ...approvedUser, role: "viewer", readOnlyLink: true } });
    expect(container.querySelector('[data-mode="real"]')?.getAttribute("data-read-only-link")).toBe("true");
  });

  it("recovers revoked project context through an explicitly authorized personal project switch", async () => {
    nativeWindow.history.replaceState({}, "", `${directPath}?connection=keep`);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body || "{}")) });
      return new Response(JSON.stringify(init?.method === "PATCH" ? { ok: true } : { projects: [{ id: "other-shared", kind: "shared" }, { id: "personal-owner", kind: "personal" }] }), { status: 200 });
    }));
    await renderGateway({ initialDestination: destination, initialUser: { ...approvedUser, projectId: "sample-house", isPersonal: false, role: "viewer", status: "rejected", readOnlyLink: true } });
    expect(container.querySelector('[data-mode]')).toBeNull();
    expect(requests).toEqual([]);
    await clickButton("Open my workspace");
    expect(requests).toEqual([{ url: "/api/projects", body: {} }, { url: "/api/projects", method: "PATCH", body: { projectId: "personal-owner" } }]);
    expect(container.querySelector('[data-mode]')).toBeNull();
    expect(nativeWindow.location.pathname).toBe("/projects/personal-owner/overview");
    expect(nativeWindow.location.search).toBe("?connection=keep");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("preserves rejected project context when the recovery switch is no longer authorized", async () => {
    nativeWindow.history.replaceState({}, "", directPath);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === "PATCH" ? { error: "Project access required" } : { projects: [{ id: "personal-owner", kind: "personal" }] }), { status: init?.method === "PATCH" ? 403 : 200 })));
    await renderGateway({ initialDestination: destination, initialUser: { ...approvedUser, projectId: "sample-house", status: "rejected", readOnlyLink: true } });
    await clickButton("Open my workspace");
    expect(container.querySelector('[data-mode]')).toBeNull();
    expect(container.textContent).toContain("Project access required");
    expect(nativeWindow.location.pathname).toBe(directPath);
    expect(reload).not.toHaveBeenCalled();
  });

  it("requests the project from a canonical category path and retains the full destination after Google sign-in", async () => {
    nativeWindow.history.replaceState({}, "", `${directPath}?connection=keep#selected`);
    await renderGateway({ initialDestination: destination });
    await clickButton("Open private workspace");
    await clickButton("Continue with Google");
    expect(requests).toEqual([{ url: "/api/session", method: "POST", body: { requestedProjectId: "sample-house" } }]);
    expect(auth.getIdToken).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(nativeWindow.location.pathname).toBe(directPath);
    expect(nativeWindow.location.search).toBe("?connection=keep");
    expect(nativeWindow.location.hash).toBe("#selected");
  });

  it("passes the invitation token with the path project and preserves other query parameters", async () => {
    nativeWindow.history.replaceState({}, "", `${directPath}?invite=private-invite&google=connected`);
    await renderGateway({ initialDestination: destination, initialInvite: "private-invite" });
    await clickButton("Continue with Google");
    expect(requests[0].body).toEqual({ requestedProjectId: "sample-house", inviteToken: "private-invite" });
    expect(nativeWindow.location.pathname).toBe(directPath);
    expect(new URLSearchParams(nativeWindow.location.search).get("google")).toBe("connected");
    expect(new URLSearchParams(nativeWindow.location.search).get("invite")).toBe("private-invite");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps a legacy root destination through demo exploration and returning to credentials", async () => {
    nativeWindow.history.replaceState({}, "", "/?project=sample-house&section=distribution&connection=keep");
    await renderGateway();
    await clickButton("Explore the demo");
    expect(new URLSearchParams(nativeWindow.location.search).get("project")).toBe("sample-house");
    expect(new URLSearchParams(nativeWindow.location.search).get("section")).toBe("distribution");
    expect(new URLSearchParams(nativeWindow.location.search).get("mode")).toBe("demo");
    await clickButton("Switch workspace mode");
    expect(new URLSearchParams(nativeWindow.location.search).has("mode")).toBe(false);
    await clickButton("Continue with Google");
    expect(requests[0].body).toEqual({ requestedProjectId: "sample-house" });
    expect(nativeWindow.location.pathname).toBe("/");
    expect(new URLSearchParams(nativeWindow.location.search).get("connection")).toBe("keep");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("uses the browser's current project path rather than a stale server destination", async () => {
    nativeWindow.history.replaceState({}, "", "/projects/second-project/documents");
    await renderGateway({ initialDestination: destination, initialInvite: "invite" });
    await clickButton("Continue with Google");
    expect(requests[0].body.requestedProjectId).toBe("second-project");
    expect(nativeWindow.location.pathname).toBe("/projects/second-project/documents");
  });

  it("falls back to the server destination when the root URL no longer identifies a project", async () => {
    await renderGateway({ initialDestination: destination, initialInvite: "invite" });
    await clickButton("Continue with Google");
    expect(requests[0].body.requestedProjectId).toBe("sample-house");
  });

  it("keeps destination and credentials visible when the session request fails", async () => {
    nativeWindow.history.replaceState({}, "", directPath);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Project access required" }), { status: 403 })));
    await renderGateway({ initialDestination: destination });
    await clickButton("Open private workspace");
    await clickButton("Continue with Google");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Project access required");
    expect(nativeWindow.location.pathname).toBe(directPath);
    expect(reload).not.toHaveBeenCalled();
  });

  it("starts a fresh workspace when switching between real and demo modes", async () => {
    nativeWindow.history.replaceState({}, "", directPath);
    await renderGateway({
      initialDestination: destination,
      initialUser: { name: "Owner", email: "owner@example.test", projectId: "sample-house", projectName: "Sample House", isPersonal: false, role: "admin", status: "approved", permissions: { overview: true, activity: true, budget: true, quotes: true, expenses: true, documents: true, notes: true, aesthetics: true, distribution: true, approvals: true, plan: true, decisions: true, site: true }, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } },
    });
    expect(container.querySelector("section")?.dataset.initialMode).toBe("real");
    await clickButton("Switch workspace mode");
    expect(container.querySelector("section")?.dataset.initialMode).toBe("demo");
    await clickButton("Switch workspace mode");
    expect(container.querySelector("section")?.dataset.initialMode).toBe("real");
    expect(JSON.parse(container.querySelector("section")!.dataset.destination!)).toEqual(destination);
    expect(nativeWindow.location.pathname).toBe(directPath);
    expect(new URLSearchParams(nativeWindow.location.search).has("mode")).toBe(false);
  });
});


describe("demo language entry", () => {
  it.each(["en", "es"] as const)("keeps a new language choice after an explicit %s landing URL", async (initialLanguage) => {
    const selected = initialLanguage === "en" ? "es" : "en";
    nativeWindow.history.replaceState({}, "", `/?lang=${initialLanguage}`);
    await renderGateway({ initialLanguage });
    await clickButton(selected.toUpperCase());
    await clickButton(selected === "es" ? "Explorar la demo" : "Explore the demo");
    expect(container.querySelector("section")?.dataset.language).toBe(selected);
    expect(new URLSearchParams(nativeWindow.location.search).get("lang")).toBe(selected);
  });

  it("defaults a fresh demo visit to English even with a Spanish browser locale", async () => {
    nativeWindow.localStorage.clear();
    vi.spyOn(navigator, "language", "get").mockReturnValue("es-CR");
    await renderGateway({ initialMode: "demo" });
    expect(container.querySelector("section")?.dataset.language).toBe("en");
    expect(requests).toEqual([]);
    vi.restoreAllMocks();
  });

  it("opens the demo from a browser-localized landing page in English without an explicit preference", async () => {
    nativeWindow.localStorage.clear();
    vi.spyOn(navigator, "language", "get").mockReturnValue("es-CR");
    await renderGateway();
    await clickButton("Explorar la demo");
    expect(container.querySelector("section")?.dataset.language).toBe("en");
    expect(new URLSearchParams(nativeWindow.location.search).get("lang")).toBe("en");
    vi.restoreAllMocks();
  });

  it("passes an explicit Spanish preference to demo before reading a conflicting saved English preference", async () => {
    nativeWindow.history.replaceState({}, "", "/?mode=demo&lang=es");
    await renderGateway({ initialMode: "demo", initialLanguage: "es" });
    const workspace = container.querySelector("section")!;
    expect(workspace.dataset.language).toBe("es");
    expect(workspace.dataset.userName).toBe("Visitante Demo");
    expect(workspace.dataset.projectName).toBe("Casa Mirador");
    expect(requests).toEqual([]);
  });

  it("passes the saved preference to demo when there is no explicit language", async () => {
    nativeWindow.localStorage.setItem("house-planner-language", "es");
    await renderGateway({ initialMode: "demo" });
    expect(container.querySelector("section")?.dataset.language).toBe("es");
    // The initial fallback must not override the child's saved preference before hydration.
    expect(container.querySelector("section")?.dataset.firstLanguage).toBeUndefined();
    expect(requests).toEqual([]);
  });

  it("keeps the same demo instance when its entry language changes", async () => {
    await renderGateway({ initialMode: "demo", initialLanguage: "es" });
    await renderGateway({ initialMode: "demo", initialLanguage: "en" });
    const workspace = container.querySelector("section")!;
    expect(workspace.dataset.language).toBe("en");
    expect(workspace.dataset.firstLanguage).toBe("es");
    expect(workspace.dataset.userName).toBe("Demo visitor");
    expect(workspace.dataset.projectName).toBe("Mirador House");
    expect(requests).toEqual([]);
  });

  it("preserves private user and project names under an English entry preference", async () => {
    await renderGateway({ initialUser: { ...approvedUser, name: "Usuario propio", projectName: "Casa propia" }, initialLanguage: "en" });
    const workspace = container.querySelector("section")!;
    expect(workspace.dataset.userName).toBe("Usuario propio");
    expect(workspace.dataset.projectName).toBe("Casa propia");
  });
});
