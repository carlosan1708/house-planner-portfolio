"use client";

import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile, type User as FirebaseUser } from "firebase/auth";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import HousePlanner from "./HousePlanner";
import SiteFooter from "./SiteFooter";
import { flushUsageBeforeTransition, useUsageTracking } from "@/lib/usage-client";
import { buildWorkspacePath, parseWorkspaceRoute, readWorkspaceDestination, type WorkspaceDestination, type WorkspaceSection } from "@/lib/workspace-navigation";

type MemberPermissions = { overview: boolean; activity: boolean; budget: boolean; quotes: boolean; expenses: boolean; documents: boolean; notes: boolean; aesthetics: boolean; distribution: boolean; approvals: boolean; plan: boolean; decisions: boolean; site: boolean };
type FolderAccess = { mode: "all" | "selected"; folderIds: string[]; allowUnfiled: boolean };
type User = { name: string; email: string; projectId: string; projectName: string; projectCurrency?: "CRC" | "USD"; isPersonal: boolean; role: "admin" | "editor" | "viewer"; status: "pending" | "approved" | "rejected"; permissions: MemberPermissions; folderAccess: FolderAccess; readOnlyLink?: boolean; anonymousLink?: boolean; linkDefaultLanguage?: Language; canViewPlatformAnalytics?: boolean };
type Language = "es" | "en";
type AuthMode = "login" | "signup";
type View = "landing" | "credentials" | "demo" | "project";

const t = (language: Language, en: string, es: string) => language === "es" ? es : en;

function authErrorMessage(reason: unknown, language: Language) {
  const code = typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "";
  if (code === "auth/email-already-in-use") return t(language, "That email already has an account. Sign in instead.", "Ese correo ya tiene una cuenta. Inicia sesión.");
  if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") return t(language, "The email or password is incorrect.", "El correo o la contraseña son incorrectos.");
  if (code === "auth/weak-password") return t(language, "Use a password with at least 8 characters.", "Usa una contraseña de al menos 8 caracteres.");
  if (code === "auth/invalid-email") return t(language, "Enter a valid email address.", "Ingresa un correo válido.");
  if (code === "auth/operation-not-allowed") return t(language, "Email and password access is not enabled yet.", "El acceso con correo y contraseña aún no está habilitado.");
  if (code === "auth/too-many-requests") return t(language, "Too many attempts. Wait a moment and try again.", "Demasiados intentos. Espera un momento e inténtalo de nuevo.");
  return t(language, "Sign-in failed. Please try again.", "No se pudo iniciar sesión. Inténtalo de nuevo.");
}

function finishAccessLink(destinationFromServer: WorkspaceDestination | null, projectId?: string, defaultLanguage?: Language, defaultSection: WorkspaceSection = "overview") {
  const params = new URLSearchParams(window.location.search);
  params.delete("accessLink");
  params.delete("mode");
  if (defaultLanguage && params.get("lang") !== "es" && params.get("lang") !== "en") params.set("lang", defaultLanguage);
  const destination = readWorkspaceDestination(window.location.href) || destinationFromServer || (projectId ? parseWorkspaceRoute(projectId, [params.get("section") || defaultSection]) : null);
  if (destination) {
    params.delete("project");
    params.delete("section");
  }
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${destination ? buildWorkspacePath(destination) : window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  window.location.reload();
}

export default function AuthGateway({ initialUser, initialMode, initialInvite, initialDestination = null, initialAccessLink = "", initialLanguage }: { initialUser: User | null; initialMode: "demo" | "default"; initialInvite: string; initialDestination?: WorkspaceDestination | null; initialAccessLink?: string; initialLanguage?: Language }) {
  const [view, setView] = useState<View>(initialUser?.status === "approved" ? "project" : initialAccessLink ? "credentials" : initialMode === "demo" ? "demo" : "landing");
  const previousView = useRef(view);
  const [language, setLanguage] = useState<Language>(initialLanguage || initialUser?.linkDefaultLanguage || "en");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const previousAuthMode = useRef(authMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [accessLinkError, setAccessLinkError] = useState("");
  const [redemptionAttempt, setRedemptionAttempt] = useState(0);
  const [accessLinkRequiresAccount, setAccessLinkRequiresAccount] = useState(false);
  const redemptionRequest = useRef<Promise<{ projectId?: string; defaultLanguage?: Language; defaultSection?: WorkspaceSection; requiresAccount?: boolean }> | null>(null);

  useEffect(() => {
    if ((previousView.current !== view && (view === "credentials" || view === "landing")) || (view === "credentials" && previousAuthMode.current !== authMode)) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    previousView.current = view;
    previousAuthMode.current = authMode;
  }, [view, authMode]);

  useUsageTracking(view !== "demo" && (view !== "project" || initialUser?.status !== "approved") ? {
    context: "access", section: "access",
    viewKey: initialUser && initialUser.status !== "approved" ? "pending" : initialInvite || initialAccessLink || view === "credentials" ? "credentials" : "landing",
    expectedEmail: initialUser?.email || null,
  } : null);

  useEffect(() => {
    if (!initialAccessLink) return;
    let active = true;
    // Reuse the request when StrictMode replays this effect. Only the active
    // effect handles its result, so a link is redeemed and reloaded once.
    if (!redemptionRequest.current) {
      const requestedProjectId = readWorkspaceDestination(window.location.href)?.projectId || initialDestination?.projectId;
      redemptionRequest.current = fetch("/api/access-links/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: initialAccessLink, requestedProjectId }) })
        .then(async (response) => {
          const data = await response.json().catch(() => null) as { error?: string; projectId?: string; defaultLanguage?: Language; defaultSection?: WorkspaceSection } | null;
          if (response.status === 401 && !initialUser) return { requiresAccount: true };
          if (!response.ok || !data?.projectId) throw new Error(data?.error || "This access link could not be accepted. It may have expired or been revoked.");
          return data;
        });
    }
    void redemptionRequest.current.then((data) => {
      if (!active) return;
      if (data.requiresAccount) setAccessLinkRequiresAccount(true);
      else finishAccessLink(initialDestination, data.projectId, data.defaultLanguage, data.defaultSection);
    }).catch((reason) => {
      if (active) setAccessLinkError(reason instanceof Error ? reason.message : "This access link could not be accepted. Please try again.");
    });
    return () => { active = false; };
  }, [initialUser, initialAccessLink, initialDestination, redemptionAttempt]);

  useEffect(() => {
    const saved = window.localStorage.getItem("house-planner-language");
    const preferred: Language = initialLanguage || initialUser?.linkDefaultLanguage || (saved === "es" || saved === "en" ? saved : initialMode === "demo" ? "en" : navigator.language.toLowerCase().startsWith("es") ? "es" : "en");
    window.setTimeout(() => {
      setLanguage(preferred);
      setHydrated(true);
    }, 0);
  }, [initialLanguage, initialUser?.linkDefaultLanguage, initialMode]);

  useEffect(() => {
    if (initialUser?.status !== "approved" || initialMode !== "demo") return;
    const params = new URLSearchParams(window.location.search);
    params.delete("mode");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [initialMode, initialUser?.status]);

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    window.localStorage.setItem("house-planner-language", next);
    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", next);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  };

  const openDemo = () => {
    const params = new URLSearchParams(window.location.search);
    params.set("mode", "demo");
    const saved = window.localStorage.getItem("house-planner-language");
    const requested = params.get("lang");
    const preferred: Language = requested === "es" || requested === "en" ? requested : saved === "es" || saved === "en" ? saved : initialLanguage || "en";
    params.set("lang", preferred);
    setLanguage(preferred);
    if (initialInvite) params.set("invite", initialInvite);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}${window.location.hash}`);
    setView("demo");
  };

  const openProject = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("mode");
    if (initialInvite) params.set("invite", initialInvite);
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    setError("");
    if (initialUser) setView("project");
    else setView("credentials");
  };

  const establishSession = async (user: FirebaseUser) => {
    if (initialInvite && user.emailVerified === false) {
      await sendEmailVerification(user);
      setAuthMode("login");
      throw new Error(t(language, "We sent a verification link to your email. Open it, then sign in again to accept the invitation.", "Enviamos un enlace de verificación a tu correo. Ábrelo e inicia sesión de nuevo para aceptar la invitación."));
    }
    await flushUsageBeforeTransition();
    const token = await user.getIdToken(true);
    const requestedProjectId = readWorkspaceDestination(window.location.href)?.projectId || initialDestination?.projectId;
    const response = await fetch("/api/session", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ inviteToken: initialInvite || undefined, accessLinkToken: initialAccessLink || undefined, requestedProjectId }) });
    const data = await response.json().catch(() => null) as { error?: string; projectId?: string; defaultLanguage?: Language; defaultSection?: WorkspaceSection } | null;
    if (!response.ok) throw new Error(data?.error || "session");
    if (initialAccessLink) finishAccessLink(initialDestination, data?.projectId, data?.defaultLanguage, data?.defaultSection);
    else window.location.reload();
  };

  const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (authMode === "signup" && name.trim().length < 2) throw new Error("name");
      if (password.length < 8) throw new Error("password");
      const credential = authMode === "signup"
        ? await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, password)
        : await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      if (authMode === "signup") await updateProfile(credential.user, { displayName: name.trim() });
      await establishSession(credential.user);
    } catch (reason) {
      if (reason instanceof Error && reason.message === "name") setError(t(language, "Enter a name with at least 2 characters.", "Ingresa un nombre de al menos 2 caracteres."));
      else if (reason instanceof Error && reason.message === "password") setError(t(language, "Use a password with at least 8 characters.", "Usa una contraseña de al menos 8 caracteres."));
      else if (reason instanceof Error && reason.message !== "session" && !reason.message.startsWith("Firebase:")) setError(reason.message);
      else setError(authErrorMessage(reason, language));
      setBusy(false);
    }
  };

  const loginWithGoogle = async () => {
    setBusy(true);
    setError("");
    try {
      const credential = await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
      await establishSession(credential.user);
    } catch (reason) {
      setError(reason instanceof Error && reason.message !== "session" && !reason.message.startsWith("Firebase:") ? reason.message : authErrorMessage(reason, language));
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    await flushUsageBeforeTransition();
    await fetch("/api/session", { method: "DELETE" });
    await signOut(firebaseAuth).catch(() => undefined);
    window.location.reload();
  };

  const recoverProject = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/projects");
      const data = await response.json().catch(() => null) as { projects?: Array<{ id: string; kind: string }>; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || t(language, "Your available workspaces could not be loaded.", "No se pudieron cargar tus espacios disponibles."));
      const project = data?.projects?.find((item) => item.kind === "personal") || data?.projects?.[0];
      if (!project) throw new Error(t(language, "You have no other authorized workspace. Contact the administrator.", "No tienes otro espacio autorizado. Contacta al administrador."));
      const switched = await fetch("/api/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id }) });
      const result = await switched.json().catch(() => null) as { error?: string } | null;
      if (!switched.ok) throw new Error(result?.error || t(language, "The workspace could not be opened.", "No se pudo abrir el espacio."));
      const params = new URLSearchParams(window.location.search);
      for (const key of ["accessLink", "project", "section", "mode"]) params.delete(key);
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${buildWorkspacePath({ projectId: project.id, section: "overview", budgetScope: null })}${query ? `?${query}` : ""}`);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(language, "The workspace could not be opened. Try again.", "No se pudo abrir el espacio. Reinténtalo."));
      setBusy(false);
    }
  };

  const authPanel = (
    <main className="auth-screen"><section className="auth-panel credentials-panel"><div className="auth-panel-top"><div className="auth-brand"><span>H</span><b>House Planner</b></div><div className="language-switch" role="group" aria-label={t(language, "Language", "Idioma")}><button className={language === "es" ? "selected" : ""} onClick={() => changeLanguage("es")}>ES</button><button className={language === "en" ? "selected" : ""} onClick={() => changeLanguage("en")}>EN</button></div></div><small>{initialAccessLink ? t(language, "READ-ONLY ACCESS LINK", "ENLACE DE ACCESO DE LECTURA") : initialInvite ? t(language, "PROJECT INVITATION", "INVITACIÓN AL PROYECTO") : t(language, "PRIVATE WORKSPACE", "ESPACIO PRIVADO")}</small><h1>{authMode === "signup" ? t(language, "Create your account.", "Crea tu cuenta.") : t(language, "Welcome back.", "Bienvenido de nuevo.")}</h1><p>{initialAccessLink ? t(language, "Sign in or create an account to open this project with read-only access. The administrator chooses which sections and folders you can see.", "Inicia sesión o crea una cuenta para abrir este proyecto con acceso de lectura. El administrador elige las secciones y carpetas que puedes ver.") : initialInvite ? t(language, "Use the invited email. You can sign in or create a password account for that address.", "Usa el correo invitado. Puedes iniciar sesión o crear una cuenta con contraseña para esa dirección.") : authMode === "signup" ? t(language, "Your account starts with a separate personal workspace. You only see shared projects after accepting an invitation.", "Tu cuenta inicia con un espacio personal separado. Solo verás proyectos compartidos después de aceptar una invitación.") : t(language, "Enter with your House Planner email and password.", "Ingresa con tu correo y contraseña de House Planner.")}</p><form className="auth-form" method="post" onSubmit={submitCredentials}>{authMode === "signup" && <label><span>{t(language, "Name", "Nombre")}</span><input name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label>}<label><span>{t(language, "Email", "Correo")}</span><input name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label><span>{t(language, "Password", "Contraseña")}</span><input name="password" type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>{authMode === "signup" && <small>{t(language, "At least 8 characters.", "Mínimo 8 caracteres.")}</small>}<button className="primary-button auth-button" disabled={busy || !hydrated} type="submit">{busy ? t(language, "Connecting…", "Conectando…") : authMode === "signup" ? t(language, "Create account", "Crear cuenta") : t(language, "Sign in", "Iniciar sesión")}</button></form>{error && <p className="auth-error" role="alert">{error}</p>}<button className="auth-mode-switch" disabled={busy} onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setError(""); }}>{authMode === "login" ? t(language, "New here? Create an account", "¿Primera vez? Crea una cuenta") : t(language, "Already have an account? Sign in", "¿Ya tienes cuenta? Inicia sesión")}</button><div className="auth-divider"><span>{t(language, "or", "o")}</span></div><button className="secondary-button auth-button google-auth-button" disabled={busy} onClick={() => void loginWithGoogle()}>{t(language, "Continue with Google", "Continuar con Google")}</button><div className="credentials-actions"><button className="secondary-button" disabled={busy} onClick={() => setView("landing")}>{t(language, "Back", "Volver")}</button><button className="secondary-button" disabled={busy} onClick={openDemo}>{t(language, "Explore demo", "Explorar demo")}</button></div></section><SiteFooter language={language} /></main>
  );

  if (initialAccessLink && !accessLinkRequiresAccount) {
    const retryRedemption = () => {
      redemptionRequest.current = null;
      setAccessLinkError("");
      setRedemptionAttempt((attempt) => attempt + 1);
    };
    return <main className="auth-screen"><section className="auth-panel pending-panel"><div className="auth-brand"><span>H</span><b>House Planner</b></div><small>{t(language, "READ-ONLY ACCESS LINK", "ENLACE DE ACCESO DE LECTURA")}</small><h1>{accessLinkError ? t(language, "This link could not be accepted.", "No se pudo aceptar este enlace.") : t(language, "Opening the shared project…", "Abriendo el proyecto compartido…")}</h1>{accessLinkError ? <><p className="auth-error" role="alert">{accessLinkError}</p><p>{t(language, "The link may have expired or been revoked.", "El enlace puede haber caducado o sido revocado.")}</p><div className="pending-actions"><button className="primary-button" disabled={busy} onClick={retryRedemption}>{t(language, "Try again", "Reintentar")}</button>{initialUser && !initialUser.anonymousLink && <button className="secondary-button" disabled={busy} onClick={() => void recoverProject()}>{t(language, "Open my current project", "Abrir mi proyecto actual")}</button>}<button className="secondary-button" disabled={busy} onClick={logout}>{t(language, "Sign out", "Cerrar sesión")}</button></div>{error && <p className="auth-error" role="alert">{error}</p>}</> : <p role="status">{t(language, "Accepting your read-only access before loading the project.", "Aceptando tu acceso de lectura antes de cargar el proyecto.")}</p>}</section><SiteFooter language={language} /></main>;
  }

  if (view === "demo") {
    return <HousePlanner key="demo" mode="demo" initialLanguage={hydrated ? language : initialLanguage} user={{ name: t(language, "Demo visitor", "Visitante Demo"), email: "demo@houseplanner.app", projectId: "demo", projectCurrency: "USD", projectName: t(language, "Mirador House", "Casa Mirador"), isPersonal: false, role: "admin", permissions: { overview: true, activity: true, budget: true, quotes: true, expenses: true, documents: true, notes: false, aesthetics: true, distribution: false, approvals: true, plan: true, decisions: true, site: true }, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true } }} usageEmail={initialUser?.email || null} onSwitchMode={openProject} onSignOut={openProject} />;
  }

  if (!initialUser && (view === "credentials" || initialInvite || initialAccessLink)) return authPanel;

  if (!initialUser && view === "landing") {
    return <main className="auth-screen"><section className="auth-panel unified-entry"><div className="auth-panel-top"><div className="auth-brand"><span>H</span><b>House Planner</b></div><div className="language-switch" role="group" aria-label={t(language, "Language", "Idioma")}><button className={language === "es" ? "selected" : ""} onClick={() => changeLanguage("es")}>ES</button><button className={language === "en" ? "selected" : ""} onClick={() => changeLanguage("en")}>EN</button></div></div><small>{t(language, "ONE SITE · TWO SAFE MODES", "UN SOLO SITIO · DOS MODOS SEGUROS")}</small><h1>{t(language, "Choose how you want to enter.", "Elige cómo quieres entrar.")}</h1><p>{t(language, "Explore a complete demonstration with fictional data, or open a private workspace for your real project information.", "Explora una demostración completa con datos ficticios o abre un espacio privado para la información real de tu proyecto.")}</p><div className="entry-grid"><button className="entry-card demo-entry" onClick={openDemo}><span>{t(language, "OPEN DEMO", "DEMO ABIERTA")}</span><b>{t(language, "Explore the demo", "Explorar la demo")}</b><small>{t(language, "No account · Fictional data · Working downloads", "Sin cuenta · Datos ficticios · Descargas funcionales")}</small><i>{t(language, "Enter the demo →", "Entrar a la demo →")}</i></button><button className="entry-card real-entry" disabled={busy} onClick={openProject}><span>{t(language, "REAL PROJECT", "PROYECTO REAL")}</span><b>{t(language, "Open private workspace", "Abrir espacio privado")}</b><small>{t(language, "Email and password · Isolated data · Optional project invitations", "Correo y contraseña · Datos aislados · Invitaciones opcionales")}</small><i>{t(language, "Sign in or create account →", "Iniciar sesión o crear cuenta →")}</i></button></div>{error && <p className="auth-error">{error}</p>}<em>{t(language, "The demo and real projects live in this same application. The demo never displays real information.", "La demo y los proyectos reales viven en esta misma aplicación. La demo nunca muestra información real.")}</em></section><SiteFooter language={language} /></main>;
  }

  if (initialUser && initialUser.status !== "approved") {
    const rejected = initialUser.status === "rejected";
    return <main className="auth-screen"><section className="auth-panel pending-panel"><div className="auth-panel-top"><div className="auth-brand"><span>H</span><b>House Planner</b></div><div className="language-switch" role="group" aria-label={t(language, "Language", "Idioma")}><button className={language === "es" ? "selected" : ""} onClick={() => changeLanguage("es")}>ES</button><button className={language === "en" ? "selected" : ""} onClick={() => changeLanguage("en")}>EN</button></div></div><small>{rejected ? t(language, "ACCESS NOT AUTHORIZED", "ACCESO NO AUTORIZADO") : t(language, "REQUEST RECEIVED", "SOLICITUD RECIBIDA")}</small><h1>{rejected ? t(language, "Your access is not active.", "Tu acceso no está activo.") : t(language, "Your access is pending approval.", "Tu acceso está pendiente de aprobación.")}</h1><p>{initialUser.email}</p><p>{initialInvite ? t(language, "Accept the invitation using the email shown above.", "Acepta la invitación usando el correo indicado arriba.") : rejected ? t(language, "Contact the administrator if you believe this is an error.", "Contacta al administrador si consideras que esto es un error.") : t(language, "The administrator must approve your account before you can view the shared project files.", "El administrador debe aprobar tu cuenta antes de que puedas ver los archivos del proyecto compartido.")}</p><div className="pending-actions"><button className="primary-button" disabled={busy} onClick={() => void recoverProject()}>{t(language, "Open my workspace", "Abrir mi espacio")}</button><button className="secondary-button" disabled={busy} onClick={() => window.location.reload()}>{t(language, "Check status", "Comprobar estado")}</button><button className="secondary-button" onClick={openDemo}>{t(language, "Explore demo", "Explorar demo")}</button><button className="secondary-button" disabled={busy} onClick={logout}>{t(language, "Sign out", "Cerrar sesión")}</button></div>{error && <p className="auth-error">{error}</p>}</section><SiteFooter language={language} /></main>;
  }

  if (!initialUser) return null;
  return <HousePlanner key={`real:${initialUser.projectId}`} mode="real" initialDestination={initialDestination} initialLanguage={initialLanguage || initialUser.linkDefaultLanguage} user={{ name: initialUser.name, email: initialUser.email, projectId: initialUser.projectId, projectName: initialUser.projectName, projectCurrency: initialUser.projectCurrency, isPersonal: initialUser.isPersonal, role: initialUser.role, permissions: initialUser.permissions, folderAccess: initialUser.folderAccess, readOnlyLink: initialUser.readOnlyLink, anonymousLink: initialUser.anonymousLink, canViewPlatformAnalytics: initialUser.canViewPlatformAnalytics === true }} onSwitchMode={openDemo} onSignOut={logout} />;
}
