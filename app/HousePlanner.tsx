"use client";

import { demoFieldKey, localizeMainDemo, localizeMainDemoRecord, workspaceEnumLabel, type DemoFieldCatalog } from "@/lib/main-demo-localization";
import { localizePlanTemplates, planTemplateTextPair } from "@/lib/plan-template-localization";

import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import DistributionAdmin from "./components/DistributionAdmin";
import "./components/distribution.css";
import SiteFooter from "./SiteFooter";
import BudgetWorkspace from "./components/BudgetWorkspace";
import ExpensesWorkspace from "./components/ExpensesWorkspace";
import AssistantPanel from "./components/AssistantPanel";
import ActivityWorkspace, { ActivitySummaryCard } from "./components/ActivityWorkspace";
import MobileCapture from "./components/MobileCapture";
import MobileWorkspaceNavigation from "./components/MobileWorkspaceNavigation";
import ModalOverlay from "./components/ModalOverlay";
import FileShareButton from "./components/FileShareButton";
import AestheticsWorkspace from "./components/AestheticsWorkspace";
import QuotesWorkspace from "./components/QuotesWorkspace";
import NotesWorkspace from "./components/NotesWorkspace";
import DemoOverview from "./components/DemoOverview";
import OverviewHighlights from "./components/OverviewHighlights";
import FeaturedDocumentsSelection, { useFeaturedDocumentsSelection } from "./components/FeaturedDocumentsSelection";
import DocumentSearch from "./components/DocumentSearch";
import { countdownNeedsAttention, type CountdownRecord } from "@/lib/countdowns";
import CountdownList from "./components/CountdownList";
import { documentsInFolder } from "@/lib/document-navigation";
import { folderDescendantIds } from "@/lib/folder-moves";
import type { ExpenseRecord } from "@/lib/expenses";
import type { MobileCaptureAttachment } from "@/lib/mobile-capture";
import { buildWorkspacePath, readWorkspaceDestination, workspacePermissionTab, type BudgetRouteScope, type WorkspaceDestination } from "@/lib/workspace-navigation";
import CopyWorkspaceLink from "./components/CopyWorkspaceLink";
import UploadProgress from "./components/UploadProgress";
import { createUploadBatch, uploadFormData, type UploadProgressState } from "@/lib/upload-progress";
import FolderVault, { FolderEncryptionPending } from "./components/FolderVault";
import ReadAccessLinks from "./components/ReadAccessLinks";
import "./components/access.css";
import { memberAccessState, type MemberAccessState } from "@/lib/access-management";
import AnalyticsWorkspace from "./components/AnalyticsWorkspace";
import { flushUsageBeforeTransition, trackDemoAction, trackUsageInteraction, useUsageTracking } from "@/lib/usage-client";
import { projectCurrency, type ProjectCurrency } from "@/lib/currency";
import ProjectCurrencyDialog, { CurrencySelect, type CurrencyProject } from "./components/ProjectCurrencyDialog";

const DistributionWorkspace = dynamic(() => import("./components/DistributionWorkspace"), { ssr: false });

type Language = "es" | "en";
type WorkspaceMode = "demo" | "real";
type NavKey = "overview" | "activity" | "budget" | "quotes" | "expenses" | "documents" | "notes" | "aesthetics" | "distribution" | "furniture" | "approvals" | "plan" | "decisions" | "site" | "access" | "analytics";
type WorkspaceTab = Exclude<NavKey, "access" | "analytics" | "furniture">;
type MemberPermissions = Record<WorkspaceTab, boolean>;
type FolderAccess = {
  mode: "all" | "selected";
  folderIds: string[];
  allowUnfiled: boolean;
};
type PlanItem = {
  id: string;
  title: string;
  phase: string;
  owner: string;
  startDate: string | null;
  endDate: string | null;
  status: "not_started" | "in_progress" | "blocked" | "done";
  dependsOn: string[];
  notes: string;
  durationDays?: number;
  offsetDays?: number;
};
type DecisionRecord = {
  id: string;
  area: string;
  title: string;
  options: string;
  selected: string;
  dueDate: string | null;
  status: "open" | "decided" | "deferred";
  owner: string;
  captureAttachments: MobileCaptureAttachment[];
};
type SiteIssue = {
  id: string;
  title: string;
  category: "punch" | "observation" | "inspection" | "permit";
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "in_progress" | "resolved";
  assignee: string;
  dueDate: string | null;
  notes: string;
  photos: string[];
  captureAttachments: MobileCaptureAttachment[];
};
type User = {
  name: string;
  email: string;
  projectId: string;
  projectName: string;
  projectCurrency?: ProjectCurrency;
  isPersonal: boolean;
  role: "admin" | "editor" | "viewer";
  permissions: MemberPermissions;
  folderAccess: FolderAccess;
  readOnlyLink?: boolean;
  anonymousLink?: boolean;
  canViewPlatformAnalytics?: boolean;
};
type ProjectChoice = CurrencyProject & { kind: "personal" | "shared"; role: "admin" | "editor" | "viewer"; active: boolean; favorite?: boolean; openOnSignIn?: boolean };
type DocumentRecord = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  folderId: string | null;
  createdAt: string;
  downloadUrl: string;
  isImage?: boolean;
  previewKind?: "image" | "pdf" | "docx" | "audio" | null;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  aiIndexStatus?: string | null;
  description?: string;
  quoteReferenceSupported?: boolean;
  quoteReferenceEnabled?: boolean;
  encrypted?: boolean;
};
type FolderRecord = { id: string; name: string; createdAt: string; parentId: string | null; encrypted?: boolean; unlocked?: boolean; unlockedUntil?: number };
type DocumentListResponse = { documents: DocumentRecord[]; encryptionCleanupPending?: number };
type ApprovalCell = { value: string | number | boolean | null; formula: string | null; numberFormat: string | null };
type ApprovalChangeDetail = {
  sheet: string;
  row: number;
  column: number;
  rowLabel: string;
  groupLabel?: string | null;
  before: ApprovalCell | null;
  after: ApprovalCell | null;
  calculated: boolean;
};
type ApprovalRecord = {
  id: string;
  kind: string;
  title: string;
  payload: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
  change_count?: number;
  change_details?: ApprovalChangeDetail[];
  details_complete?: boolean;
};
type AccessRecord = {
  uid: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  status: "pending" | "approved" | "rejected";
  accessState?: MemberAccessState;
  accessSource?: "read_link" | "direct";
  requestedAt: string | null;
  reviewedAt: string | null;
  permissions: MemberPermissions;
  folderAccess: FolderAccess;
};
type InvitationRecord = {
  id: string;
  email: string;
  role: "editor" | "viewer";
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: string;
  createdAt: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
  permissions: MemberPermissions;
  folderAccess: FolderAccess;
};
type NotificationRecipient = { uid: string; name: string; email: string; role: "admin" | "editor" | "viewer" };
type PropertyProfile = {
  revisionLabelEn: string;
  revisionLabelEs: string;
  measurements: Array<{ id: string; labelEn: string; labelEs: string; value: string; emphasis: boolean }>;
};

const WORKBOOK_URL = "/api/workbook/file";
const DOCUMENT_DRAG_TYPE = "application/x-house-planner-document";
const FOLDER_DRAG_TYPE = "application/x-house-planner-folder";
const DEFAULT_PERMISSIONS: MemberPermissions = {
  overview: true,
  activity: true,
  budget: true,
  quotes: true,
  expenses: false,
  documents: true,
  notes: false,
  aesthetics: true,
  distribution: false,
  approvals: true,
  plan: true,
  decisions: true,
  site: true,
};
const DEFAULT_FOLDER_ACCESS: FolderAccess = {
  mode: "all",
  folderIds: [],
  allowUnfiled: true,
};
const PERMISSION_TABS: WorkspaceTab[] = [
  "overview",
  "activity",
  "budget",
  "quotes",
  "expenses",
  "documents",
  "notes",
  "aesthetics",
  "distribution",
  "approvals",
  "plan",
  "decisions",
  "site",
];
const DEMO_FOLDERS: FolderRecord[] = [
  {
    id: "demo-quotes",
    name: "Quotes",
    parentId: null,
    createdAt: "2026-07-01T12:00:00.000Z",
  },
  {
    id: "demo-plans",
    name: "Plans",
    parentId: null,
    createdAt: "2026-07-01T12:00:00.000Z",
  },
  {
    id: "demo-plans-structural",
    name: "Structural",
    parentId: "demo-plans",
    createdAt: "2026-07-01T12:00:00.000Z",
  },
];
const DEMO_DOCUMENTS: DocumentRecord[] = [
  { id: "demo-brief", name: "Casa_Mirador_Project_Brief.txt", contentType: "text/plain", size: 1260, uploadedBy: "Design Studio", folderId: null, createdAt: "2026-09-01T12:00:00.000Z", downloadUrl: "/demo/Casa_Mirador_Project_Brief.txt", description: "Fictional project brief: spaces, materials, budget and next decisions." },
  { id: "demo-floor-plan", name: "Casa_Mirador_Floor_Plan.svg", contentType: "image/svg+xml", size: 6000, uploadedBy: "Design Studio", folderId: "demo-plans", createdAt: "2026-09-02T12:00:00.000Z", downloadUrl: "/demo/casa-mirador-plan.svg", isImage: true, previewKind: "image", previewUrl: "/demo/casa-mirador-plan.svg", thumbnailUrl: "/demo/casa-mirador-plan.svg", description: "Illustrative 12 × 10 m plan. All dimensions are invented." },
  {
    id: "demo-quote",
    name: "Cotizacion_demo.txt",
    contentType: "text/plain",
    size: 302,
    uploadedBy: "Demo Team",
    folderId: "demo-quotes",
    createdAt: "2026-08-11T12:00:00.000Z",
    downloadUrl: "/demo/Cotizacion_demo.txt",
  },
];
const DEMO_EXPENSES_FOR_DOCUMENTS: ExpenseRecord[] = [
  {
    id: "demo-structure",
    paymentDate: "2026-07-03",
    vendor: "Constructora Demo",
    description: "Concrete and reinforcement",
    reference: "",
    amount: 6200,
    budgetLineId: "demo-structure",
    chapter: "Structure",
    type: "Construction",
    subcategory: "Foundation",
    paymentMethod: "",
    notes: "",
    status: "paid",
    receiptDocumentId: "demo-invoice",
    attachments: [{ id: "demo-document-link", documentId: "demo-invoice", fileName: "Factura_demo.txt", contentType: "text/plain", createdAt: "2026-07-03T12:00:00.000Z", isImage: false }],
    source: "workbook",
  },
  {
    id: "demo-finishes",
    paymentDate: "",
    vendor: "Acabados Demo",
    description: "Floors and wall finishes",
    reference: "",
    amount: 1850,
    budgetLineId: "demo-finishes",
    chapter: "Finishes",
    type: "Construction",
    subcategory: "Interior",
    paymentMethod: "",
    notes: "",
    status: "paid",
    receiptDocumentId: null,
    attachments: [],
    source: "workbook",
  },
];
const DEMO_APPROVALS: ApprovalRecord[] = [
  {
    id: "demo-approval",
    kind: "workbook_draft",
    title: "20% labor adjustment and scope review",
    payload: JSON.stringify({
      changeCount: 6,
    }),
    status: "pending",
    requested_by: "arquitecta@demo.example",
    reviewed_by: null,
    created_at: "2026-08-12T15:30:00.000Z",
    reviewed_at: null,
    change_count: 6,
    details_complete: true,
    change_details: [
      { sheet: "Presupuesto", row: 27, column: 5, rowLabel: "Roof structure and covering labor", groupLabel: "Mano de obra general", before: { value: 1000, formula: null, numberFormat: "$#,##0" }, after: { value: 1200, formula: null, numberFormat: "$#,##0" }, calculated: false },
      { sheet: "Presupuesto", row: 27, column: 6, rowLabel: "Roof structure and covering labor", groupLabel: "Mano de obra general", before: { value: 1250, formula: null, numberFormat: "$#,##0" }, after: { value: 1500, formula: null, numberFormat: "$#,##0" }, calculated: false },
      { sheet: "Presupuesto", row: 39, column: 5, rowLabel: "Plumbing and sanitary labor", groupLabel: "Mano de obra general", before: { value: 500, formula: null, numberFormat: "$#,##0" }, after: { value: 600, formula: null, numberFormat: "$#,##0" }, calculated: false },
      { sheet: "Presupuesto", row: 39, column: 6, rowLabel: "Plumbing and sanitary labor", groupLabel: "Mano de obra general", before: { value: 600, formula: null, numberFormat: "$#,##0" }, after: { value: 720, formula: null, numberFormat: "$#,##0" }, calculated: false },
      { sheet: "Presupuesto", row: 61, column: 5, rowLabel: "Primary bathroom tub", groupLabel: "Materiales", before: { value: 400, formula: null, numberFormat: "$#,##0" }, after: { value: 0, formula: null, numberFormat: "$#,##0" }, calculated: false },
      { sheet: "Resumen", row: 5, column: 2, rowLabel: "Target budget", groupLabel: null, before: { value: 48750, formula: "Presupuesto!E94", numberFormat: "$#,##0" }, after: { value: 48650, formula: "Presupuesto!E94", numberFormat: "$#,##0" }, calculated: true },
    ],
  },
];
const DEMO_PLAN: PlanItem[] = [
  {
    id: "demo-plan-foundation",
    title: "Foundation and slab",
    phase: "Structure",
    owner: "Demo Team",
    startDate: "2026-09-07",
    endDate: "2026-09-28",
    status: "in_progress",
    dependsOn: [],
    notes: "Coordinate waterproofing before pouring.",
  },
  {
    id: "demo-plan-finishes",
    title: "Interior finishes",
    phase: "Finishes",
    owner: "Design Studio",
    startDate: "2026-12-01",
    endDate: "2027-02-12",
    status: "not_started",
    dependsOn: ["demo-plan-foundation"],
    notes: "Confirm stone and paint samples in Decisions.",
  },
];
const demoCountdowns = (): CountdownRecord[] => {
  const startedAt = new Date();
  const dueAt = new Date(startedAt.getTime() + 10 * 86_400_000);
  return [{ id: "demo-countdown", title: "Confirmar acabados de cocina", durationDays: 10, startedAt: startedAt.toISOString(), dueAt: dueAt.toISOString(), acknowledged: false, createdBy: "demo@houseplanner.app", recipientUids: ["demo"], notifyCurrentUser: true }];
};
const DEMO_DECISIONS: DecisionRecord[] = [
  {
    id: "demo-decision-kitchen",
    area: "Kitchen",
    title: "Countertop material",
    options: "Quartz / Granite / Porcelain",
    selected: "",
    dueDate: "2026-10-10",
    status: "open",
    owner: "Owner",
    captureAttachments: [],
  },
  {
    id: "demo-decision-roof",
    area: "Structure",
    title: "Roof finish",
    options: "Standing seam / Tile",
    selected: "Standing seam",
    dueDate: "2026-09-18",
    status: "decided",
    owner: "Architect",
    captureAttachments: [],
  },
];
const DEMO_SITE_ISSUES: SiteIssue[] = [
  {
    id: "demo-issue-leak",
    title: "Water pooling near temporary entrance",
    category: "observation",
    priority: "medium",
    status: "open",
    assignee: "Site Supervisor",
    dueDate: "2026-08-22",
    notes: "Add temporary drainage before next heavy rain.",
    photos: [],
    captureAttachments: [],
  },
  {
    id: "demo-issue-inspection",
    title: "Foundation pre-pour inspection",
    category: "inspection",
    priority: "critical",
    status: "in_progress",
    assignee: "Structural Engineer",
    dueDate: "2026-09-05",
    notes: "Verify rebar spacing and formwork alignment.",
    photos: [],
    captureAttachments: [],
  },
];
const PLAN_TEMPLATES: Array<{ id: string; name: string; description: string; items: Omit<PlanItem, "id">[] }> = [
  {
    id: "costa-rica-construction",
    name: "Plan de construcción Costa Rica",
    description: "Plantilla por fases con permisos municipales, profesionales responsables y puntos de control del reglamento de construcción.",
    items: [
      { title: "Debida diligencia y revisión de la propiedad", phase: "Pre-construcción", owner: "Propietario / Abogado", startDate: null, endDate: null, status: "not_started", dependsOn: [], notes: "Confirmar zonificación municipal, carta de disponibilidad de agua, plano catastrado y restricciones de uso.", offsetDays: 0, durationDays: 14 },
      { title: "Diseño y profesionales responsables", phase: "Pre-construcción", owner: "Arquitecto / Ingeniero", startDate: null, endDate: null, status: "not_started", dependsOn: ["Debida diligencia y revisión de la propiedad"], notes: "Contratar profesionales inscritos en el CFIA y definir al profesional responsable del proyecto.", offsetDays: 7, durationDays: 28 },
      { title: "Permiso de construcción municipal", phase: "Permisos", owner: "Profesional responsable", startDate: null, endDate: null, status: "not_started", dependsOn: ["Diseño y profesionales responsables"], notes: "Presentar planos, formularios, estudios requeridos y tasas municipales conforme al reglamento de construcción local.", offsetDays: 35, durationDays: 45 },
      { title: "Avisos previos y seguros", phase: "Permisos", owner: "Contratista", startDate: null, endDate: null, status: "not_started", dependsOn: ["Permiso de construcción municipal"], notes: "Coordinar aprobaciones de servicios, rótulo de construcción, pólizas y medidas de seguridad ocupacional.", offsetDays: 70, durationDays: 14 },
      { title: "Cimentación y estructura", phase: "Estructura", owner: "Contratista / Ingeniero", startDate: null, endDate: null, status: "not_started", dependsOn: ["Avisos previos y seguros"], notes: "Ejecutar cimentación, estructura y las inspecciones requeridas antes de continuar.", offsetDays: 84, durationDays: 90 },
      { title: "Cerramiento, MEP y acabados", phase: "Construcción", owner: "Contratista", startDate: null, endDate: null, status: "not_started", dependsOn: ["Cimentación y estructura"], notes: "Completar cerramiento, sistemas mecánicos, eléctricos, sanitarios y acabados interiores.", offsetDays: 174, durationDays: 120 },
      { title: "Inspecciones finales y ocupación", phase: "Cierre", owner: "Profesional responsable", startDate: null, endDate: null, status: "not_started", dependsOn: ["Cerramiento, MEP y acabados"], notes: "Completar inspecciones finales, aprobaciones municipales, garantías y documentación de entrega.", offsetDays: 294, durationDays: 30 },
    ],
  },
  {
    id: "basic-home-build",
    name: "Basic home build",
    description: "A simple five-phase construction roadmap for a single-family home.",
    items: [
      { title: "Site preparation", phase: "Site", owner: "Contractor", startDate: null, endDate: null, status: "not_started", dependsOn: [], notes: "Clear, survey, and prepare the building footprint.", offsetDays: 0, durationDays: 10 },
      { title: "Foundation", phase: "Structure", owner: "Contractor", startDate: null, endDate: null, status: "not_started", dependsOn: ["Site preparation"], notes: "Form, reinforce, pour, and cure the foundation.", offsetDays: 10, durationDays: 25 },
      { title: "Frame and enclosure", phase: "Structure", owner: "Contractor", startDate: null, endDate: null, status: "not_started", dependsOn: ["Foundation"], notes: "Complete structure, roof, windows, and exterior doors.", offsetDays: 35, durationDays: 60 },
      { title: "Systems and finishes", phase: "Interior", owner: "Contractor", startDate: null, endDate: null, status: "not_started", dependsOn: ["Frame and enclosure"], notes: "Install MEP systems, drywall, paint, and finishes.", offsetDays: 95, durationDays: 80 },
      { title: "Closeout", phase: "Closeout", owner: "Owner / Contractor", startDate: null, endDate: null, status: "not_started", dependsOn: ["Systems and finishes"], notes: "Punch list, cleaning, handover, and warranty review.", offsetDays: 175, durationDays: 20 },
    ],
  },
  {
    id: "renovation",
    name: "Interior renovation",
    description: "A focused renovation plan for kitchens, bathrooms, and finish upgrades.",
    items: [
      { title: "Survey and scope", phase: "Planning", owner: "Designer", startDate: null, endDate: null, status: "not_started", dependsOn: [], notes: "Confirm existing conditions, scope, and finish decisions.", offsetDays: 0, durationDays: 7 },
      { title: "Demolition and prep", phase: "Construction", owner: "Contractor", startDate: null, endDate: null, status: "not_started", dependsOn: ["Survey and scope"], notes: "Protect unaffected areas and remove selected finishes.", offsetDays: 7, durationDays: 12 },
      { title: "Rough-in", phase: "Construction", owner: "Contractor", startDate: null, endDate: null, status: "not_started", dependsOn: ["Demolition and prep"], notes: "Adjust electrical, plumbing, and framing as required.", offsetDays: 19, durationDays: 20 },
      { title: "Finishes and fixtures", phase: "Construction", owner: "Contractor", startDate: null, endDate: null, status: "not_started", dependsOn: ["Rough-in"], notes: "Install tile, cabinetry, counters, paint, and fixtures.", offsetDays: 39, durationDays: 35 },
      { title: "Inspection and handover", phase: "Closeout", owner: "Owner / Contractor", startDate: null, endDate: null, status: "not_started", dependsOn: ["Finishes and fixtures"], notes: "Final inspection, punch list, and handover.", offsetDays: 74, durationDays: 10 },
    ],
  },
];
const t = (language: Language, en: string, es: string) =>
  language === "es" ? es : en;

const navMeta: Array<{ id: NavKey; icon: string }> = [
  { id: "overview", icon: "⌂" },
  { id: "activity", icon: "◴" },
  { id: "budget", icon: "▦" },
  { id: "quotes", icon: "⌕" },
  { id: "expenses", icon: "¤" },
  { id: "documents", icon: "▱" },
  { id: "notes", icon: "✎" },
  { id: "aesthetics", icon: "◈" },
  { id: "distribution", icon: "⬡" },
  { id: "approvals", icon: "✓" },
  { id: "plan", icon: "◷" },
  { id: "decisions", icon: "◇" },
  { id: "site", icon: "!" },
  { id: "access", icon: "◎" },
  { id: "analytics", icon: "▥" },
];

function navLabel(id: NavKey, language: Language) {
  return {
    overview: t(language, "Overview", "Resumen"),
    activity: t(language, "Activity", "Actividad"),
    budget: t(language, "Budget", "Presupuesto"),
    quotes: t(language, "Quotes", "Cotizaciones"),
    expenses: t(language, "Purchases/Expenses", "Compras/Gastos"),
    documents: t(language, "Documents", "Documentos"),
    notes: t(language, "Notes", "Notas"),
    aesthetics: t(language, "Aesthetics", "Estética"),
    distribution: t(language, "House Distribution 3D", "Distribución 3D"),
    furniture: t(language, "Furniture", "Mobiliario"),
    approvals: t(language, "Approvals", "Aprobaciones"),
    plan: t(language, "Plan & schedule", "Plan y cronograma"),
    decisions: t(language, "Decisions", "Decisiones"),
    site: t(language, "Site progress", "Progreso de obra"),
    access: t(language, "Access", "Acceso"),
    analytics: t(language, "App usage", "Uso de la app"),
  }[id];
}

function directChildFolders(folders: FolderRecord[], parentId: string | null) {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function folderPath(folders: FolderRecord[], folderId: string) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: FolderRecord[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function folderOptionLabel(folder: FolderRecord, folders: FolderRecord[]) {
  const parts = folderPath(folders, folder.id);
  return parts
    .map((part, index) => (index === 0 ? part.name : `${"– ".repeat(index)}${part.name}`))
    .join(" / ");
}

function topLevelFolders(folders: FolderRecord[]) {
  return folders.filter((folder) => folder.parentId === null);
}

function protectedFolderRoot(folders: FolderRecord[], folderId: string | null) {
  return folderId ? folderPath(folders, folderId).find((folder) => folder.encrypted) : undefined;
}
export default function HousePlanner({
  mode,
  user,
  onSwitchMode,
  onSignOut,
  initialDestination = null,
  initialLanguage,
  usageEmail = null,
}: {
  mode: WorkspaceMode;
  user: User;
  onSwitchMode: () => void;
  onSignOut: () => void;
  initialDestination?: WorkspaceDestination | null;
  initialLanguage?: Language;
  usageEmail?: string | null;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage || "en");
  const [destination, setDestination] = useState<WorkspaceDestination>(initialDestination || { projectId: user.projectId, section: "overview", budgetScope: null });
  const [active, setActiveState] = useState<NavKey>(initialDestination?.section || "overview");
  const [projectAccessError, setProjectAccessError] = useState(false);
  const [distributionReady, setDistributionReady] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [demoFeaturedDocumentIds, setDemoFeaturedDocumentIds] = useState<string[]>(["demo-quote"]);
  const [encryptionCleanupPending, setEncryptionCleanupPending] = useState(0);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [localSelectedFolder, setLocalSelectedFolder] = useState<string>("root");
  const selectedFolder = mode === "real" && destination.section === "documents" ? destination.folderId || "root" : localSelectedFolder;
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const uploadInFlight = useRef(false);
  const lastDocumentFolders = useRef<FolderRecord[]>([]);
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentRootView, setDocumentRootView] = useState<"featured" | "unfiled">("featured");
  const hasUnlockedDocumentVault = folders.some((folder) => folder.encrypted && folder.unlocked);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [demoOwnedText, setDemoOwnedText] = useState<Record<string, DemoFieldCatalog>>({});
  const [demoEditedText, setDemoEditedText] = useState<Record<string, string[]>>({});
  const demoItemFormatter = (kind: string) => <T extends object,>(record: T, draftEdits: string[] = []): T => {
    const key = `${kind}:${(record as { id?: string }).id || ""}`;
    return localizeMainDemoRecord(kind, record, language, [...(demoEditedText[key] || []), ...draftEdits], demoOwnedText[key]);
  };
  const rememberDemoTextEdits = (kind: string, id: string | undefined, editedFields: string[]) => {
    if (id && editedFields.length) setDemoEditedText(current => ({ ...current, [`${kind}:${id}`]: [...new Set([...(current[`${kind}:${id}`] || []), ...editedFields])] }));
  };
  const [countdowns, setCountdowns] = useState<CountdownRecord[]>([]);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [siteIssues, setSiteIssues] = useState<SiteIssue[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [propertyProfile, setPropertyProfile] = useState<PropertyProfile | null>(null);
  const [accessUsers, setAccessUsers] = useState<AccessRecord[]>([]);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [projects, setProjects] = useState<ProjectChoice[]>(mode === "demo" ? [{ id: "demo", name: "Casa Mirador", kind: "shared", role: "admin", active: true }] : []);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectChoice | null>(null);
  const [latestInviteLink, setLatestInviteLink] = useState("");
  const [latestInviteId, setLatestInviteId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [assistantDraftId, setAssistantDraftId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationRecipients, setNotificationRecipients] = useState<NotificationRecipient[]>([]);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [emailNotificationsConfigured, setEmailNotificationsConfigured] = useState(false);
  const [notificationSender, setNotificationSender] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [captureVersion, setCaptureVersion] = useState(0);
  const alertedCountdowns = useRef(new Set<string>());
  const navigationGuard = useRef<(() => Promise<boolean>) | null>(null);
  const navigationBusy = useRef(false);
  const destinationRef = useRef(destination);
  const historyIndex = useRef(0);
  const currentUrl = useRef("");
  const restoringHistory = useRef(false);
  const routeInitialized = useRef(false);
  const projectDataLoaded = useRef(false);
  const workbookInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const hasTabAccess = (tab: WorkspaceTab | "furniture") =>
    mode === "demo" || (user.isPersonal ? tab === "overview" : user.role === "admin" || user.permissions[workspacePermissionTab(tab)]);
  const hasActivityAccess = mode === "demo" || (!user.isPersonal && (user.role === "admin" || user.permissions.activity));
  const enabledNavItems = navMeta.filter((item) => {
    if (item.id === "analytics") return mode === "real" && user.canViewPlatformAnalytics === true;
    if (mode === "real" && user.isPersonal) return item.id === "overview";
    if (item.id === "distribution" || item.id === "furniture") return distributionReady && hasTabAccess(item.id);
    if (item.id === "activity") return hasActivityAccess;
    if (item.id === "access") return mode === "real" && user.role === "admin";
    return hasTabAccess(item.id);
  });
  const visibleActive = active;
  const navigationActive = active === "furniture" ? "distribution" : active;
  const projectMismatch = mode === "real" && destination.projectId !== user.projectId;
  const sectionAccessible = active === "analytics" ? mode === "real" && user.canViewPlatformAnalytics === true : active === "access" ? mode === "real" && user.role === "admin" && !user.isPersonal : active === "activity" ? hasActivityAccess : hasTabAccess(active);
  const workspaceAvailable = !projectMismatch && sectionAccessible;
  const showingAnalytics = workspaceAvailable && active === "analytics" && user.canViewPlatformAnalytics === true;

  useUsageTracking(!loading && !error && workspaceAvailable && active !== "analytics" ? {
    context: mode === "demo" ? "demo" : "project", section: active === "furniture" ? "distribution" : active,
    ...(mode === "real" ? { projectId: user.projectId } : {}),
    expectedEmail: mode === "real" ? user.email : usageEmail,
    viewKey: active === "furniture" ? "furniture" : destination.folderId || (destination.budgetScope ? JSON.stringify(destination.budgetScope) : ""),
  } : null);
  const documentFolderUnavailable = mode === "real" && selectedFolder !== "root" && !folders.some(folder => folder.id === selectedFolder);

  const registerNavigationGuard = useCallback((guard: (() => Promise<boolean>) | null) => { navigationGuard.current = guard; }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const previousHeight = root.style.getPropertyValue("--workspace-visible-height");
    const previousTop = root.style.getPropertyValue("--workspace-visible-top");
    const updateVisibleViewport = () => {
      // Pinch zoom should magnify the existing layout rather than reflow its overlays.
      if (viewport.scale !== 1) return;
      root.style.setProperty("--workspace-visible-height", `${viewport.height}px`);
      root.style.setProperty("--workspace-visible-top", `${viewport.offsetTop}px`);
    };
    updateVisibleViewport();
    viewport.addEventListener("resize", updateVisibleViewport);
    viewport.addEventListener("scroll", updateVisibleViewport);
    return () => {
      viewport.removeEventListener("resize", updateVisibleViewport);
      viewport.removeEventListener("scroll", updateVisibleViewport);
      if (previousHeight) root.style.setProperty("--workspace-visible-height", previousHeight);
      else root.style.removeProperty("--workspace-visible-height");
      if (previousTop) root.style.setProperty("--workspace-visible-top", previousTop);
      else root.style.removeProperty("--workspace-visible-top");
    };
  }, []);

  function routeUrl(next: WorkspaceDestination, source = window.location.href) {
    const url = new URL(source);
    for (const key of ["project", "section", "group", "label", "all", "mode"]) url.searchParams.delete(key);
    // Record references belong to their original section and must not leak into a new section.
    if (next.section !== destinationRef.current.section || next.projectId !== destinationRef.current.projectId) {
      url.searchParams.delete("item"); url.searchParams.delete("countdown");
      for (const key of ["budgetLine", "expenseTab", "newExpense", "newDocument"]) url.searchParams.delete(key);
    }
    return `${buildWorkspacePath(next)}${url.search}${url.hash}`;
  }

  function applyDestination(next: WorkspaceDestination) {
    destinationRef.current = next;
    setDestination(next);
    setActiveState(next.section);
    setProjectAccessError(false);
  }

  function writeDestination(next: WorkspaceDestination, replace = false, source?: string) {
    const url = routeUrl(next, source);
    if (!replace && url === currentUrl.current) return;
    const index = replace ? historyIndex.current : historyIndex.current + 1;
    window.history[replace ? "replaceState" : "pushState"]({ ...window.history.state, housePlannerIndex: index }, "", url);
    historyIndex.current = index;
    currentUrl.current = url;
  }

  async function navigateDestination(next: WorkspaceDestination) {
    if (navigationBusy.current) return false;
    navigationBusy.current = true;
    try {
      if (navigationGuard.current && !await navigationGuard.current()) return false;
      if (mode === "real" && next.projectId !== user.projectId) {
        await changeProject(next.projectId, next, true);
        return false;
      }
      const changedView = buildWorkspacePath(next) !== buildWorkspacePath(destinationRef.current);
      if (mode === "real") writeDestination(next);
      applyDestination(next);
      if (changedView) window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
      if (!projectDataLoaded.current) void loadProject();
      return true;
    } finally { navigationBusy.current = false; }
  }

  function setActive(section: NavKey) {
    void navigateDestination({ projectId: user.projectId, section, budgetScope: null });
  }

  function setSelectedFolder(folderId: string) {
    setLocalSelectedFolder(folderId);
    if (mode === "real" && destinationRef.current.section === "documents") {
      void navigateDestination({ projectId: user.projectId, section: "documents", budgetScope: null, folderId: folderId === "root" ? null : folderId });
    }
  }

  const selectVaultFolder = useEffectEvent((folderId: string) => setSelectedFolder(folderId));

  const changeBudgetScope = (budgetScope: BudgetRouteScope | null) => {
    const next: WorkspaceDestination = { projectId: user.projectId, section: "budget", budgetScope };
    if (mode === "real") writeDestination(next);
    applyDestination(next);
  };

  async function leaveWorkspace(action: () => void) {
    if (navigationBusy.current) return;
    navigationBusy.current = true;
    try { if (!navigationGuard.current || await navigationGuard.current()) action(); }
    finally { navigationBusy.current = false; }
  }

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  };

  async function refreshApprovals() {
    if (mode === "demo") {
      setApprovals(DEMO_APPROVALS);
      return;
    }
    const response = await fetch("/api/approvals", { cache: "no-store" });
    if (!response.ok) throw new Error("approvals");
    const data = (await response.json()) as { approvals: ApprovalRecord[] };
    setApprovals(data.approvals);
  }

  async function refreshDocuments() {
    if (mode === "demo") {
      setDocuments(DEMO_DOCUMENTS);
      setEncryptionCleanupPending(0);
      return;
    }
    const response = await fetch("/api/files", { cache: "no-store" });
    if (!response.ok) throw new Error("documents");
    const data = (await response.json()) as DocumentListResponse;
    setDocuments(data.documents);
    setEncryptionCleanupPending(Number(data.encryptionCleanupPending || 0));
  }

  async function refreshFolders() {
    if (mode === "demo") {
      setFolders(DEMO_FOLDERS);
      return;
    }
    const response = await fetch("/api/folders", { cache: "no-store" });
    if (!response.ok) throw new Error("folders");
    const data = (await response.json()) as { folders: FolderRecord[] };
    setFolders(data.folders);
  }

  async function refreshFolderVault(folderId: string, locked: boolean) {
    if (locked) {
      const descendants = folderDescendantIds(folders, folderId);
      setDocuments((current) => current.filter((doc) => !doc.folderId || !descendants.has(doc.folderId)));
      setFolders((current) => current.filter((folder) => folder.id === folderId || !descendants.has(folder.id)).map((folder) => folder.id === folderId ? { ...folder, unlocked: false, unlockedUntil: undefined } : folder));
      setSelectedFolder(folderId);
    }
    const [folderResponse, documentResponse] = await Promise.all([
      fetch("/api/folders", { cache: "no-store" }),
      fetch("/api/files", { cache: "no-store" }),
    ]);
    if (!folderResponse.ok || !documentResponse.ok) throw new Error("vault-refresh");
    const [folderData, documentData] = await Promise.all([
      folderResponse.json() as Promise<{ folders: FolderRecord[] }>,
      documentResponse.json() as Promise<DocumentListResponse>,
    ]);
    setFolders(folderData.folders);
    setDocuments(documentData.documents);
    setEncryptionCleanupPending(Number(documentData.encryptionCleanupPending || 0));
  }

  async function refreshPropertyProfile() {
    if (mode === "demo" || user.isPersonal) {
      setPropertyProfile(null);
      return;
    }
    const response = await fetch("/api/property-profile", { cache: "no-store" });
    if (!response.ok) throw new Error("property-profile");
    const data = await response.json() as { profile: PropertyProfile | null };
    setPropertyProfile(data.profile);
  }

  async function refreshProjects() {
    if (mode === "demo") return;
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) throw new Error("projects");
    const data = (await response.json()) as { projects: ProjectChoice[] };
    setProjects(data.projects);
  }

  async function changeProject(projectId: string, next: WorkspaceDestination = { projectId, section: "overview", budgetScope: null }, alreadySaved = false) {
    if (mode !== "real" || projectId === user.projectId) return;
    if (!alreadySaved && navigationGuard.current && !await navigationGuard.current()) return;
    setBusy(true);
    try {
      await flushUsageBeforeTransition();
      const response = await fetch("/api/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
      if (!response.ok) throw new Error("project");
      setProjectPickerOpen(false);
      writeDestination(next);
      window.location.reload();
    } catch {
      setBusy(false);
      if (destinationRef.current.projectId !== user.projectId) { setProjectAccessError(true); setLoading(false); }
      showToast(t(language, "The workspace could not be changed", "No se pudo cambiar el espacio"));
    }
  }

  async function createProject(name: string, currency: ProjectCurrency) {
    if (mode !== "real" || !user.isPersonal) return false;
    setBusy(true);
    try {
      await flushUsageBeforeTransition();
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, currency }) });
      if (!response.ok) throw new Error("create-project");
      const data = await response.json() as { project: { id: string } };
      writeDestination({ projectId: data.project.id, section: "overview", budgetScope: null });
      window.location.reload();
      return true;
    } catch {
      setBusy(false);
      showToast(t(language, "The project could not be created", "No se pudo crear el proyecto"));
      return false;
    }
  }

  async function updateProjectCurrency(project: CurrencyProject, currency: ProjectCurrency, confirmDenominationCorrection: boolean) {
    setBusy(true);
    try {
      const response = await fetch("/api/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "currency", projectId: project.id, currency, expectedCurrencyRevision: project.currencyRevision || 0, confirmDenominationCorrection }) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { code?: string; error?: string };
        await refreshProjects();
        showToast(result.code === "currency_confirmation_required" ? t(language, "Review and confirm the denomination correction before saving.", "Revisa y confirma la corrección de denominación antes de guardar.") : result.error || t(language, "Project settings changed or currency could not be updated. Refresh and try again.", "La configuración cambió o no se pudo actualizar la moneda. Actualiza y reintenta."));
        return false;
      }
      const result = await response.json() as { synchronization?: { googleSyncError?: string } };
      await refreshProjects();
      if (project.id === user.projectId) window.location.reload();
      showToast(result.synchronization?.googleSyncError ? t(language, "Project currency saved. Google synchronization is pending; review Google Sheets.", "Moneda del proyecto guardada. La sincronización con Google está pendiente; revisa Google Sheets.") : t(language, "Project currency updated", "Moneda del proyecto actualizada"));
      return true;
    } catch {
      showToast(t(language, "Project currency could not be updated", "No se pudo actualizar la moneda del proyecto"));
      return false;
    } finally { setBusy(false); }
  }

  async function toggleFavoriteProject(projectId: string) {
    if (mode !== "real") return;
    setBusy(true);
    try {
      const response = await fetch("/api/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "favorite", projectId }) });
      if (!response.ok) throw new Error("favorite");
      await refreshProjects();
      showToast(t(language, "Favorite updated", "Favorito actualizado"));
    } catch {
      showToast(t(language, "The favorite could not be updated", "No se pudo actualizar el favorito"));
    } finally { setBusy(false); }
  }

  async function setOpenFavoriteOnSignIn(enabled: boolean) {
    if (mode !== "real") return;
    setBusy(true);
    try {
      const response = await fetch("/api/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open_favorite", enabled }) });
      if (!response.ok) throw new Error("default-project");
      await refreshProjects();
      showToast(enabled ? t(language, "Favorite will open when you sign in", "El favorito se abrirá al ingresar") : t(language, "My space will open when you sign in", "Mi espacio se abrirá al ingresar"));
    } catch {
      showToast(t(language, "The sign-in preference could not be updated", "No se pudo actualizar la preferencia de ingreso"));
    } finally { setBusy(false); }
  }

  async function refreshPlan() {
    if (mode === "demo") {
      setPlanItems(DEMO_PLAN);
      return;
    }
    const response = await fetch("/api/plan", { cache: "no-store" });
    if (!response.ok) throw new Error("plan");
    const data = (await response.json()) as { items: PlanItem[] };
    setPlanItems(data.items);
  }

  async function refreshCountdowns() {
    if (mode === "demo") {
      setCountdowns(demoCountdowns());
      return;
    }
    const response = await fetch("/api/countdowns", { cache: "no-store" });
    if (!response.ok) throw new Error("countdowns");
    const data = (await response.json()) as { countdowns: CountdownRecord[] };
    setCountdowns(data.countdowns);
  }

  async function refreshNotificationSettings() {
    if (mode === "demo" || user.isPersonal) {
      setNotificationRecipients(mode === "demo" ? [{ uid: "demo", name: "Visitante Demo", email: "demo@houseplanner.app", role: "admin" }] : []);
      setEmailNotificationsConfigured(false);
      return;
    }
    const response = await fetch("/api/notifications", { cache: "no-store" });
    if (!response.ok) throw new Error("notifications");
    const data = await response.json() as { configured: boolean; sender: string; emailEnabled: boolean; recipients: NotificationRecipient[] };
    setNotificationRecipients(data.recipients);
    setEmailNotificationsEnabled(data.emailEnabled);
    setEmailNotificationsConfigured(data.configured);
    setNotificationSender(data.sender);
  }

  async function refreshDecisions() {
    if (mode === "demo") {
      setDecisions(DEMO_DECISIONS);
      return;
    }
    const response = await fetch("/api/decisions", { cache: "no-store" });
    if (!response.ok) throw new Error("decisions");
    const data = (await response.json()) as { decisions: DecisionRecord[] };
    setDecisions(data.decisions);
  }

  async function refreshSiteIssues() {
    if (mode === "demo") {
      setSiteIssues(DEMO_SITE_ISSUES);
      return;
    }
    const response = await fetch("/api/site-issues", { cache: "no-store" });
    if (!response.ok) throw new Error("site-issues");
    const data = (await response.json()) as { issues: SiteIssue[] };
    setSiteIssues(data.issues);
  }

  async function refreshAccess() {
    if (mode === "demo" || user.role !== "admin") return;
    const response = await fetch("/api/access", { cache: "no-store" });
    if (!response.ok) throw new Error("access");
    const data = (await response.json()) as { users: AccessRecord[] };
    setAccessUsers(data.users);
  }

  async function refreshInvitations() {
    if (mode === "demo" || user.role !== "admin") return;
    const response = await fetch("/api/invitations", { cache: "no-store" });
    if (!response.ok) throw new Error("invitations");
    const data = (await response.json()) as { invitations: InvitationRecord[] };
    setInvitations(data.invitations);
  }

  async function loadProject() {
    if (mode === "real" && destinationRef.current.projectId !== user.projectId) return;
    projectDataLoaded.current = true;
    setLoading(true);
    setError("");
    try {
      setDocumentSearch("");
      setLocalSelectedFolder("root");
      setDocuments([]);
      setEncryptionCleanupPending(0);
      setFolders([]);
      setPlanItems([]);
      setCountdowns([]);
      setDecisions([]);
      setSiteIssues([]);
      setApprovals([]);
      setPropertyProfile(null);
      setDistributionReady(false);
      if (mode === "demo") {
        setDocuments(DEMO_DOCUMENTS);
        setFolders(DEMO_FOLDERS);
        setDistributionReady(true);
        setPlanItems(DEMO_PLAN);
        setCountdowns(demoCountdowns());
        setDecisions(DEMO_DECISIONS);
        setSiteIssues(DEMO_SITE_ISSUES);
        setApprovals(DEMO_APPROVALS);
        setAccessUsers([]);
        setInvitations([]);
        setLatestInviteLink("");
        setLatestInviteId("");
        setProjects([{ id: "demo", name: "Casa Mirador", kind: "shared", role: "admin", active: true }]);
        setNotificationRecipients([{ uid: "demo", name: "Visitante Demo", email: "demo@houseplanner.app", role: "admin" }]);
        setEmailNotificationsConfigured(false);
        return;
      }
      const tasks: Promise<unknown>[] = [refreshProjects()];
      if (hasTabAccess("overview")) tasks.push(refreshPropertyProfile());
      else setPropertyProfile(null);
      if (hasTabAccess("distribution")) tasks.push(fetch("/api/house-distribution?status=1", { cache: "no-store" }).then(async (response) => { if (response.ok) setDistributionReady(Boolean((await response.json()).ready)); }).catch(() => setDistributionReady(false)));
      if (hasTabAccess("documents")) {
        tasks.push(refreshDocuments(), refreshFolders());
      }
      if (hasTabAccess("plan")) {
        tasks.push(refreshPlan(), refreshCountdowns());
        if (!user.anonymousLink) tasks.push(refreshNotificationSettings());
      }
      if (hasTabAccess("decisions")) tasks.push(refreshDecisions());
      if (hasTabAccess("site")) tasks.push(refreshSiteIssues());
      if (hasTabAccess("approvals")) tasks.push(refreshApprovals());
      if (user.role === "admin" && !user.isPersonal) {
        tasks.push(refreshAccess(), refreshInvitations());
      }
      const results = await Promise.allSettled(tasks);
      if (results.some((result) => result.status === "rejected"))
        throw new Error("project");
    } catch {
      setError(
        t(
          language,
          "The project data could not be loaded. Please refresh the page.",
          "No se pudieron cargar los datos del proyecto. Actualiza la página.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("house-planner-language");
    const preferred: Language = initialLanguage || (
      saved === "es" || saved === "en"
        ? saved
        : mode !== "demo" && navigator.language.toLowerCase().startsWith("es")
          ? "es"
          : "en");
    window.setTimeout(() => {
      setLanguage(preferred);
      if (mode === "real" && !user.anonymousLink && destinationRef.current.projectId === user.projectId && !user.isPersonal && hasTabAccess("plan")) {
        void fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: preferred }) });
      }
    }, 0);
    if (mode === "demo" || destinationRef.current.projectId === user.projectId) window.setTimeout(() => void loadProject(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "real") return;
    if (!routeInitialized.current) {
      routeInitialized.current = true;
      const entryUrl = new URL(window.location.href);
      let next = readWorkspaceDestination(entryUrl, user.projectId) || destinationRef.current;
      if (entryUrl.pathname === "/" && !entryUrl.searchParams.has("section") && next.projectId === user.projectId && !enabledNavItems.some(item => item.id === next.section)) {
        next = { ...next, section: enabledNavItems[0]?.id || "overview", budgetScope: null };
      }
      historyIndex.current = Number(window.history.state?.housePlannerIndex || 0);
      writeDestination(next, true);
      window.setTimeout(() => {
        applyDestination(next);
        if (next.projectId !== user.projectId) void changeProject(next.projectId, next, true);
      }, 0);
    }
    const onPopState = (event: PopStateEvent) => {
      // Keep this shell mounted while its spreadsheet commits any pending cell edit.
      event.stopImmediatePropagation();
      if (restoringHistory.current) { restoringHistory.current = false; return; }
      const targetUrl = window.location.href;
      const next = readWorkspaceDestination(targetUrl, user.projectId);
      const targetIndex = typeof event.state?.housePlannerIndex === "number" ? event.state.housePlannerIndex : null;
      const restore = () => {
        if (targetIndex !== null && targetIndex !== historyIndex.current) {
          restoringHistory.current = true;
          window.history.go(historyIndex.current - targetIndex);
        } else window.history.replaceState({ ...window.history.state, housePlannerIndex: historyIndex.current }, "", currentUrl.current);
      };
      if (navigationBusy.current) { restore(); return; }
      navigationBusy.current = true;
      void (async () => {
        try {
          if (navigationGuard.current && !await navigationGuard.current()) { restore(); return; }
          if (!next) { window.location.replace(targetUrl); return; }
          historyIndex.current = targetIndex ?? historyIndex.current;
          currentUrl.current = routeUrl(next, targetUrl);
          window.history.replaceState({ ...event.state, housePlannerIndex: historyIndex.current }, "", currentUrl.current);
          applyDestination(next);
          if (next.projectId !== user.projectId) await changeProject(next.projectId, next, true);
          else if (!projectDataLoaded.current) void loadProject();
        } finally { navigationBusy.current = false; }
      })();
    };
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, user.projectId]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      mode !== "real" || projectMismatch ||
      user.isPersonal ||
      (user.role !== "admin" && !user.permissions.documents)
    )
      return;
    let stopped = false;
    let checking = false;
    let initialized = false;
    let knownVersion = 0;
    const checkDocuments = async () => {
      if (stopped || checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch("/api/events/documents", { cache: "no-store" });
        if (!response.ok) return;
        const event = await response.json() as { version?: number; updatedBy?: string };
        const nextVersion = Number(event.version || 0);
        if (!initialized) {
          initialized = true;
          knownVersion = nextVersion;
          return;
        }
        if (nextVersion === knownVersion && !hasUnlockedDocumentVault) return;
        knownVersion = nextVersion;
        const [documentsResponse, foldersResponse] = await Promise.all([
          fetch("/api/files", { cache: "no-store" }),
          fetch("/api/folders", { cache: "no-store" }),
        ]);
        if (documentsResponse.ok) {
          const data = (await documentsResponse.json()) as DocumentListResponse;
          setDocuments(data.documents);
          setEncryptionCleanupPending(Number(data.encryptionCleanupPending || 0));
        }
        if (foldersResponse.ok) {
          const data = (await foldersResponse.json()) as { folders: FolderRecord[] };
          setFolders(data.folders);
        }
        if (event.updatedBy && event.updatedBy !== user.email) {
          setToast(
            t(
              language,
              "Documents updated by another project member",
              "Otro miembro del proyecto actualizó los documentos",
            ),
          );
          window.setTimeout(() => setToast(""), 3000);
        }
      } catch {
        // A later visibility change or polling interval will retry.
      } finally {
        checking = false;
      }
    };
    const handleVisibility = () => { if (document.visibilityState === "visible") void checkDocuments(); };
    void checkDocuments();
    const timer = window.setInterval(() => void checkDocuments(), 45_000);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [hasUnlockedDocumentVault, language, mode, projectMismatch, user.email, user.isPersonal, user.permissions.documents, user.role]);

  useEffect(() => {
    if (!loading && selectedFolder !== "root" && !folders.some((folder) => folder.id === selectedFolder)) {
      const previousVault = protectedFolderRoot(lastDocumentFolders.current, selectedFolder);
      if (previousVault && folders.some((folder) => folder.id === previousVault.id)) selectVaultFolder(previousVault.id);
    }
    lastDocumentFolders.current = folders;
  }, [folders, loading, selectedFolder]);

  useEffect(() => {
    const expiring = folders.filter((folder) => folder.encrypted && folder.unlocked && folder.unlockedUntil);
    if (!expiring.length) return;
    const nextExpiry = Math.min(...expiring.map((folder) => folder.unlockedUntil!));
    const timer = window.setTimeout(() => {
      const expired = expiring.filter((folder) => folder.unlockedUntil! <= Date.now());
      if (!expired.length) return;
      const expiredDescendants = new Set(expired.flatMap((folder) => [...folderDescendantIds(folders, folder.id)]));
      setDocuments((current) => current.filter((doc) => !doc.folderId || !expiredDescendants.has(doc.folderId)));
      setFolders((current) => current.filter((folder) => folder.encrypted || !expiredDescendants.has(folder.id)).map((folder) => expired.some((root) => root.id === folder.id) ? { ...folder, unlocked: false, unlockedUntil: undefined } : folder));
      const selectedRoot = protectedFolderRoot(folders, selectedFolder);
      if (selectedRoot && expired.some((folder) => folder.id === selectedRoot.id)) selectVaultFolder(selectedRoot.id);
    }, Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [folders, selectedFolder]);

  const dueCountdowns = useMemo(() => countdowns.filter((item) => countdownNeedsAttention(item, clock)), [clock, countdowns]);
  useEffect(() => {
    const fresh = dueCountdowns.filter((item) => !alertedCountdowns.current.has(item.id));
    if (!fresh.length) return;
    fresh.forEach((item) => alertedCountdowns.current.add(item.id));
    setToast(t(language, `${fresh.length} countdown reminder${fresh.length === 1 ? "" : "s"} reached zero`, `${fresh.length} recordatorio${fresh.length === 1 ? "" : "s"} llegó${fresh.length === 1 ? "" : "n"} a cero`));
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [dueCountdowns, language]);

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    window.localStorage.setItem("house-planner-language", next);
    const url = new URL(window.location.href);
    if (user.anonymousLink || url.searchParams.has("lang")) {
      url.searchParams.set("lang", next);
      currentUrl.current = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(window.history.state, "", currentUrl.current);
    }
    if (mode === "real" && !user.anonymousLink && !projectMismatch && !user.isPersonal && hasTabAccess("plan")) {
      void fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: next }) });
    }
  };

  const filteredDocuments = useMemo(
    () =>
      documentsInFolder((mode === "demo" ? localizeMainDemo("documents", documents, language) : documents).filter((doc) => !doc.encrypted || protectedFolderRoot(folders, doc.folderId)?.unlocked === true), selectedFolder),
    [documents, folders, selectedFolder, mode, language],
  );
  const pendingApprovals = approvals.filter(
    (item) => item.status === "pending",
  );
  const importWorkbook = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || uploadInFlight.current) return;
    uploadInFlight.current = true;
    setBusy(true);
    try {
      if (mode === "real") {
        const batch = createUploadBatch([file], setUploadProgress);
        const form = new FormData();
        form.append("file", file);
        const response = await uploadFormData(WORKBOOK_URL, form, { onProgress: batch.track(0) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudo cargar el archivo");
        batch.complete(0);
        window.dispatchEvent(new Event("houseplanner-budget-updated"));
        if (result.googleSyncError) { showToast(result.googleSyncError); return; }
      }
      setActive("budget");
      showToast(
        mode === "demo"
          ? t(
              language,
              "The demo workbook is fixed for this visit",
              "El archivo demo es fijo durante esta visita",
            )
          : t(
              language,
              "Consolidated budget updated",
              "Presupuesto consolidado actualizado",
            ),
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(language, "That Excel file could not be opened", "No se pudo abrir ese archivo de Excel"));
    } finally {
      uploadInFlight.current = false;
      setUploadProgress(null);
      setBusy(false);
      event.target.value = "";
    }
  };

  const uploadDocumentFiles = async (
    files: File[],
    targetFolderId: string | null,
  ) => {
    if (!files.length || uploadInFlight.current) return;
    uploadInFlight.current = true;
    setBusy(true);
    let completedFiles = 0;
    try {
      if (mode === "demo") {
        const added = files.map((file, index) => {
          const localUrl = URL.createObjectURL(file);
          const isImage = file.type.startsWith("image/");
          const isPdf =
            file.type === "application/pdf" ||
            file.name.toLowerCase().endsWith(".pdf");
          return {
            id: `local-${Date.now()}-${index}`,
            name: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            uploadedBy: "Demo Visitor",
            folderId: targetFolderId,
            createdAt: new Date().toISOString(),
            downloadUrl: localUrl,
            isImage,
            previewKind: isImage ? "image" as const : isPdf ? "pdf" as const : null,
            thumbnailUrl: isImage ? localUrl : null,
            previewUrl: isImage || isPdf ? localUrl : null,
            quoteReferenceSupported: isImage || isPdf || file.name.toLowerCase().endsWith(".docx"),
            quoteReferenceEnabled: false,
          };
        });
        setDocuments((current) => [...added, ...current]);
        files.forEach(() => trackDemoAction("file.upload"));
        setSelectedFolder(targetFolderId ?? "root");
        showToast(
          t(
            language,
            `${files.length} demo file(s) added`,
            `${files.length} archivo(s) agregados a la demo`,
          ),
        );
        return;
      }
      const batch = createUploadBatch(files, setUploadProgress);
      for (const [index, file] of files.entries()) {
        const form = new FormData();
        form.append("file", file);
        if (targetFolderId) form.append("folderId", targetFolderId);
        const response = await uploadFormData("/api/files", form, { onProgress: batch.track(index) });
        if (!response.ok) throw new Error("upload");
        completedFiles += 1;
        batch.complete(index);
      }
      await refreshDocuments();
      setSelectedFolder(targetFolderId ?? "root");
      showToast(
        t(
          language,
          `${files.length} file(s) uploaded`,
          `${files.length} archivo(s) subido(s)`,
        ),
      );
    } catch {
      if (completedFiles > 0) {
        await refreshDocuments().catch(() => undefined);
        setSelectedFolder(targetFolderId ?? "root");
      }
      showToast(
        t(
          language,
          completedFiles === files.length ? "Files uploaded, but the document list could not be refreshed. Reload the page." : completedFiles > 0 ? `${completedFiles} of ${files.length} files uploaded. The remaining files could not be uploaded.` : "One or more files could not be uploaded",
          completedFiles === files.length ? "Archivos subidos, pero no se pudo actualizar la lista. Actualiza la página." : completedFiles > 0 ? `${completedFiles} de ${files.length} archivos subidos. No se pudieron subir los archivos restantes.` : "No se pudo subir uno o más archivos",
        ),
      );
    } finally {
      uploadInFlight.current = false;
      setUploadProgress(null);
      setBusy(false);
    }
  };

  const uploadDocuments = async (event: ChangeEvent<HTMLInputElement>) => {
    await uploadDocumentFiles(
      Array.from(event.target.files ?? []),
      selectedFolder === "root" ? null : selectedFolder,
    );
    event.target.value = "";
  };

  const createFolder = async (name: string, parentId: string | null = null, password?: string) => {
    const cleaned = name.trim();
    if (!cleaned || user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        const folder = {
          id: `demo-folder-${crypto.randomUUID()}`,
          name: cleaned,
          parentId,
          createdAt: new Date().toISOString(),
        };
        setFolders((current) =>
          [...current, folder].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setSelectedFolder(folder.id);
        trackDemoAction("record.create");
        showToast(
          t(language, "Demo folder created", "Carpeta ficticia creada"),
        );
        return true;
      }
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleaned, parentId, ...(password ? { password } : {}) }),
      });
      if (!response.ok) throw new Error("folder");
      const data = (await response.json()) as { folder: FolderRecord };
      await refreshFolders();
      setSelectedFolder(data.folder.id);
      showToast(t(language, "Folder created", "Carpeta creada"));
      return true;
    } catch {
      showToast(
        t(
          language,
          "The folder could not be created",
          "No se pudo crear la carpeta",
        ),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const moveDocument = async (id: string, folderId: string | null) => {
    if (user.role === "viewer") return;
    setBusy(true);
    try {
      if (mode === "demo") {
        setDocuments((current) =>
          current.map((doc) => (doc.id === id ? { ...doc, folderId } : doc)),
        );
      } else {
        const response = await fetch("/api/files", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, folderId }),
        });
        if (response.status === 409) {
          const result = await response.json().catch(() => ({})) as { error?: string };
          if (result.error?.startsWith("Linked mobile captures cannot be moved into encrypted folders")) {
            showToast(t(language, "This capture remains shared in Decisions or Site progress. Upload a separate copy directly into the protected folder.", "Esta captura sigue compartida en Decisiones o Progreso de obra. Sube una copia separada directamente a la carpeta protegida."));
            return;
          }
        }
        if (response.status === 503) {
          const result = await response.json().catch(() => ({})) as { error?: string };
          if (result.error?.startsWith("Encryption cleanup is pending")) {
            setDocuments((current) => current.filter((doc) => doc.id !== id));
            setEncryptionCleanupPending((current) => Math.max(1, current));
            await refreshDocuments().catch(() => undefined);
            showToast(t(language, "The file is finishing encryption. Refresh to retry; it stays unavailable until cleanup finishes.", "El archivo está terminando de encriptarse. Actualiza para reintentar; no estará disponible hasta que termine la limpieza."));
            return;
          }
        }
        if (!response.ok) throw new Error("move");
        await refreshDocuments();
      }
      trackDemoAction("record.update");
      showToast(t(language, "File moved", "Archivo movido"));
    } catch {
      showToast(
        t(
          language,
          "The file could not be moved",
          "No se pudo mover el archivo",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async (id: string) => {
    if (
      user.role === "viewer" ||
      documents.some((doc) => doc.folderId === id) ||
      folders.some((folder) => folder.parentId === id)
    )
      return false;
    setBusy(true);
    try {
      if (mode === "demo")
        setFolders((current) => current.filter((folder) => folder.id !== id));
      else {
        const response = await fetch(
          `/api/folders?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error("delete-folder");
        await refreshFolders();
      }
      setSelectedFolder("root");
      trackDemoAction("record.delete");
      showToast(t(language, "Empty folder deleted", "Carpeta vacía eliminada"));
      return true;
    } catch {
      showToast(
        t(
          language,
          "Only empty folders can be deleted",
          "Solo se pueden eliminar carpetas vacías",
        ),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const moveFolder = async (id: string, parentId: string | null) => {
    if (user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        setFolders((current) =>
          current.map((folder) =>
            folder.id === id ? { ...folder, parentId } : folder,
          ),
        );
      } else {
        const response = await fetch("/api/folders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, parentId }),
        });
        if (!response.ok) throw new Error("move-folder");
        await refreshFolders();
      }
      setSelectedFolder(id);
      trackDemoAction("record.update");
      showToast(t(language, "Folder moved", "Carpeta movida"));
      return true;
    } catch {
      showToast(
        t(
          language,
          "The folder could not be moved",
          "No se pudo mover la carpeta",
        ),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const savePlanItem = async (item: Omit<PlanItem, "id"> & { id?: string }, editedFields: string[] = []) => {
    if (user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        rememberDemoTextEdits("plan", item.id, editedFields);
        setPlanItems((current) =>
          item.id
            ? current.map((existing) => existing.id === item.id ? { ...existing, ...item } : existing)
            : [{ ...item, id: `demo-plan-${Date.now()}` } as PlanItem, ...current],
        );
      } else {
        const response = await fetch("/api/plan", {
          method: item.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        if (!response.ok) throw new Error("save-plan");
        await refreshPlan();
      }
      trackDemoAction("record.update");
      showToast(t(language, "Plan item saved", "Elemento del plan guardado"));
      return true;
    } catch {
      showToast(t(language, "The plan item could not be saved", "No se pudo guardar el elemento del plan"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const applyPlanTemplate = async (items: Omit<PlanItem, "id">[], startDate: string | null = null) => {
    if (user.role === "viewer" || !items.length) return false;
    setBusy(true);
    try {
      const normalized = items.map((item) => {
        if (!startDate || item.offsetDays === undefined || item.durationDays === undefined) return item;
        const addDays = (date: string, days: number) => {
          const value = new Date(`${date}T00:00:00`);
          value.setDate(value.getDate() + days);
          return value.toISOString().slice(0, 10);
        };
        const start = addDays(startDate, item.offsetDays);
        return { ...item, startDate: start, endDate: addDays(start, Math.max(0, item.durationDays - 1)) };
      });
      if (mode === "demo") {
        const stamp = Date.now();
        const stamped = normalized.map((item, index) => ({ ...item, id: `demo-plan-template-${stamp}-${index}` } as PlanItem));
        const owned: Record<string, DemoFieldCatalog> = {};
        for (const item of stamped) {
          const fields: DemoFieldCatalog = {};
          for (const field of ["title", "phase", "owner", "notes"] as const) {
            const pair = planTemplateTextPair(item[field]);
            if (pair) fields[field] = pair;
          }
          item.dependsOn.forEach((dependency, index) => {
            const pair = planTemplateTextPair(dependency);
            if (pair) fields[`dependsOn.${index}`] = pair;
          });
          owned[`plan:${item.id}`] = fields;
        }
        setDemoOwnedText(current => ({ ...current, ...owned }));
        setPlanItems((current) => [...stamped, ...current]);
      } else {
        const response = await fetch("/api/plan/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: normalized }),
        });
        if (!response.ok) throw new Error("apply-plan-template");
        await refreshPlan();
      }
      trackDemoAction("record.create");
      showToast(t(language, "Plan template applied", "Plantilla de plan aplicada"));
      return true;
    } catch {
      showToast(t(language, "The plan template could not be applied", "No se pudo aplicar la plantilla del plan"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deletePlanItem = async (id: string) => {
    if (user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        setPlanItems((current) => current.filter((item) => item.id !== id));
      } else {
        const response = await fetch(`/api/plan?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("delete-plan");
        await refreshPlan();
      }
      trackDemoAction("record.delete");
      showToast(t(language, "Plan item deleted", "Elemento del plan eliminado"));
      return true;
    } catch {
      showToast(t(language, "The plan item could not be deleted", "No se pudo eliminar el elemento del plan"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateDocumentDescription = async (id: string, description: string) => {
    if (user.role === "viewer") return false;
    const cleaned = description.trim().slice(0, 400);
    setBusy(true);
    try {
      if (mode === "demo") {
        setDocuments((current) => current.map((doc) => doc.id === id ? { ...doc, description: cleaned } : doc));
      } else {
        const response = await fetch("/api/files", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, description: cleaned }),
        });
        if (!response.ok) throw new Error("description");
        await refreshDocuments();
      }
      trackDemoAction("record.update");
      showToast(t(language, "Document description saved", "Descripción del documento guardada"));
      return true;
    } catch {
      showToast(t(language, "The description could not be saved", "No se pudo guardar la descripción"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateDocumentQuoteReference = async (id: string, enabled: boolean) => {
    if (user.role === "viewer") return;
    const previous = documents.find((doc) => doc.id === id)?.quoteReferenceEnabled === true;
    setDocuments((current) => current.map((doc) => doc.id === id ? { ...doc, quoteReferenceEnabled: enabled } : doc));
    setBusy(true);
    try {
      if (mode !== "demo") {
        const response = await fetch("/api/files", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, quoteReferenceEnabled: enabled }),
        });
        if (!response.ok) throw new Error("quote-reference");
        await refreshDocuments();
      }
      showToast(enabled
        ? t(language, "Document available in Quotes", "Documento disponible en Cotizaciones")
        : t(language, "Document removed from Quotes", "Documento quitado de Cotizaciones"));
    } catch {
      setDocuments((current) => current.map((doc) => doc.id === id ? { ...doc, quoteReferenceEnabled: previous } : doc));
      showToast(t(language, "The quote reference setting could not be saved", "No se pudo guardar la selección para cotizaciones"));
    } finally {
      setBusy(false);
    }
  };

  const createCountdown = async (title: string, durationDays: number, recipientUids: string[]) => {
    if (user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        const startedAt = new Date(); const dueAt = new Date(startedAt.getTime() + durationDays * 86_400_000);
        setCountdowns((current) => [{ id: `demo-countdown-${Date.now()}`, title, durationDays, startedAt: startedAt.toISOString(), dueAt: dueAt.toISOString(), acknowledged: false, createdBy: user.email, recipientUids, notifyCurrentUser: recipientUids.includes("demo") }, ...current]);
      } else {
        const response = await fetch("/api/countdowns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, durationDays, recipientUids }) });
        if (!response.ok) throw new Error("create-countdown");
        await refreshCountdowns();
      }
      setClock(Date.now());
      trackDemoAction("record.create");
      showToast(t(language, "Countdown started", "Cuenta regresiva iniciada"));
      return true;
    } catch {
      showToast(t(language, "The countdown could not be created", "No se pudo crear la cuenta regresiva"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateCountdownRecipients = async (id: string, recipientUids: string[]) => {
    if (user.role === "viewer" || !recipientUids.length) return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        setCountdowns((current) => current.map((item) => item.id === id ? { ...item, recipientUids, notifyCurrentUser: recipientUids.includes("demo") } : item));
      } else {
        const response = await fetch("/api/countdowns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "recipients", recipientUids }) });
        if (!response.ok) throw new Error("countdown-recipients");
        await refreshCountdowns();
      }
      trackDemoAction("record.update");
      showToast(t(language, "Reminder recipients updated", "Destinatarios del recordatorio actualizados"));
      return true;
    } catch {
      showToast(t(language, "Recipients could not be updated", "No se pudieron actualizar los destinatarios"));
      return false;
    } finally { setBusy(false); }
  };

  const updateEmailNotificationPreference = async (enabled: boolean) => {
    if (mode !== "real" || user.isPersonal) return;
    const previous = emailNotificationsEnabled;
    setEmailNotificationsEnabled(enabled);
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emailEnabled: enabled, language }) });
      if (!response.ok) throw new Error("notification-preference");
      showToast(enabled ? t(language, "Email reminders enabled", "Recordatorios por correo activados") : t(language, "Email reminders disabled", "Recordatorios por correo desactivados"));
    } catch {
      setEmailNotificationsEnabled(previous);
      showToast(t(language, "The email preference could not be updated", "No se pudo actualizar la preferencia de correo"));
    }
  };

  const acknowledgeCountdown = async (id: string) => {
    try {
      if (mode === "demo") setCountdowns((current) => current.map((item) => item.id === id ? { ...item, acknowledged: true } : item));
      else {
        const response = await fetch("/api/countdowns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "acknowledge" }) });
        if (!response.ok) throw new Error("acknowledge-countdown");
        await refreshCountdowns();
      }
      trackDemoAction("record.update");
      showToast(t(language, "Reminder marked as seen", "Recordatorio marcado como visto"));
      return true;
    } catch {
      showToast(t(language, "The reminder could not be updated", "No se pudo actualizar el recordatorio"));
      return false;
    }
  };

  const completeCountdown = async (id: string) => {
    if (user.role === "viewer" || user.readOnlyLink) return false;
    setBusy(true);
    try {
      if (mode === "demo") setCountdowns((current) => current.map((item) => item.id === id ? { ...item, completed: true, completedAt: new Date().toISOString() } : item));
      else {
        const response = await fetch("/api/countdowns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "complete" }) });
        if (!response.ok) throw new Error("complete-countdown");
        await refreshCountdowns();
      }
      showToast(t(language, "Task saved in Completed. Reminders stopped.", "Tarea guardada en Completadas. Recordatorios detenidos."));
      return true;
    } catch {
      showToast(t(language, "The task could not be completed", "No se pudo completar la tarea"));
      return false;
    } finally { setBusy(false); }
  };

  const deleteCountdown = async (id: string) => {
    if (user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") setCountdowns((current) => current.filter((item) => item.id !== id));
      else {
        const response = await fetch(`/api/countdowns?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("delete-countdown");
        await refreshCountdowns();
      }
      trackDemoAction("record.delete");
      showToast(t(language, "Countdown deleted", "Cuenta regresiva eliminada"));
      return true;
    } catch {
      showToast(t(language, "The countdown could not be deleted", "No se pudo eliminar la cuenta regresiva"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDecision = async (item: Omit<DecisionRecord, "id"> & { id?: string }, editedFields: string[] = []) => {
    if (user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        rememberDemoTextEdits("decisions", item.id, editedFields);
        setDecisions((current) =>
          item.id
            ? current.map((existing) => existing.id === item.id ? { ...existing, ...item } : existing)
            : [{ ...item, id: `demo-decision-${Date.now()}` } as DecisionRecord, ...current],
        );
      } else {
        const response = await fetch("/api/decisions", {
          method: item.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        if (!response.ok) throw new Error("save-decision");
        await refreshDecisions();
      }
      trackDemoAction("record.update");
      showToast(t(language, "Decision saved", "Decisión guardada"));
      return true;
    } catch {
      showToast(t(language, "The decision could not be saved", "No se pudo guardar la decisión"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteDecision = async (id: string) => {
    if (user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        setDecisions((current) => current.filter((item) => item.id !== id));
      } else {
        const response = await fetch(`/api/decisions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("delete-decision");
        await refreshDecisions();
      }
      trackDemoAction("record.delete");
      showToast(t(language, "Decision deleted", "Decisión eliminada"));
      return true;
    } catch {
      showToast(t(language, "The decision could not be deleted", "No se pudo eliminar la decisión"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveSiteIssue = async (item: Omit<SiteIssue, "id"> & { id?: string }, editedFields: string[] = []) => {
    if (user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        rememberDemoTextEdits("site", item.id, editedFields);
        setSiteIssues((current) =>
          item.id
            ? current.map((existing) => existing.id === item.id ? { ...existing, ...item } : existing)
            : [{ ...item, id: `demo-site-${Date.now()}` } as SiteIssue, ...current],
        );
      } else {
        const response = await fetch("/api/site-issues", {
          method: item.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        if (!response.ok) throw new Error("save-site-issue");
        await refreshSiteIssues();
      }
      trackDemoAction("record.update");
      showToast(t(language, "Progress entry saved", "Avance guardado"));
      return true;
    } catch {
      showToast(t(language, "The progress entry could not be saved", "No se pudo guardar el avance"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteSiteIssue = async (id: string) => {
    if (user.role === "viewer") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        setSiteIssues((current) => current.filter((item) => item.id !== id));
      } else {
        const response = await fetch(`/api/site-issues?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("delete-site-issue");
        await refreshSiteIssues();
      }
      trackDemoAction("record.delete");
      showToast(t(language, "Progress entry deleted", "Avance eliminado"));
      return true;
    } catch {
      showToast(t(language, "The progress entry could not be deleted", "No se pudo eliminar el avance"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteDocument = async (id: string) => {
    if (user.role !== "admin") return false;
    setBusy(true);
    try {
      if (mode === "demo") {
        setDocuments((current) => current.filter((doc) => doc.id !== id));
      } else {
        const response = await fetch(
          `/api/files?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error("delete-document");
        await refreshDocuments();
      }
      showToast(
        t(
          language,
          "File removed safely; its stored copy is retained for recovery",
          "Archivo eliminado de forma segura; se conserva una copia para recuperación",
        ),
      );
      return true;
    } catch {
      showToast(
        t(language, "The file could not be deleted", "No se pudo eliminar el archivo"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const resolveApproval = async (
    id: string,
    action: "approved" | "rejected",
  ) => {
    setBusy(true);
    try {
      if (mode === "demo") {
        setApprovals((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: action,
                  reviewed_by: "Visitante Demo",
                  reviewed_at: new Date().toISOString(),
                }
              : item,
          ),
        );
        showToast(
          action === "approved"
            ? t(language, "Demo change approved", "Cambio ficticio aprobado")
            : t(language, "Demo change rejected", "Cambio ficticio rechazado"),
        );
        trackDemoAction(action === "approved" ? "approval.approve" : "approval.reject");
        return;
      }
      const response = await fetch("/api/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!response.ok) throw new Error("approval");
      await loadProject();
      showToast(
        action === "approved"
          ? t(language, "Change approved", "Cambio aprobado")
          : t(language, "Change rejected", "Cambio rechazado"),
      );
    } catch {
      showToast(
        t(
          language,
          "The approval could not be updated",
          "No se pudo actualizar la aprobación",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const resolveAccess = async (
    uid: string,
    action: "approve" | "reject" | "revoke",
    role: "editor" | "viewer" = "editor",
  ) => {
    setBusy(true);
    try {
      const response = await fetch("/api/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, action, role }),
      });
      if (!response.ok) throw new Error("access");
      const data = (await response.json()) as { user: AccessRecord };
      setAccessUsers((current) => current.map((member) => member.uid === uid ? data.user : member));
      if (action === "revoke" || action === "reject") {
        const email = accessUsers.find((member) => member.uid === uid)?.email.trim().toLowerCase();
        setInvitations((current) => current.map((invitation) => invitation.status === "pending" && invitation.email.trim().toLowerCase() === email ? { ...invitation, status: "revoked" } : invitation));
        setLatestInviteLink("");
        setLatestInviteId("");
      }
      await Promise.allSettled([refreshAccess(), refreshInvitations()]);
      showToast(t(language, "Access updated", "Acceso actualizado"));
    } catch {
      showToast(
        t(
          language,
          "Access could not be updated",
          "No se pudo actualizar el acceso",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const updateMemberPermissions = async (
    uid: string,
    permissions: MemberPermissions,
  ) => {
    const previousMember = accessUsers.find((member) => member.uid === uid);
    setBusy(true);
    setAccessUsers((current) =>
      current.map((member) =>
        member.uid === uid ? { ...member, permissions } : member,
      ),
    );
    try {
      const response = await fetch("/api/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, action: "permissions", permissions }),
      });
      if (!response.ok) throw new Error("permissions");
      const data = (await response.json()) as { user: AccessRecord };
      setAccessUsers((current) =>
        current.map((member) =>
          member.uid === uid ? data.user : member,
        ),
      );
      showToast(
        t(language, "Section permissions saved", "Permisos de secciones guardados"),
      );
    } catch {
      if (previousMember) setAccessUsers((current) => current.map((member) => member.uid === uid ? { ...member, permissions: previousMember.permissions } : member));
      await refreshAccess().catch(() => undefined);
      showToast(
        t(language, "Permissions could not be saved", "No se pudieron guardar los permisos"),
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteMember = async (uid: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid }),
      });
      if (!response.ok) throw new Error("delete-member");
      const removedEmail = accessUsers.find((member) => member.uid === uid)?.email.toLowerCase();
      setAccessUsers((current) => current.filter((member) => member.uid !== uid));
      setInvitations((current) => current.filter((invitation) => invitation.email.toLowerCase() !== removedEmail));
      setLatestInviteLink("");
      setLatestInviteId("");
      // Deletion is complete even if a later read fails. Refresh preserved
      // records so their deactivated-user attribution appears immediately.
      await Promise.allSettled([
        refreshAccess(), refreshInvitations(), refreshDocuments(), refreshFolders(),
        refreshApprovals(), refreshPlan(), refreshCountdowns(),
        refreshNotificationSettings(), refreshDecisions(), refreshSiteIssues(),
      ]);
      showToast(t(language, "User removed from project", "Usuario eliminado del proyecto"));
      return true;
    } catch {
      showToast(t(language, "The user could not be removed", "No se pudo eliminar el usuario"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateMemberFolderAccess = async (
    uid: string,
    folderAccess: FolderAccess,
  ) => {
    const previousMember = accessUsers.find((member) => member.uid === uid);
    setBusy(true);
    setAccessUsers((current) => current.map((member) => member.uid === uid ? { ...member, folderAccess } : member));
    try {
      const response = await fetch("/api/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, action: "folders", folderAccess }),
      });
      if (!response.ok) throw new Error("folder-access");
      const data = (await response.json()) as { user: AccessRecord };
      setAccessUsers((current) =>
        current.map((member) =>
          member.uid === uid ? data.user : member,
        ),
      );
      showToast(
        t(language, "Folder access saved", "Acceso a carpetas guardado"),
      );
    } catch {
      if (previousMember) setAccessUsers((current) => current.map((member) => member.uid === uid ? { ...member, folderAccess: previousMember.folderAccess } : member));
      await refreshAccess().catch(() => undefined);
      showToast(
        t(language, "Folder access could not be saved", "No se pudo guardar el acceso a carpetas"),
      );
    } finally {
      setBusy(false);
    }
  };

  const createInvitation = async (
    email: string,
    role: "editor" | "viewer",
    permissions: MemberPermissions,
    folderAccess: FolderAccess,
  ) => {
    setBusy(true);
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, permissions, folderAccess }),
      });
      const data = (await response.json().catch(() => null)) as {
        inviteUrl?: string;
        invitation?: InvitationRecord;
        error?: string;
      } | null;
      if (!response.ok || !data?.inviteUrl)
        throw new Error(data?.error || "invite");
      setLatestInviteLink(data.inviteUrl);
      setLatestInviteId(data.invitation?.id || "");
      if (data.invitation) {
        const invitation = data.invitation;
        setInvitations((current) => [invitation, ...current.filter((item) => item.id !== invitation.id).map((item) => item.status === "pending" && item.email.trim().toLowerCase() === email.trim().toLowerCase() ? { ...item, status: "revoked" as const } : item)]);
      }
      await Promise.allSettled([refreshInvitations(), refreshAccess()]);
      showToast(
        t(language, "Invitation link created", "Enlace de invitación creado"),
      );
      return true;
    } catch (reason) {
      const message =
        reason instanceof Error && reason.message !== "invite"
          ? reason.message
          : t(
              language,
              "The invitation could not be created",
              "No se pudo crear la invitación",
            );
      showToast(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const revokeInvitation = async (id: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/invitations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "revoke" }),
      });
      if (!response.ok) throw new Error("revoke-invite");
      setInvitations((current) => current.map((invitation) => invitation.id === id ? { ...invitation, status: "revoked" } : invitation));
      if (!latestInviteId || latestInviteId === id) {
        setLatestInviteLink("");
        setLatestInviteId("");
      }
      await Promise.allSettled([refreshInvitations()]);
      showToast(t(language, "Invitation revoked", "Invitación revocada"));
    } catch {
      showToast(
        t(
          language,
          "The invitation could not be revoked",
          "No se pudo revocar la invitación",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const favoriteProject = projects.find((project) => project.favorite);
  const openFavoriteOnSignIn = projects.some((project) => project.openOnSignIn);
  const demoDocuments = mode === "demo" ? localizeMainDemo("documents", documents, language) : documents;
  const demoFolders = mode === "demo" ? localizeMainDemo("folders", folders, language) : folders;
  const demoApprovals = mode === "demo" ? localizeMainDemo("approvals", approvals, language) : approvals;
  const demoPlanItems = mode === "demo" ? planItems.map(item => demoItemFormatter("plan")(item)) : planItems;
  const demoCountdownItems = mode === "demo" ? localizeMainDemo("countdowns", countdowns, language) : countdowns;
  const demoDecisions = mode === "demo" ? decisions.map(item => demoItemFormatter("decisions")(item)) : decisions;
  const demoSiteIssues = mode === "demo" ? siteIssues.map(item => demoItemFormatter("site")(item)) : siteIssues;
  const demoProjects = mode === "demo" ? projects.map(project => project.id === "demo" ? { ...project, name: t(language, "Mirador House", "Casa Mirador") } : project) : projects;
  const demoRecipients = mode === "demo" ? notificationRecipients.map(recipient => recipient.uid === "demo" ? { ...recipient, name: t(language, "Demo Visitor", "Visitante Demo") } : recipient) : notificationRecipients;
  const displayUserName = mode === "demo" ? t(language, "Demo Visitor", "Visitante Demo") : user.name;
  const activeWorkspaceName = mode === "demo"
    ? t(language, "Mirador House", "Casa Mirador")
    : user.isPersonal
      ? t(language, "My space", "Mi espacio")
      : user.projectName;
  const captureDestinations = {
    expense: user.role === "admin" && hasTabAccess("expenses"),
    site_issue: user.role !== "viewer" && hasTabAccess("site"),
    decision: user.role !== "viewer" && hasTabAccess("decisions"),
  };
  const canCapture = mode === "real" && !user.isPersonal && user.role !== "viewer" && (
    captureDestinations.expense || (hasTabAccess("documents") && (captureDestinations.site_issue || captureDestinations.decision))
  );
  const mobileCaptureCompleted = async (target: "expense" | "site_issue" | "decision") => {
    const refreshes: Promise<unknown>[] = [refreshDocuments()];
    if (target === "site_issue") refreshes.push(refreshSiteIssues());
    if (target === "decision") refreshes.push(refreshDecisions());
    await Promise.all(refreshes);
    setCaptureVersion((version) => version + 1);
    setActive(target === "expense" ? "expenses" : target === "site_issue" ? "site" : "decisions");
    showToast(t(language, "Field capture linked", "Captura de obra vinculada"));
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">H</span>
          <span>House Planner</span>
        </div>
        <button className={`project-switcher ${mode === "demo" ? "static demo-project" : ""}`} disabled={busy || user.anonymousLink} onClick={() => { if (mode === "real" && !user.anonymousLink) setProjectPickerOpen(true); }} aria-label={t(language, "Choose project", "Elegir proyecto")}>
          <span className="project-dot" />
          <span>
            <small>
              {mode === "demo"
                ? t(language, "INTERACTIVE DEMO", "DEMO INTERACTIVA")
                : user.isPersonal
                  ? t(language, "PERSONAL SPACE", "ESPACIO PERSONAL")
                  : t(language, "SHARED PROJECT", "PROYECTO COMPARTIDO")}
            </small>
            {activeWorkspaceName}
          </span>
          {mode === "real" && !user.anonymousLink && <span className="project-switcher-chevron">⌄</span>}
        </button>
        <nav
          aria-label={t(language, "Project sections", "Secciones del proyecto")}
        >
          {enabledNavItems.map((item) => (
              <button
                key={item.id}
                className={navigationActive === item.id ? "nav-item active" : "nav-item"}
                aria-current={navigationActive === item.id ? "page" : undefined}
                title={navLabel(item.id, language)}
                onClick={() => setActive(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                {user.isPersonal && item.id === "overview"
                  ? t(language, "Projects", "Proyectos")
                  : navLabel(item.id, language)}
                {item.id === "approvals" && pendingApprovals.length > 0 && (
                  <em>{pendingApprovals.length}</em>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile static">
            <span className="avatar">
              {displayUserName
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span>
              <b>{displayUserName}</b>
              <small>
                {mode === "demo"
                  ? t(language, "Demo mode", "Modo demo")
                  : user.role === "admin"
                    ? t(language, "Administrator", "Administrador")
                    : user.role === "viewer"
                      ? t(language, "Viewer", "Lector")
                      : t(language, "Editor", "Editor")}
              </small>
            </span>
          </div>
        </div>
      </aside>
      <MobileWorkspaceNavigation
        items={enabledNavItems.map((item) => ({
          ...item,
          label: user.isPersonal && item.id === "overview" ? t(language, "Projects", "Proyectos") : navLabel(item.id, language),
          badge: item.id === "approvals" ? pendingApprovals.length : undefined,
        }))}
        active={navigationActive}
        language={language}
        projectName={activeWorkspaceName}
        onNavigate={setActive}
        actions={<>
          {mode === "real" && !user.anonymousLink && projects.length > 0 && <button type="button" className="mobile-menu-project" disabled={busy} aria-label={t(language, "Choose project", "Elegir proyecto")} onClick={() => setProjectPickerOpen(true)}><span>{activeWorkspaceName}</span><span aria-hidden="true">⌄</span></button>}
          <div className="language-switch" role="group" aria-label={t(language, "Language", "Idioma")}>
            <button type="button" className={language === "es" ? "selected" : ""} onClick={() => changeLanguage("es")}>ES</button>
            <button type="button" className={language === "en" ? "selected" : ""} onClick={() => changeLanguage("en")}>EN</button>
          </div>
          <button type="button" onClick={() => void leaveWorkspace(onSwitchMode)}>{mode === "demo" ? t(language, "Real project", "Proyecto real") : t(language, "View demo", "Ver demo")}</button>
          {mode === "real" && <button type="button" disabled={busy} onClick={() => void leaveWorkspace(onSignOut)}>{t(language, "Sign out", "Cerrar sesión")}</button>}
        </>}
      />
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <span className="mobile-project-context" title={activeWorkspaceName}>{activeWorkspaceName}</span>
            <div className="eyebrow">
              {mode === "demo"
                ? t(
                    language,
                    "MIRADOR HOUSE · FICTIONAL DATA",
                    "CASA MIRADOR · DATOS FICTICIOS",
                  )
                : user.isPersonal
                  ? t(language, "MY SPACE · PROJECT PORTAL", "MI ESPACIO · PORTAL DE PROYECTOS")
                  : `${activeWorkspaceName.toUpperCase()} · ${t(language, "REAL DATA", "DATOS REALES")}`}{" "}
              <span>•</span> COSTA RICA
            </div>
            <h1 aria-live="polite" aria-atomic="true">{user.isPersonal && visibleActive === "overview" ? t(language, "Projects", "Proyectos") : navLabel(navigationActive, language)}</h1>
          </div>
          <div className="top-actions">
            {mode === "real" && !projectMismatch && sectionAccessible && <CopyWorkspaceLink language={language} destination={active === "documents" || active === "aesthetics" ? destination : { projectId: user.projectId, section: active, budgetScope: null }} />}
            {mode === "real" && !user.anonymousLink && projects.length > 0 && (
              <button className="mobile-project-select" aria-label={t(language, "Choose project", "Elegir proyecto")} disabled={busy} onClick={() => setProjectPickerOpen(true)}>{activeWorkspaceName} ⌄</button>
            )}
            {!user.anonymousLink && !projectMismatch && hasTabAccess("plan") && (
              <div className="notification-center">
                <button className="notification-button" aria-label={t(language, "Notifications", "Notificaciones")} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
                  🔔
                  {dueCountdowns.length > 0 && <em>{dueCountdowns.length}</em>}
                </button>
                {notificationsOpen && (
                  <div className="notification-popover">
                    <header><div><span className="overline">{t(language, "REMINDERS", "RECORDATORIOS")}</span><b>{t(language, "Notifications", "Notificaciones")}</b></div><button aria-label={t(language, "Close notifications", "Cerrar notificaciones")} onClick={() => setNotificationsOpen(false)}>×</button></header>
                    {dueCountdowns.length ? dueCountdowns.map((item) => (
                      <article key={item.id}>
                        <span>10</span>
                        <div><b>{item.title}</b><small>{t(language, "Countdown reached zero", "La cuenta regresiva llegó a cero")} · {new Date(item.dueAt).toLocaleDateString(language === "es" ? "es-CR" : "en-US")}</small></div>
                        {!user.readOnlyLink && <button aria-label={t(language, `Mark ${item.title} as seen`, `Marcar ${item.title} como visto`)} onClick={() => void acknowledgeCountdown(item.id)}>✓</button>}
                      </article>
                    )) : <p>{t(language, "You have no new reminders.", "No tienes recordatorios nuevos.")}</p>}
                    <button className="notification-plan-link" onClick={() => { setActive("plan"); setNotificationsOpen(false); }}>{t(language, "Open plan and countdowns", "Abrir plan y cuentas regresivas")} →</button>
                  </div>
                )}
              </div>
            )}
            <button
              className={`mode-switch-button ${mode}`}
              onClick={() => void leaveWorkspace(onSwitchMode)}
            >
              {mode === "demo"
                ? `🔒 ${t(language, "Real project", "Proyecto real")}`
                : `◉ ${t(language, "View demo", "Ver demo")}`}
            </button>
            {mode === "real" && (
              <button
                type="button"
                className="secondary-button sign-out-button"
                disabled={busy}
                aria-label={t(language, "Sign out", "Cerrar sesión")}
                title={t(language, "Sign out", "Cerrar sesión")}
                onClick={() => void leaveWorkspace(onSignOut)}
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H5v14h4M16 7l5 5-5 5M9 12h12" /></svg>
                <span>{t(language, "Sign out", "Cerrar sesión")}</span>
              </button>
            )}
            <div
              className="language-switch"
              role="group"
              aria-label={t(language, "Language", "Idioma")}
            >
              <button
                className={language === "es" ? "selected" : ""}
                onClick={() => changeLanguage("es")}
              >
                ES
              </button>
              <button
                className={language === "en" ? "selected" : ""}
                onClick={() => changeLanguage("en")}
              >
                EN
              </button>
            </div>
            {pendingApprovals.length > 0 && (
              <button
                className="primary-button"
                onClick={() => setActive("approvals")}
              >
                {t(language, "Review", "Revisar")}{" "}
                <span>{pendingApprovals.length}</span>
              </button>
            )}
          </div>
        </header>
        <div className="content">
          <UploadProgress progress={uploadProgress} language={language} />
          {mode === "demo" && (
            <div className="demo-banner">
              <b>
                {t(
                  language,
                  "Demo with fictional data",
                  "Demo con datos ficticios",
                )}
              </b>
              <span>
                {t(
                  language,
                  "Explore, edit and download freely. The Gemini Pro assistant is available only in private workspaces and is not enabled in this demo.",
                  "Explora, edita y descarga libremente. El asistente con Gemini Pro está disponible solo en espacios privados y no está habilitado en esta demo.",
                )}
              </span>
            </div>
          )}
          {loading && !showingAnalytics && (
            <EmptyState
              title={t(language, "Loading project…", "Cargando proyecto…")}
              body={
                mode === "demo"
                  ? t(
                      language,
                      "Preparing the fictional demo workspace.",
                      "Preparando el espacio de demostración ficticio.",
                    )
                  : t(
                      language,
                      user.isPersonal ? "Loading your projects." : "Reading the complete workbook and project records.",
                      user.isPersonal ? "Cargando tus proyectos." : "Leyendo el presupuesto completo y los registros del proyecto.",
                    )
              }
            />
          )}
          {!loading && error && !showingAnalytics && (
            <EmptyState
              title={t(
                language,
                "Project unavailable",
                "Proyecto no disponible",
              )}
              body={error}
              action={
                <button
                  className="primary-button"
                  onClick={() => void loadProject()}
                >
                  {t(language, "Try again", "Intentar de nuevo")}
                </button>
              }
            />
          )}
          {!loading && projectMismatch && projectAccessError && <EmptyState title={t(language, "Project access required", "No tienes acceso a este proyecto")} body={t(language, "The linked project is unavailable or your membership is not approved.", "El proyecto del enlace no está disponible o tu acceso no está aprobado.")} action={<button className="primary-button" onClick={() => setActive("overview")}>{t(language, "Open my project", "Abrir mi proyecto")}</button>} />}
          {!loading && !projectMismatch && !sectionAccessible && <EmptyState title={t(language, "Section access required", "No tienes acceso a esta sección")} body={t(language, "Your project permissions do not include this section.", "Tus permisos del proyecto no incluyen esta sección.")} />}
          {!loading && !error && workspaceAvailable && (active === "distribution" || active === "furniture") && !distributionReady && <EmptyState title={active === "furniture" ? t(language, "Furniture is not ready yet", "Mobiliario todavía no preparado") : t(language, "3D distribution is not ready yet", "Distribución 3D todavía no preparada")} body={t(language, "The project model must be prepared before this view is available.", "El modelo del proyecto debe prepararse antes de que esta vista esté disponible.")} />}
          {!loading && !error && workspaceAvailable && visibleActive === "overview" && mode === "real" && user.isPersonal && (
            <ProjectHub
              language={language}
              projects={demoProjects}
              busy={busy}
              onOpen={changeProject}
              onCreate={createProject}
              onEdit={setEditingProject}
              onToggleFavorite={toggleFavoriteProject}
              onSetOpenFavorite={setOpenFavoriteOnSignIn}
            />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "overview" && (mode === "demo" || !user.isPersonal) && (
            <Overview
              key={user.projectId}
              mode={mode}
              language={language}
              projectId={user.projectId}
              projectName={activeWorkspaceName}
              documents={demoDocuments}
              pending={pendingApprovals.length}
              propertyProfile={propertyProfile}
              canOpenBudget={hasTabAccess("budget")}
              canOpenDocuments={hasTabAccess("documents")}
              canOpenApprovals={hasTabAccess("approvals")}
              canOpenActivity={hasActivityAccess}
              canOpenAesthetics={hasTabAccess("aesthetics")}
              canOpenDistribution={hasTabAccess("distribution") && distributionReady}
              canOpenNotes={hasTabAccess("notes")}
              canEdit={user.role !== "viewer" && !user.readOnlyLink}
              onNavigate={setActive}
            />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "activity" && hasActivityAccess && (
            <ActivityWorkspace mode={mode} language={language} onNavigate={(section, itemId) => {
              const next: WorkspaceDestination = { projectId: user.projectId, section, budgetScope: null };
              void navigateDestination(next).then((navigated) => {
                if (!navigated || mode !== "real" || !itemId) return;
                const url = new URL(window.location.href);
                url.searchParams.set("item", itemId);
                writeDestination(next, true, url.href);
              });
            }} />
          )}
          {showingAnalytics && (
            <AnalyticsWorkspace language={language} />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "budget" && hasTabAccess("budget") && (
            <BudgetWorkspace
              projectId={user.projectId}
              routeScope={destination.budgetScope}
              onRouteScopeChange={changeBudgetScope}
              onRegisterNavigationGuard={registerNavigationGuard}
              mode={mode}
              language={language}
              canEdit={user.role !== "viewer"}
              canReplace={user.role === "admin"}
              canViewPurchases={hasTabAccess("expenses")}
              isOwner={user.role === "admin"}
              onReplace={() => workbookInput.current?.click()}
              assistantDraftId={assistantDraftId}
              onAssistantDraftOpened={() => setAssistantDraftId(null)}
            />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "quotes" && hasTabAccess("quotes") && (
            <QuotesWorkspace language={language} mode={mode} canEdit={user.role !== "viewer"} allowChat={!user.readOnlyLink} />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "expenses" && hasTabAccess("expenses") && (
            <ExpensesWorkspace key={`expenses-${captureVersion}`} projectId={user.projectId} mode={mode} language={language} isOwner={user.role === "admin" || user.role === "editor"} />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "documents" && documentFolderUnavailable && <EmptyState title={t(language, "Folder unavailable", "Carpeta no disponible")} body={t(language, "This folder no longer exists or your current permissions do not include it.", "Esta carpeta ya no existe o tus permisos actuales no incluyen acceso a ella.")} action={<button className="secondary-button" onClick={() => setSelectedFolder("root")}>{t(language, "Open documents", "Abrir documentos")}</button>} />}
          {!loading && !error && workspaceAvailable && visibleActive === "documents" && !documentFolderUnavailable && hasTabAccess("documents") && (
            <Documents
              key={`documents-${user.projectId}:${selectedFolder}`}
              projectId={user.projectId}
              currency={mode === "demo" ? "USD" : projectCurrency(user.projectCurrency)}
              demoFeaturedIds={demoFeaturedDocumentIds}
              onDemoFeaturedChange={setDemoFeaturedDocumentIds}
              mode={mode}
              language={language}
              allowSemanticSearch={!user.anonymousLink}
              documents={filteredDocuments}
              allDocuments={demoDocuments}
              folders={demoFolders}
              selectedFolder={selectedFolder}
              setSelectedFolder={setSelectedFolder}
              search={documentSearch}
              setSearch={setDocumentSearch}
              rootView={documentRootView}
              setRootView={setDocumentRootView}
              busy={busy}
              canManage={user.role !== "viewer"}
              canShare={mode === "real" && (user.role === "admin" || user.role === "editor") && !user.readOnlyLink && !user.anonymousLink}
              isAdmin={user.role === "admin"}
              canCreateFolders={
                user.role === "admin" ||
                user.folderAccess.mode === "all" ||
                (selectedFolder !== "root" &&
                  folders.some((folder) => folder.id === selectedFolder))
              }
              canMoveToTopLevel={
                user.role === "admin" || user.folderAccess.mode === "all"
              }
              canMoveTopLevelFolders={user.role === "admin"}
              canDelete={user.role === "admin"}
              canLinkExpenses={user.role === "admin" && hasTabAccess("expenses")}
              onUpload={() => fileInput.current?.click()}
              onUploadFiles={uploadDocumentFiles}
              onCreateFolder={createFolder}
              onMoveDocument={moveDocument}
              onUpdateDescription={updateDocumentDescription}
              onUpdateQuoteReference={updateDocumentQuoteReference}
              onMoveFolder={moveFolder}
              onDeleteFolder={deleteFolder}
              onDeleteDocument={deleteDocument}
              onVaultChange={refreshFolderVault}
              encryptionCleanupPending={encryptionCleanupPending}
              onRefreshDocuments={refreshDocuments}
            />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "notes" && hasTabAccess("notes") && (
            <NotesWorkspace key={user.projectId} mode={mode} language={language} canEdit={user.role !== "viewer"} />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "aesthetics" && hasTabAccess("aesthetics") && (
            <AestheticsWorkspace key={user.projectId} projectId={user.projectId} routeFolderId={destination.folderId || null} onRouteFolderChange={(folderId) => { void navigateDestination({ projectId: user.projectId, section: "aesthetics", budgetScope: null, folderId }); }} mode={mode} language={language} canEdit={user.role !== "viewer"} canShare={mode === "real" && (user.role === "admin" || user.role === "editor") && !user.readOnlyLink && !user.anonymousLink} />
          )}
          {!loading && !error && workspaceAvailable && (visibleActive === "distribution" || visibleActive === "furniture") && distributionReady && (
            <DistributionWorkspace key={`${user.projectId}:distribution`} projectId={user.projectId} mode={mode} language={language} canEdit={user.role !== "viewer"} furnitureView={visibleActive === "furniture"} onViewChange={setActive} />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "approvals" && hasTabAccess("approvals") && (
            <Approvals
              currency={mode === "demo" ? "USD" : projectCurrency(user.projectCurrency)}
              language={language}
              demoMode={mode === "demo"}
              approvals={demoApprovals}
              isAdmin={user.role === "admin"}
              busy={busy}
              resolve={resolveApproval}
            />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "plan" && hasTabAccess("plan") && (
            <Plan
              language={language}
              items={demoPlanItems}
              phaseKey={mode === "demo" ? item => demoFieldKey("plan", item, "phase", demoEditedText[`plan:${item.id}`], demoOwnedText[`plan:${item.id}`]) : undefined}
              countdowns={demoCountdownItems}
              recipients={demoRecipients}
              demoMode={mode === "demo"}
              currentUserEmail={user.email}
              emailEnabled={emailNotificationsEnabled}
              emailConfigured={emailNotificationsConfigured}
              notificationSender={notificationSender}
              now={clock}
              busy={busy}
              canEdit={user.role !== "viewer"}
              formatDemoItem={mode === "demo" ? demoItemFormatter("plan") : undefined}
              onSave={savePlanItem}
              onApplyTemplate={applyPlanTemplate}
              onDelete={deletePlanItem}
              onCreateCountdown={createCountdown}
              onUpdateCountdownRecipients={updateCountdownRecipients}
              onEmailPreference={updateEmailNotificationPreference}
              canSetEmailPreference={!user.anonymousLink}
              onAcknowledgeCountdown={acknowledgeCountdown}
              canAcknowledgeCountdown={!user.readOnlyLink}
              onCompleteCountdown={completeCountdown}
              onDeleteCountdown={deleteCountdown}
            />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "decisions" && hasTabAccess("decisions") && (
            <Decisions
              language={language}
              items={demoDecisions}
              busy={busy}
              canEdit={user.role !== "viewer"}
              formatDemoItem={mode === "demo" ? demoItemFormatter("decisions") : undefined}
              onSave={saveDecision}
              onDelete={deleteDecision}
            />
          )}
          {!loading && !error && workspaceAvailable && visibleActive === "site" && hasTabAccess("site") && (
            <SiteIssues
              mode={mode}
              language={language}
              items={demoSiteIssues}
              busy={busy}
              canEdit={user.role !== "viewer"}
              formatDemoItem={mode === "demo" ? demoItemFormatter("site") : undefined}
              onSave={saveSiteIssue}
              onDelete={deleteSiteIssue}
            />
          )}
          {!loading && !error && workspaceAvailable && mode === "real" && visibleActive === "access" && (
            <><DistributionAdmin key={user.projectId} language={language} documents={demoDocuments} onReady={() => setDistributionReady(true)} /><Access
              language={language}
              user={user}
              users={accessUsers}
              folders={demoFolders}
              invitations={invitations}
              inviteLink={latestInviteLink}
              busy={busy}
              resolve={resolveAccess}
              onPermissionsChange={updateMemberPermissions}
              onFolderAccessChange={updateMemberFolderAccess}
              onInvite={createInvitation}
              onRevokeInvitation={revokeInvitation}
              onDeleteMember={deleteMember}
              onRefreshUsers={refreshAccess}
              onSignOut={() => void leaveWorkspace(onSignOut)}
            /></>
          )}
          {!loading && !error && workspaceAvailable && enabledNavItems.length === 0 && (
            <EmptyState
              title={t(language, "No sections assigned", "No tienes secciones asignadas")}
              body={t(
                language,
                "The project owner has not enabled any sections for your account yet.",
                "El propietario del proyecto todavía no ha habilitado secciones para tu cuenta.",
              )}
            />
          )}
        </div>
        <SiteFooter language={language} />
      </section>
      {(mode === "demo" || (!user.anonymousLink && !projectMismatch && !user.isPersonal)) && (
        <AssistantPanel
          mode={mode}
          language={language}
          role={user.role}
          canBudget={hasTabAccess("budget")}
          canDocuments={hasTabAccess("documents")}
          canNotes={hasTabAccess("notes")}
          onOpenBudget={(draftId) => {
            setAssistantDraftId(draftId || null);
            setActive("budget");
          }}
        />
      )}
      {workspaceAvailable && canCapture && visibleActive === "site" && (
        <MobileCapture
          language={language}
          userEmail={user.email}
          activeProjectId={user.projectId}
          activeProjectName={activeWorkspaceName}
          projects={demoProjects}
          destinations={captureDestinations}
          onProjectChange={changeProject}
          onCompleted={mobileCaptureCompleted}
        />
      )}
      {mode === "real" && !user.anonymousLink && projectPickerOpen && (
        <ModalOverlay className="confirm-modal project-picker-modal" role="dialog" aria-modal="true" aria-label={t(language, "Project selection", "Selección de proyectos")} onMouseDown={() => setProjectPickerOpen(false)} onEscape={() => setProjectPickerOpen(false)}>
          <div className="confirm-card project-picker-card" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span className="overline">{t(language, "YOUR WORKSPACES", "TUS ESPACIOS")}</span><h3>{t(language, "Choose a project", "Elegí un proyecto")}</h3></div><button aria-label={t(language, "Close project selection", "Cerrar selección de proyectos")} onClick={() => setProjectPickerOpen(false)}>×</button></header>
            <p>{t(language, "My space opens by default. Mark one favorite and optionally choose to open it when you sign in.", "Mi espacio se abre por defecto. Marcá un favorito y, si querés, elegí abrirlo al ingresar.")}</p>
            <div className="project-picker-list">{projects.map((project) => {
              const displayName = project.kind === "personal" ? t(language, "My space", "Mi espacio") : project.name;
              return <article className={`${project.active ? "active" : ""} ${project.favorite ? "favorite" : ""}`} key={project.id}><button className="project-picker-open" disabled={busy || project.active} onClick={() => void changeProject(project.id)}><span className="project-picker-icon">{project.kind === "personal" ? "⌂" : "▦"}</span><span><b>{displayName}</b><small>{project.kind === "personal" ? t(language, "Project portal", "Portal de proyectos") : t(language, `Shared project · ${project.role}`, `Proyecto compartido · ${project.role}`)}</small></span>{project.active && <em>{t(language, "Open", "Abierto")}</em>}</button>{project.kind === "shared" && <button className={`project-favorite-button ${project.favorite ? "selected" : ""}`} disabled={busy} aria-label={project.favorite ? t(language, `Remove ${displayName} from favorites`, `Quitar ${displayName} de favoritos`) : t(language, `Mark ${displayName} as favorite`, `Marcar ${displayName} como favorito`)} onClick={() => void toggleFavoriteProject(project.id)}>{project.favorite ? "★" : "☆"}</button>}{project.kind === "shared" && project.role === "admin" && <button className="secondary-button" disabled={busy} aria-label={t(language, `Edit project ${displayName}`, `Editar proyecto ${displayName}`)} onClick={() => { setProjectPickerOpen(false); setEditingProject(project); }}>{t(language, "Settings", "Configuración")}</button>}</article>;
            })}</div>
            <label className={`project-default-choice ${favoriteProject && favoriteProject.kind !== "personal" ? "" : "disabled"}`}><input type="checkbox" checked={openFavoriteOnSignIn} disabled={busy || !favoriteProject || favoriteProject.kind === "personal"} onChange={(event) => void setOpenFavoriteOnSignIn(event.target.checked)} /><span><b>{t(language, "Open favorite when I sign in", "Abrir el favorito cuando ingrese")}</b><small>{favoriteProject?.kind === "shared" ? t(language, `${favoriteProject.name} will open instead of My space.`, `${favoriteProject.name} se abrirá en lugar de Mi espacio.`) : favoriteProject ? t(language, "My space already opens by default.", "Mi espacio ya se abre por defecto.") : t(language, "Choose a favorite project first.", "Primero elegí un proyecto favorito.")}</small></span></label>
            <div className="confirm-actions"><button className="primary-button" onClick={() => setProjectPickerOpen(false)}>{t(language, "Done", "Listo")}</button></div>
          </div>
        </ModalOverlay>
      )}
      {editingProject && <ProjectCurrencyDialog key={editingProject.id} project={projects.find((project) => project.id === editingProject.id) || editingProject} language={language} busy={busy} onSave={updateProjectCurrency} onClose={() => setEditingProject(null)} />}
      <input
        ref={workbookInput}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={importWorkbook}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={uploadDocuments}
      />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}

export function ProjectHub({
  language,
  projects,
  busy,
  onOpen,
  onCreate,
  onEdit,
  onToggleFavorite,
  onSetOpenFavorite,
}: {
  language: Language;
  projects: ProjectChoice[];
  busy: boolean;
  onOpen: (projectId: string) => Promise<void>;
  onCreate: (name: string, currency: ProjectCurrency) => Promise<boolean>;
  onEdit: (project: ProjectChoice) => void;
  onToggleFavorite: (projectId: string) => Promise<void>;
  onSetOpenFavorite: (enabled: boolean) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [currency, setCurrency] = useState<ProjectCurrency>("USD");
  const availableProjects = projects.filter((project) => project.kind === "shared");
  const favorite = availableProjects.find((project) => project.favorite);
  const openFavorite = availableProjects.some((project) => project.openOnSignIn);

  const submit = async () => {
    const name = projectName.trim();
    if (name.length < 2) return;
    if (await onCreate(name, currency)) {
      setCreating(false);
      setProjectName("");
    }
  };

  return (
    <section className="project-hub">
      <header className="project-hub-hero">
        <div>
          <span className="overline">{t(language, "MY SPACE", "MI ESPACIO")}</span>
          <h2>{t(language, "Your projects, in one place", "Tus proyectos, en un solo lugar")}</h2>
          <p>{t(language, "My space is only your private project portal. Budgets, files and schedules stay inside each project.", "Mi espacio es únicamente tu portal privado de proyectos. Los presupuestos, archivos y cronogramas permanecen dentro de cada proyecto.")}</p>
        </div>
        <button className="primary-button project-create-button" disabled={busy} onClick={() => setCreating(true)}>
          <span>＋</span> {t(language, "New project", "Nuevo proyecto")}
        </button>
      </header>

      <div className="project-hub-heading">
        <div>
          <span className="overline">{t(language, "PROJECTS", "PROYECTOS")}</span>
          <h3>{t(language, "Choose where to work", "Elegí dónde trabajar")}</h3>
        </div>
        <span>{availableProjects.length} {availableProjects.length === 1 ? t(language, "project", "proyecto") : t(language, "projects", "proyectos")}</span>
      </div>

      {availableProjects.length > 0 ? (
        <div className="project-hub-grid">
          {availableProjects.map((project) => (
            <article className={"project-hub-card" + (project.favorite ? " favorite" : "")} key={project.id}>
              <div className="project-hub-card-top">
                <span className="project-hub-icon">▦</span>
                <button className={"project-favorite-button" + (project.favorite ? " selected" : "")} disabled={busy} aria-label={project.favorite ? t(language, "Remove favorite", "Quitar favorito") : t(language, "Mark as favorite", "Marcar como favorito")} onClick={() => void onToggleFavorite(project.id)}>
                  {project.favorite ? "★" : "☆"}
                </button>
              </div>
              <div>
                <h4>{project.name}</h4>
                <p>{project.role === "admin" ? t(language, "Owner", "Propietario") : project.role === "viewer" ? t(language, "View only", "Solo lectura") : t(language, "Collaborator", "Colaborador")} · {projectCurrency(project.currency)}</p>
              </div>
              {project.role === "admin" && <button className="secondary-button" disabled={busy} onClick={() => onEdit(project)} aria-label={t(language, `Edit project ${project.name}`, `Editar proyecto ${project.name}`)}>{t(language, "Project settings", "Configuración del proyecto")}</button>}
              <button className="secondary-button" disabled={busy} onClick={() => void onOpen(project.id)}>
                {t(language, "Open project", "Abrir proyecto")} <span>→</span>
              </button>
            </article>
          ))}
          <button className="project-hub-add-card" disabled={busy} onClick={() => setCreating(true)}>
            <span>＋</span>
            <b>{t(language, "Create another project", "Crear otro proyecto")}</b>
            <small>{t(language, "Start with a clean budget and files.", "Empezá con presupuesto y archivos limpios.")}</small>
          </button>
        </div>
      ) : (
        <div className="project-hub-empty">
          <span>▦</span>
          <h3>{t(language, "You do not have projects yet", "Todavía no tenés proyectos")}</h3>
          <p>{t(language, "Create your first project to start a clean, independent workspace.", "Creá tu primer proyecto para iniciar un espacio limpio e independiente.")}</p>
          <button className="primary-button" disabled={busy} onClick={() => setCreating(true)}>{t(language, "Create first project", "Crear primer proyecto")}</button>
        </div>
      )}

      <label className={"project-default-choice project-hub-default" + (favorite ? "" : " disabled")}>
        <input type="checkbox" checked={openFavorite} disabled={busy || !favorite} onChange={(event) => void onSetOpenFavorite(event.target.checked)} />
        <span>
          <b>{t(language, "Open my favorite project when I sign in", "Abrir mi proyecto favorito al ingresar")}</b>
          <small>{favorite ? t(language, favorite.name + " will open instead of My space.", favorite.name + " se abrirá en lugar de Mi espacio.") : t(language, "Mark a project as favorite to enable this option.", "Marcá un proyecto como favorito para activar esta opción.")}</small>
        </span>
      </label>

      {creating && (
        <ModalOverlay className="confirm-modal" role="dialog" aria-modal="true" aria-label={t(language, "Create project", "Crear proyecto")} onMouseDown={() => { if (!busy) setCreating(false); }} onEscape={() => { if (!busy) setCreating(false); }}>
          <form className="confirm-card project-create-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <span className="overline">{t(language, "NEW PROJECT", "NUEVO PROYECTO")}</span>
            <h3>{t(language, "Name your project", "Nombrá tu proyecto")}</h3>
            <p>{t(language, "It will have its own budget, documents, expenses and schedule.", "Tendrá su propio presupuesto, documentos, gastos y cronograma.")}</p>
            <label>
              <span>{t(language, "Project name", "Nombre del proyecto")}</span>
              <input  maxLength={80} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={t(language, "Example: Beach house", "Ejemplo: Casa de playa")} />
            </label>
            <CurrencySelect value={currency} onChange={setCurrency} language={language} disabled={busy} />
            <p>{t(language, "Currency applies to budgets, payments and Excel exports. Later changes require confirmation once financial work exists; amounts are never converted automatically.", "La moneda se aplica al presupuesto, pagos y exportaciones de Excel. Los cambios posteriores requieren confirmación cuando existe trabajo financiero; los importes nunca se convierten automáticamente.")}</p>
            <div className="confirm-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setCreating(false)}>{t(language, "Cancel", "Cancelar")}</button>
              <button type="submit" className="primary-button" disabled={busy || projectName.trim().length < 2}>{busy ? t(language, "Creating…", "Creando…") : t(language, "Create and open", "Crear y abrir")}</button>
            </div>
          </form>
        </ModalOverlay>
      )}
    </section>
  );
}

function Overview({
  mode,
  language,
  projectId,
  projectName,
  documents,
  pending,
  propertyProfile,
  canOpenBudget,
  canOpenDocuments,
  canOpenApprovals,
  canOpenActivity,
  canOpenAesthetics,
  canOpenDistribution,
  canOpenNotes,
  canEdit,
  onNavigate,
}: {
  mode: WorkspaceMode;
  language: Language;
  projectId: string;
  projectName: string;
  documents: DocumentRecord[];
  pending: number;
  propertyProfile: PropertyProfile | null;
  canOpenBudget: boolean;
  canOpenDocuments: boolean;
  canOpenApprovals: boolean;
  canOpenActivity: boolean;
  canOpenAesthetics: boolean;
  canOpenDistribution: boolean;
  canOpenNotes: boolean;
  canEdit: boolean;
  onNavigate: (key: NavKey) => void;
}) {
  const demo = mode === "demo";
  const [overviewView, setOverviewView] = useState<"summary" | "measurements">("summary");
  if (demo) return <DemoOverview language={language} pending={pending} onNavigate={onNavigate} />;
  return (
    <>
      <div className="welcome-row">
        <div>
          <span className="overline">
            {demo
              ? t(language, "SAFE DEMONSTRATION", "DEMOSTRACIÓN SEGURA")
              : t(
                  language,
                  "THE PLANNED HOUSE",
                  "LA CASA PROYECTADA",
                )}
          </span>
          <h2>
            {demo
              ? t(language, "Explore House Planner", "Explora House Planner")
              : projectName}
          </h2>
          <p>
            {demo
              ? t(
                  language,
                  "A complete interactive example built only with fictional information.",
                  "Un ejemplo interactivo completo creado únicamente con información ficticia.",
                )
              : t(
                  language,
                  "Discover the house through the images and information shared with you.",
                  "Conoce la casa a través de las imágenes y la información compartidas contigo.",
                )}
          </p>
        </div>
      </div>
      {propertyProfile && <nav className="overview-submenu" aria-label={t(language, "Overview sections", "Secciones del resumen")}>
        <button className={overviewView === "summary" ? "selected" : ""} aria-pressed={overviewView === "summary"} onClick={() => setOverviewView("summary")}>{t(language, "General overview", "Vista general")}</button>
        <button className={overviewView === "measurements" ? "selected" : ""} aria-pressed={overviewView === "measurements"} onClick={() => setOverviewView("measurements")}>{t(language, "Measurements & areas", "Medidas y áreas")}</button>
      </nav>}
      {overviewView === "measurements" && propertyProfile ? <PropertyMeasurements language={language} profile={propertyProfile} /> : <>
      <OverviewHighlights mode={mode} language={language} projectId={projectId} projectName={projectName} canEdit={canEdit} canOpenAesthetics={canOpenAesthetics} canOpenDistribution={canOpenDistribution} canOpenNotes={canOpenNotes} canOpenDocuments={canOpenDocuments} documents={documents} propertyProfile={propertyProfile} onNavigate={onNavigate} />
      {canOpenApprovals && <div className="metric-grid overview-secondary-metrics">
          <Metric
            label={t(language, "Pending approvals", "Aprobaciones pendientes")}
            value={String(pending)}
            tone="violet"
          />
      </div>}
      {canOpenBudget && <div className="overview-grid lower overview-links">
        <section className="card honest-card">
          <span className="overline">
            {demo
              ? t(language, "FICTIONAL WORKBOOK", "PRESUPUESTO FICTICIO")
              : t(language, "SOURCE OF TRUTH", "FUENTE OFICIAL")}
          </span>
          <h3>
            {demo
              ? t(language, "Editable demo budget", "Presupuesto demo editable")
              : t(
                  language,
                  "House budget",
                  "Presupuesto de la casa",
                )}
          </h3>
          <p>
            {demo
              ? t(
                  language,
                  "Explore category dashboards, edit generated worksheets, and download the synthetic workbook.",
                  "Explora paneles por categoría, edita hojas generadas y descarga el libro ficticio.",
                )
              : t(
                  language,
                  "View the project budget and recorded payments.",
                  "Consulta el presupuesto del proyecto y los pagos registrados.",
                )}
          </p>
          <button
            className="primary-button"
            onClick={() => onNavigate("budget")}
          >
            {t(language, "Open workbook", "Abrir presupuesto")}
          </button>
        </section>
      </div>}
      {canOpenActivity && <ActivitySummaryCard mode={mode} language={language} onNavigate={() => onNavigate("activity")} />}
      </>}
    </>
  );
}

function PropertyMeasurements({ language, profile }: { language: Language; profile: PropertyProfile }) {
  return <section className="property-measurements">
    <header>
      <div><span className="overline">{t(language, "PROPERTY TECHNICAL FILE", "FICHA TÉCNICA DE LA PROPIEDAD")}</span><h3>{t(language, "Measurements and areas", "Medidas y áreas")}</h3></div>
      <span className="revision-chip">✓ {language === "es" ? profile.revisionLabelEs : profile.revisionLabelEn}</span>
    </header>
    <p>{t(language, "Corrected reference areas for the house and vehicle footprint.", "Áreas de referencia corregidas para la casa y la huella vehicular.")}</p>
    <div className="property-measurements-table">
      <table>
        <thead><tr><th>{t(language, "Concept", "Concepto")}</th><th>{t(language, "Approx. area", "Área aprox.")}</th></tr></thead>
        <tbody>{profile.measurements.map((item) => <tr className={item.emphasis ? "emphasis" : ""} key={item.id}><th>{language === "es" ? item.labelEs : item.labelEn}</th><td>{item.value}</td></tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function Metric({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


function Documents({
  currency,
  projectId,
  demoFeaturedIds,
  onDemoFeaturedChange,
  mode,
  language,
  allowSemanticSearch,
  documents,
  allDocuments,
  folders,
  selectedFolder,
  setSelectedFolder,
  search,
  setSearch,
  rootView,
  setRootView,
  busy,
  canManage,
  canShare,
  isAdmin,
  canCreateFolders,
  canMoveToTopLevel,
  canMoveTopLevelFolders,
  canDelete,
  canLinkExpenses,
  onUpload,
  onUploadFiles,
  onCreateFolder,
  onMoveDocument,
  onUpdateDescription,
  onUpdateQuoteReference,
  onMoveFolder,
  onDeleteFolder,
  onDeleteDocument,
  onVaultChange,
  encryptionCleanupPending,
  onRefreshDocuments,
}: {
  projectId: string;
  currency: ProjectCurrency;
  demoFeaturedIds: string[];
  onDemoFeaturedChange: (ids: string[]) => void;
  mode: WorkspaceMode;
  language: Language;
  allowSemanticSearch: boolean;
  documents: DocumentRecord[];
  allDocuments: DocumentRecord[];
  folders: FolderRecord[];
  selectedFolder: string;
  setSelectedFolder: (id: string) => void;
  search: string;
  setSearch: (value: string) => void;
  rootView: "featured" | "unfiled";
  setRootView: (value: "featured" | "unfiled") => void;
  busy: boolean;
  canManage: boolean;
  canShare: boolean;
  isAdmin: boolean;
  canCreateFolders: boolean;
  canMoveToTopLevel: boolean;
  canMoveTopLevelFolders: boolean;
  canDelete: boolean;
  canLinkExpenses: boolean;
  onUpload: () => void;
  onUploadFiles: (files: File[], folderId: string | null) => Promise<void>;
  onCreateFolder: (name: string, parentId: string | null, password?: string) => Promise<boolean>;
  onMoveDocument: (id: string, folderId: string | null) => void;
  onUpdateDescription: (id: string, description: string) => Promise<boolean>;
  onUpdateQuoteReference: (id: string, enabled: boolean) => Promise<void>;
  onMoveFolder: (id: string, parentId: string | null) => Promise<boolean>;
  onDeleteFolder: (id: string) => Promise<boolean>;
  onDeleteDocument: (id: string) => Promise<boolean>;
  onVaultChange: (folderId: string, locked: boolean) => Promise<void>;
  encryptionCleanupPending: number;
  onRefreshDocuments: () => Promise<void>;
}) {
  const isFeatured = selectedFolder === "root" && rootView === "featured";
  const featuredSelection = useFeaturedDocumentsSelection({ mode, projectId, enabled: selectedFolder === "root", demoIds: demoFeaturedIds, onDemoChange: onDemoFeaturedChange });
  const eligibleFeaturedDocuments = allDocuments.filter(doc => {
    if (doc.encrypted) return false;
    if (!doc.folderId) return true;
    const path = folderPath(folders, doc.folderId);
    return path.length > 0 && path[0].parentId === null && path[path.length - 1].id === doc.folderId
      && !path.some(folder => folder.encrypted)
      && !["factura", "compras"].includes(path[0].name.trim().toLocaleLowerCase());
  });
  const featuredById = new Map(eligibleFeaturedDocuments.map(doc => [doc.id, doc]));
  const featuredFolderLabel = (doc: DocumentRecord) => doc.folderId
    ? folderPath(folders, doc.folderId).map(folder => folder.name).join(" / ")
    : t(language, "Unfiled", "Sin carpeta");
  const displayedDocuments = isFeatured ? featuredSelection.documentIds.flatMap(id => {
    const doc = featuredById.get(id);
    return doc ? [doc] : [];
  }) : documents;
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [encryptFolder, setEncryptFolder] = useState(false);
  const [folderPassword, setFolderPassword] = useState("");
  const [folderPasswordConfirmation, setFolderPasswordConfirmation] = useState("");
  const [previewRecord, setPreview] = useState<DocumentRecord | null>(null);
  const [previewFromSearch, setPreviewFromSearch] = useState(false);
  const sharedFolderLabel = (id: string | null | undefined) => {
    if (!id) return t(language, "Unfiled", "Sin carpeta");
    const folder = folders.find((item) => item.id === id);
    return folder ? folderOptionLabel(folder, folders) : t(language, "Shared folder", "Carpeta compartida");
  };
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [draggingDocument, setDraggingDocument] = useState<string | null>(null);
  const [draggingFolder, setDraggingFolder] = useState<string | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [movingFolder, setMovingFolder] = useState<FolderRecord | null>(null);
  const [describing, setDescribing] = useState<DocumentRecord | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [moveSearch, setMoveSearch] = useState("");
  const [linkingDocument, setLinkingDocument] = useState<DocumentRecord | null>(null);
  const [expenseChoices, setExpenseChoices] = useState<ExpenseRecord[]>([]);
  const [expenseLinkBusy, setExpenseLinkBusy] = useState("");
  const [expenseLinkError, setExpenseLinkError] = useState("");
  const [expenseLinkQuery, setExpenseLinkQuery] = useState("");
  const documentDisplayName = (item: DocumentRecord, locale: Language) => mode === "demo" ? localizeMainDemoRecord("documents", item, locale).name : item.name;
  const folderDisplayName = (item: FolderRecord, locale: Language) => mode === "demo" ? localizeMainDemoRecord("folders", item, locale).name : item.name;
  const [confirmation, setConfirmation] = useState<{
    title: (language: Language) => string;
    body: (language: Language) => string;
    confirmLabel: (language: Language) => string;
    cancelLabel: (language: Language) => string;
    onConfirm: () => void;
    danger?: boolean;
  } | null>(null);
  const selected = folders.find((folder) => folder.id === selectedFolder);
  const invoiceFolder = folders.find((folder) => folder.parentId === null && folder.name.trim().toLocaleLowerCase() === "factura");
  const selectedIsInvoiceFolder = Boolean(selected && invoiceFolder && selected.id === invoiceFolder.id);
  const currentParentId = selected?.id ?? null;
  const visibleFolders = directChildFolders(folders, currentParentId);
  const selectedPath = selected ? folderPath(folders, selected.id) : [];
  const selectedVault = selectedPath.find((folder) => folder.encrypted);
  const selectedLocked = Boolean(selectedVault && !selectedVault.unlocked);
  const [previousLocked, setPreviousLocked] = useState(selectedLocked);
  const creationValid = Boolean(folderName.trim()) && (!encryptFolder || (folderPassword.length >= 12 && folderPassword.length <= 128 && folderPassword === folderPasswordConfirmation));
  const selectedHasChildren = selected
    ? folders.some((folder) => folder.parentId === selected.id)
    : false;
  const selectedCount = selected
    ? allDocuments.filter((doc) => doc.folderId === selected.id).length
    : allDocuments.filter((doc) => doc.folderId === null).length;
  const currentPreview = previewRecord ? allDocuments.find(doc => doc.id === previewRecord.id) : null;
  const previewVault = currentPreview ? protectedFolderRoot(folders, currentPreview.folderId) : null;
  const previewPath = currentPreview?.folderId ? folderPath(folders, currentPreview.folderId) : [];
  const previewPathAvailable = !currentPreview?.folderId || (previewPath.length > 0 && previewPath[0].parentId === null && previewPath[previewPath.length - 1].id === currentPreview.folderId);
  const preview = currentPreview && previewPathAvailable && (previewFromSearch || !isFeatured || featuredById.has(currentPreview.id)) && (!previewVault || previewVault.unlocked === true) && (!currentPreview.encrypted || previewVault?.unlocked === true) ? currentPreview : null;
  if (selectedLocked !== previousLocked) {
    setPreviousLocked(selectedLocked);
    if (selectedLocked) {
      setPreview(null);
      setDescribing(null);
      setDescriptionDraft("");
      setLinkingDocument(null);
      setMovingFolder(null);
      setConfirmation(null);
      setCreating(false);
      setFolderPassword("");
      setFolderPasswordConfirmation("");
      setDraggingDocument(null);
      setDraggingFolder(null);
      setDraggingFiles(false);
      setDropTarget(null);
    }
  }
  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [preview]);
  useEffect(() => {
    if (!confirmation && !movingFolder && !describing) return;
    const closeConfirmation = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmation(null);
        setMovingFolder(null);
        setDescribing(null);
      }
    };
    window.addEventListener("keydown", closeConfirmation);
    return () => window.removeEventListener("keydown", closeConfirmation);
  }, [confirmation, movingFolder, describing]);
  useEffect(() => {
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files"))
        event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);
  const create = async () => {
    if (!creationValid || selectedLocked) return;
    const submittedPassword = encryptFolder ? folderPassword : undefined;
    setFolderPassword("");
    setFolderPasswordConfirmation("");
    if (await onCreateFolder(folderName, selected?.id ?? null, submittedPassword)) {
      setFolderName("");
      setEncryptFolder(false);
      setFolderPassword("");
      setFolderPasswordConfirmation("");
      setCreating(false);
    }
  };
  const allowDrop = (
    event: DragEvent<HTMLElement>,
    targetKey: string,
    destinationFolderId?: string | null,
  ) => {
    if (!canManage || busy) return;
    const destinationVault = protectedFolderRoot(folders, destinationFolderId ?? null);
    if (destinationVault && !destinationVault.unlocked) return;
    const containsFiles =
      Array.from(event.dataTransfer.types).includes("Files") ||
      Array.from(event.dataTransfer.items).some((item) => item.kind === "file");
    const containsFolder =
      Array.from(event.dataTransfer.types).includes(FOLDER_DRAG_TYPE) ||
      Boolean(draggingFolder);
    if (!containsFiles && !draggingDocument && !containsFolder) return;
    if (containsFolder && destinationFolderId !== undefined) {
      const sourceId =
        event.dataTransfer.getData(FOLDER_DRAG_TYPE) || draggingFolder;
      if (!sourceId) return;
      const source = folders.find((folder) => folder.id === sourceId);
      if (
        !source ||
        source.encrypted ||
        protectedFolderRoot(folders, source.id)?.id !== destinationVault?.id ||
        source.parentId === destinationFolderId ||
        source.id === destinationFolderId ||
        (destinationFolderId &&
          folderDescendantIds(folders, source.id).has(destinationFolderId))
      ) return;
    }
    if (draggingDocument) {
      const source = allDocuments.find((doc) => doc.id === draggingDocument);
      if (source?.encrypted && protectedFolderRoot(folders, source.folderId)?.id !== destinationVault?.id) return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = containsFiles ? "copy" : "move";
    setDraggingFiles(containsFiles);
    setDropTarget(targetKey);
  };
  const leaveDropTarget = (
    event: DragEvent<HTMLElement>,
    targetKey: string,
  ) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    )
      return;
    setDropTarget((current) => (current === targetKey ? null : current));
    setDraggingFiles(false);
  };
  const dropIntoFolder = (
    event: DragEvent<HTMLElement>,
    folderId: string | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    setDraggingDocument(null);
    setDraggingFolder(null);
    setDraggingFiles(false);
    if (!canManage || busy) return;
    const destinationVault = protectedFolderRoot(folders, folderId);
    if (destinationVault && !destinationVault.unlocked) return;
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (!droppedFiles.length) {
      for (const item of Array.from(event.dataTransfer.items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) droppedFiles.push(file);
      }
    }
    if (droppedFiles.length) {
      void onUploadFiles(droppedFiles, folderId);
      return;
    }
    const folderIdToMove = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
    const folderToMove = folders.find((item) => item.id === folderIdToMove);
    if (folderToMove && !folderToMove.encrypted && protectedFolderRoot(folders, folderToMove.id)?.id === destinationVault?.id && folderToMove.parentId !== folderId) {
      setMovingFolder(folderToMove);
      setMoveTarget(folderId ?? "");
      setMoveSearch("");
      return;
    }
    const documentId = event.dataTransfer.getData(DOCUMENT_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
    const document = allDocuments.find((item) => item.id === documentId);
    if (document && document.folderId !== folderId && (!document.encrypted || protectedFolderRoot(folders, document.folderId)?.id === destinationVault?.id)) onMoveDocument(document.id, folderId);
  };
  const movingFolderDescendants = movingFolder
    ? folderDescendantIds(folders, movingFolder.id)
    : new Set<string>();
  const moveDestinations = movingFolder
    ? folders.filter(
        (folder) =>
          folder.id !== movingFolder.id &&
          (!protectedFolderRoot(folders, folder.id) || protectedFolderRoot(folders, folder.id)?.unlocked === true) &&
          protectedFolderRoot(folders, folder.id)?.id === protectedFolderRoot(folders, movingFolder.id)?.id &&
          !movingFolderDescendants.has(folder.id),
      )
    : [];
  const filteredMoveDestinations = moveDestinations
    .filter((folder) =>
      folderOptionLabel(folder, folders)
        .toLocaleLowerCase()
        .includes(moveSearch.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      folderOptionLabel(a, folders).localeCompare(folderOptionLabel(b, folders)),
    );
  const moveUnchanged = movingFolder
    ? moveTarget === (movingFolder.parentId ?? "")
    : true;
  const confirmMoveFolder = () => {
    if (!movingFolder || moveUnchanged) return;
    const folderId = movingFolder.id;
    const parentId = moveTarget || null;
    setMovingFolder(null);
    setMoveSearch("");
    void onMoveFolder(folderId, parentId);
  };
  const openExpenseLinker = async (document: DocumentRecord) => {
    setLinkingDocument(document);
    setExpenseChoices([]);
    setExpenseLinkError("");
    setExpenseLinkQuery("");
    if (mode === "demo") {
      setExpenseChoices(DEMO_EXPENSES_FOR_DOCUMENTS);
      return;
    }
    setExpenseLinkBusy("loading");
    try {
      const response = await fetch("/api/expenses", { cache: "no-store" });
      const data = await response.json() as { expenses?: ExpenseRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Expenses unavailable");
      setExpenseChoices(data.expenses || []);
    } catch (reason) {
      setExpenseLinkError(reason instanceof Error ? reason.message : t(language, "Expenses unavailable", "Gastos no disponibles"));
    } finally { setExpenseLinkBusy(""); }
  };
  const linkDocumentToExpense = async (expense: ExpenseRecord) => {
    if (!linkingDocument) return;
    setExpenseLinkBusy(expense.id);
    setExpenseLinkError("");
    try {
      if (mode === "demo") {
        const createdAt = new Date().toISOString();
        setExpenseChoices((current) => current.map((item) => item.id === expense.id && !item.attachments.some((attachment) => attachment.documentId === linkingDocument.id) ? { ...item, attachments: [...item.attachments, { id: "demo-document-link-" + linkingDocument.id, documentId: linkingDocument.id, fileName: linkingDocument.name, contentType: linkingDocument.contentType, createdAt, isImage: Boolean(linkingDocument.isImage) }] } : item));
        return;
      }
      const response = await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budgetLineId: expense.id, receiptDocumentId: linkingDocument.id }) });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok) throw new Error(data.error || t(language, "The file could not be linked", "No se pudo vincular el archivo"));
      setExpenseChoices((current) => current.map((item) => item.id === expense.id && !item.attachments.some((attachment) => attachment.documentId === linkingDocument.id) ? { ...item, attachments: [...item.attachments, { id: String(data.id || ""), documentId: linkingDocument.id, fileName: linkingDocument.name, contentType: linkingDocument.contentType, createdAt: new Date().toISOString(), isImage: Boolean(linkingDocument.isImage) }] } : item));
    } catch (reason) {
      setExpenseLinkError(reason instanceof Error ? reason.message : t(language, "The file could not be linked", "No se pudo vincular el archivo"));
    } finally { setExpenseLinkBusy(""); }
  };
  const unlinkDocumentFromExpense = async (expense: ExpenseRecord) => {
    if (!linkingDocument) return;
    const attachment = expense.attachments.find((item) => item.documentId === linkingDocument.id);
    if (!attachment?.id) return;
    setExpenseLinkBusy(expense.id);
    setExpenseLinkError("");
    try {
      if (mode === "demo") {
        setExpenseChoices((current) => current.map((item) => item.id === expense.id ? { ...item, attachments: item.attachments.filter((currentAttachment) => currentAttachment.documentId !== linkingDocument.id) } : item));
        return;
      }
      const response = await fetch("/api/expenses?id=" + encodeURIComponent(attachment.id), { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || t(language, "The link could not be removed", "No se pudo quitar el vínculo"));
      setExpenseChoices((current) => current.map((item) => item.id === expense.id ? { ...item, attachments: item.attachments.filter((currentAttachment) => currentAttachment.documentId !== linkingDocument.id) } : item));
    } catch (reason) {
      setExpenseLinkError(reason instanceof Error ? reason.message : t(language, "The link could not be removed", "No se pudo quitar el vínculo"));
    } finally { setExpenseLinkBusy(""); }
  };
  const visibleExpenseChoices = (mode === "demo" ? localizeMainDemo("expenses", expenseChoices, language) : expenseChoices).filter((expense) =>
    (expense.description + " " + expense.vendor + " " + expense.chapter + " " + expense.subcategory)
      .toLocaleLowerCase()
      .includes(expenseLinkQuery.trim().toLocaleLowerCase()),
  );
  const linkedExpenseCount = linkingDocument
    ? (mode === "demo" ? localizeMainDemo("expenses", expenseChoices, language) : expenseChoices).filter((expense) => expense.attachments.some((attachment) => attachment.documentId === linkingDocument.id)).length
    : 0;
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="overline">
            {mode === "demo"
              ? t(
                  language,
                  "FICTIONAL SAMPLE LIBRARY",
                  "BIBLIOTECA FICTICIA DE EJEMPLO",
                )
              : t(
                  language,
                  "PROJECT FILES",
                  "ARCHIVOS DEL PROYECTO",
                )}
          </span>
          <h2>
            {canManage ? t(language, "Documents and folders", "Documentos y carpetas") : t(language, "Plans and documents", "Planos y documentos")}
          </h2>
          <p>
            {mode === "demo"
              ? t(
                  language,
                  "These downloadable examples are fictional. Files you add stay only during this visit.",
                  "Estos ejemplos descargables son ficticios. Los archivos que agregues permanecen solo durante esta visita.",
                )
              : canManage ? t(
                  language,
                  "New uploads appear automatically. Mark the plans and references you want to use in quote reviews.",
                  "Las nuevas cargas aparecen automáticamente. Marca los planos y referencias que quieras usar en Cotizaciones.",
                ) : t(language, "Explore the folders and open the files shared with you.", "Explora las carpetas y abre los archivos compartidos contigo.")}
          </p>
        </div>
      </div>
      <DocumentSearch projectId={projectId} language={language} mode={mode} allowSemantic={allowSemanticSearch} documents={allDocuments} folders={folders} query={search} onQueryChange={setSearch} onPreview={id => {
        const document = allDocuments.find(candidate => candidate.id === id);
        if (document) { trackUsageInteraction("document.open"); setPreviewFromSearch(true); setPreview(document); }
      }} onOpenFolder={folderId => { setSearch(""); if (folderId) setSelectedFolder(folderId); else { setSelectedFolder("root"); setRootView("unfiled"); } }} />
      <FolderEncryptionPending count={encryptionCleanupPending} language={language} onRefresh={onRefreshDocuments} />
      {canManage && folders.length > 0 && (
        <p className="drag-hint">
          ↳ {t(language, "Drag a folder onto another folder to move it. You can also drop document rows or files from your computer.", "Arrastra una carpeta sobre otra para moverla. También puedes soltar filas de documentos o archivos de tu computadora.")}
        </p>
      )}
      {selectedIsInvoiceFolder && canLinkExpenses && (
        <div className="invoice-expense-link-guide">
          <span>↔</span>
          <div>
            <b>{t(language, "Link invoices to existing expenses", "Uní facturas a gastos existentes")}</b>
            <small>{t(language, "Use “Link to expense” on any image or PDF below. You can add or remove links without moving the file out of the invoices folder.", "Usá “Vincular a gasto” en cualquier imagen o PDF de abajo. Podés agregar o quitar vínculos sin sacar el archivo de Factura.")}</small>
          </div>
        </div>
      )}
      {selected && selectedPath.length > 0 && (
        <div className="folder-breadcrumb" aria-label={t(language, "Folder path", "Ruta de carpeta")}>
          <button onClick={() => setSelectedFolder("root")}>
            {t(language, "Documents", "Documentos")}
          </button>
          {selectedPath.map((folder) => (
            <span key={folder.id}>
              <i>/</i>
              <button
                className={selectedFolder === folder.id ? "current" : ""}
                onClick={() => setSelectedFolder(folder.id)}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </div>
      )}
      {selectedVault && mode === "real" && <FolderVault
        key={selectedVault.id}
        folderId={selectedVault.id}
        folderName={selectedVault.name}
        unlocked={selectedVault.unlocked === true}
        isAdmin={isAdmin}
        language={language}
        onChange={async (locked) => {
          if (locked) {
            setPreview(null);
            setDescribing(null);
            setLinkingDocument(null);
          }
          await onVaultChange(selectedVault.id, locked);
        }}
      />}
      {creating && (
        <div className={`new-folder-form ${!selected && isAdmin && mode === "real" ? "protected-folder-form" : ""}`}>
          <input
            autoFocus
            maxLength={80}
            aria-label={
              selected
                ? t(language, `Subfolder name in ${selected.name}`, `Nombre de subcarpeta en ${selected.name}`)
                : t(language, "Top-level folder name", "Nombre de carpeta principal")
            }
            placeholder={
              selected
                ? t(language, "Subfolder name", "Nombre de subcarpeta")
                : t(language, "Folder name", "Nombre de carpeta")
            }
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void create();
              if (event.key === "Escape") setCreating(false);
            }}
          />
          <button
            className="primary-button"
            disabled={busy || !creationValid || selectedLocked}
            onClick={() => void create()}
          >
            {t(language, "Create folder", "Crear carpeta")}
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              setCreating(false);
              setFolderName("");
              setEncryptFolder(false);
              setFolderPassword("");
              setFolderPasswordConfirmation("");
            }}
          >
            {t(language, "Cancel", "Cancelar")}
          </button>
          {!selected && isAdmin && mode === "real" && <div className="folder-protection-fields">
            <label><input type="checkbox" checked={encryptFolder} disabled={busy} onChange={(event) => { setEncryptFolder(event.target.checked); setFolderPassword(""); setFolderPasswordConfirmation(""); }} /><span>{t(language, "Encrypt and protect with a password", "Encriptar y proteger con contraseña")}</span></label>
            {encryptFolder && <>
              <p>{t(language, "Only people granted access by the administrator can open this folder, and they will need its password. Files and subfolders inherit this protection.", "Solo las personas autorizadas por el administrador podrán abrir esta carpeta y necesitarán su contraseña. Los archivos y subcarpetas heredan esta protección.")}</p>
              <div className="folder-protection-passwords">
                <label><span>{t(language, "New folder password", "Contraseña de la nueva carpeta")}</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={folderPassword} disabled={busy} onChange={(event) => setFolderPassword(event.target.value)} /></label>
                <label><span>{t(language, "Confirm password", "Confirmar contraseña")}</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={folderPasswordConfirmation} disabled={busy} onChange={(event) => setFolderPasswordConfirmation(event.target.value)} /></label>
              </div>
              <small>{t(language, "Use 12–128 characters. The administrator can reset it if you forget it.", "Usa de 12 a 128 caracteres. El administrador puede restablecerla si la olvidas.")}</small>
              {folderPasswordConfirmation && folderPassword !== folderPasswordConfirmation && <small role="status">{t(language, "The passwords do not match.", "Las contraseñas no coinciden.")}</small>}
            </>}
          </div>}
        </div>
      )}
      <div className={`folder-grid document-folders ${draggingDocument || draggingFolder || draggingFiles ? "dragging-active" : ""}`}>
        {selected && (
          <button
            className="folder-card up"
            onClick={() => setSelectedFolder(selected.parentId ?? "root")}
          >
            <span>↑</span>
            <b>{t(language, "Back", "Volver")}</b>
            <small>
              {selected.parentId
                ? folders.find((folder) => folder.id === selected.parentId)?.name
                : t(language, "Documents", "Documentos")}
            </small>
          </button>
        )}
        {visibleFolders.map((folder, index) => {
          const descendantIds = folderDescendantIds(folders, folder.id);
          const count = allDocuments.filter(
            (doc) => doc.folderId && descendantIds.has(doc.folderId),
          ).length;
          const subfolderCount = folders.filter(
            (candidate) => candidate.parentId === folder.id,
          ).length;
          const canMoveThisFolder =
            canManage &&
            !folder.encrypted &&
            folder.id !== invoiceFolder?.id &&
            (folder.parentId !== null || canMoveTopLevelFolders);
          return (
            <article
              className={`folder-card ${["blue", "sand", "violet"][index % 3]} ${selectedFolder === folder.id ? "selected" : ""} ${dropTarget === `folder:${folder.id}` ? "drop-target" : ""} ${draggingFolder === folder.id ? "dragging-folder" : ""}`}
              data-drop-label={draggingFolder ? t(language, "Move here", "Mover aquí") : t(language, "Drop here", "Suelta aquí")}
              key={folder.id}
              draggable={canMoveThisFolder && !busy}
              onDragStart={(event) => {
                if (!canMoveThisFolder) return;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
                setDraggingFolder(folder.id);
              }}
              onDragEnd={() => {
                setDraggingFolder(null);
                setDraggingFiles(false);
                setDropTarget(null);
              }}
              onDragEnter={(event) => allowDrop(event, `folder:${folder.id}`, folder.id)}
              onDragOver={(event) => allowDrop(event, `folder:${folder.id}`, folder.id)}
              onDragLeave={(event) =>
                leaveDropTarget(event, `folder:${folder.id}`)
              }
              onDrop={(event) =>
                dropIntoFolder(event, folder.id)
              }
            >
              <button
                className="folder-card-open"
                draggable={canMoveThisFolder && !busy}
                onClick={() => setSelectedFolder(folder.id)}
                aria-label={t(language, `Open ${folder.name}`, `Abrir ${folder.name}`)}
              >
                <span>{folder.encrypted ? (folder.unlocked ? "🔓" : "🔒") : "▱"}</span>
                <b>{folder.name}</b>
                <small>
                  {folder.encrypted && !folder.unlocked ? t(language, "Protected · locked", "Protegida · bloqueada") : <>
                  {subfolderCount > 0 &&
                    `${subfolderCount} ${
                      t(language, "folders", "carpetas")
                    } · `}
                  {count}{" "}
                  {t(language, count === 1 ? "file" : "files", count === 1 ? "archivo" : "archivos")}
                  </>}
                </small>
                {folder.encrypted && folder.unlocked && <small className="folder-vault-status">{t(language, "Protected · unlocked", "Protegida · desbloqueada")}</small>}
              </button>
              {canMoveThisFolder && (
                <button
                  className="folder-quick-move"
                  disabled={busy}
                  onClick={() => {
                    setMovingFolder(folder);
                    setMoveTarget(folder.parentId ?? "");
                    setMoveSearch("");
                  }}
                  aria-label={t(language, `Move ${folder.name}`, `Mover ${folder.name}`)}
                >
                  ⇱ {t(language, "Move", "Mover")}
                </button>
              )}
            </article>
          );
        })}
        {canManage && canCreateFolders && !selectedLocked && (
          <button
            className={`folder-card new-folder-card ${creating ? "active" : ""}`}
            disabled={busy}
            onClick={() => {
              setCreating((value) => !value);
              setFolderName("");
              setEncryptFolder(false);
              setFolderPassword("");
              setFolderPasswordConfirmation("");
            }}
          >
            <span>＋</span>
            <b>
              {selected
                ? t(language, "New subfolder", "Nueva subcarpeta")
                : t(language, "New folder", "Nueva carpeta")}
            </b>
            <small>
              {selected
                ? t(language, `Inside ${selected.name}`, `Dentro de ${selected.name}`)
                : t(language, "At the top level", "En el nivel principal")}
            </small>
          </button>
        )}
      </div>
      <section
        className={`card document-list ${isFeatured ? "featured-documents-panel" : ""} ${!isFeatured && dropTarget === `list:${selected?.id ?? "unfiled"}` ? "file-drop-target" : ""}`}
        data-drop-label={
          selected
            ? t(language, `Upload to ${selected.name}`, `Subir a ${selected.name}`)
            : t(language, "Upload without a folder", "Subir sin carpeta")
        }
        onDragEnter={isFeatured ? undefined : (event) =>
          allowDrop(event, `list:${selected?.id ?? "unfiled"}`, selected?.id ?? null)
        }
        onDragOver={isFeatured ? (event) => event.preventDefault() : (event) =>
          allowDrop(event, `list:${selected?.id ?? "unfiled"}`, selected?.id ?? null)
        }
        onDragLeave={isFeatured ? undefined : (event) =>
          leaveDropTarget(event, `list:${selected?.id ?? "unfiled"}`)
        }
        onDrop={isFeatured ? (event) => { event.preventDefault(); event.stopPropagation(); } : (event) =>
          dropIntoFolder(
            event,
            selected?.id ?? null,
          )
        }
      >
        <div className="section-head">
          <div>
            <span className="overline">
              {selected
                ? t(language, "SELECTED FOLDER", "CARPETA SELECCIONADA")
                : t(language, "FILE LIBRARY", "BIBLIOTECA DE ARCHIVOS")}
            </span>
            <h3>
              {selected?.name ?? (isFeatured ? t(language, "Featured documents", "Documentos destacados") : t(language, "Unfiled documents", "Documentos sin carpeta"))}
            </h3>
          </div>
          <div className="document-list-actions">
            {selectedFolder === "root" && <div className="featured-documents-views" role="group" aria-label={t(language, "Document views", "Vistas de documentos")}>
              <button type="button" className="secondary-button" aria-pressed={isFeatured} onClick={() => { setRootView("featured"); setSearch(""); }}>{t(language, "Featured", "Destacados")}</button>
              <button type="button" className="secondary-button" aria-pressed={!isFeatured} onClick={() => { setRootView("unfiled"); setSearch(""); }}>{t(language, "Unfiled documents", "Documentos sin carpeta")}</button>
            </div>}
            {isFeatured && <FeaturedDocumentsSelection language={language} documents={eligibleFeaturedDocuments} folders={folders} canManage={canManage} busy={busy} selection={featuredSelection} />}
            {selected && !selected.encrypted && !selectedLocked && !selectedIsInvoiceFolder && canManage && (selected.parentId !== null || canMoveTopLevelFolders) && (
              <button
                className="secondary-button move-folder-button"
                disabled={busy}
                onClick={() => {
                  setMovingFolder(selected);
                  setMoveTarget(selected.parentId ?? "");
                  setMoveSearch("");
                }}
              >
                ⇱ {t(language, "Move folder", "Mover carpeta")}
              </button>
            )}
            {selected && !selectedLocked && !selectedIsInvoiceFolder && selectedCount === 0 && !selectedHasChildren && canManage && (
              <button
                className="text-danger"
                disabled={busy}
                onClick={() =>
                  setConfirmation({
                    title: (nextLanguage: Language) => t(nextLanguage, "Delete empty folder?", "¿Eliminar carpeta vacía?"),
                    body: (nextLanguage: Language) => t(
                      nextLanguage,
                      `“${folderDisplayName(selected, nextLanguage)}” will be permanently removed.`,
                      `“${folderDisplayName(selected, nextLanguage)}” se eliminará de forma permanente.`,
                    ),
                    confirmLabel: (nextLanguage: Language) => t(nextLanguage, "Delete folder", "Eliminar carpeta"),
                    cancelLabel: (nextLanguage: Language) => t(nextLanguage, "Cancel", "Cancelar"),
                    onConfirm: () => void onDeleteFolder(selected.id),
                    danger: true,
                  })
                }
              >
                {t(language, "Delete empty folder", "Eliminar carpeta vacía")}
              </button>
            )}
            {!isFeatured && canManage && <button
              className="primary-button upload-button"
              disabled={busy || selectedLocked}
              onClick={onUpload}
            >
              ⇧{" "}
              {busy
                ? t(language, "Working…", "Procesando…")
                : mode === "demo"
                  ? t(language, "Try an upload", "Probar una carga")
                  : t(language, "Upload files", "Subir archivos")}
            </button>}
          </div>
        </div>
        {selectedLocked ? <EmptyState title={t(language, "Folder locked", "Carpeta bloqueada")} body={t(language, "Enter the folder password above to see its contents.", "Ingresa la contraseña de la carpeta arriba para ver su contenido.")} /> : displayedDocuments.length ? (
          <>
            <div className="doc-header">
              <span>{t(language, "Name", "Nombre")}</span>
              <span>{t(language, "Type", "Tipo")}</span>
              <span>{t(language, "Folder", "Carpeta")}</span>
              <span>{t(language, "Added", "Agregado")}</span>
              <span>{t(language, "Owner", "Responsable")}</span>
              <span>{t(language, "Actions", "Acciones")}</span>
            </div>
            {displayedDocuments.map((doc) => (
              <div
                className={`doc-row ${isFeatured ? "featured-document-row" : ""} ${draggingDocument === doc.id ? "dragging" : ""}`}
                key={doc.id}
                draggable={!isFeatured && canManage && !busy}
                onDragStart={(event) => {
                  if (isFeatured) { event.preventDefault(); return; }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, doc.id);
                  event.dataTransfer.setData("text/plain", doc.id);
                  setDraggingDocument(doc.id);
                }}
                onDragEnd={() => {
                  setDraggingDocument(null);
                  setDraggingFiles(false);
                  setDropTarget(null);
                }}
              >
                <span>
                  {doc.previewUrl && doc.previewKind ? (
                    <button
                      className={`doc-preview-trigger ${doc.previewKind === "image" ? "doc-thumb" : "doc-file-preview"}`}
                      onClick={() => { trackUsageInteraction("document.open"); setPreviewFromSearch(false); setPreview(doc); }}
                      aria-label={t(
                        language,
                        `Preview ${doc.name}`,
                        `Vista previa de ${doc.name}`,
                      )}
                    >
                      {doc.previewKind === "image" && doc.thumbnailUrl ? (
                        <Image
                          unoptimized
                          width={46}
                          height={46}
                          src={doc.thumbnailUrl}
                          alt=""
                        />
                      ) : (
                        <i className="doc-icon">
                          {doc.previewKind === "pdf" ? "PDF" : doc.previewKind === "docx" ? "W" : "♪"}
                        </i>
                      )}
                    </button>
                  ) : (
                    <i className="doc-icon">▱</i>
                  )}
                  <span>
                    <b>{doc.name}</b>
                    <small>
                      {formatBytes(doc.size)}
                      {doc.isImage ? ` · ${t(language, "Photo", "Foto")}` : ""}
                      {["ready", "completed"].includes(doc.aiIndexStatus || "") ? ` · ${t(language, "Assistant ready", "Listo para el asistente")}` : ""}
                      {doc.aiIndexStatus === "in_progress" ? ` · ${t(language, "Assistant indexing", "Indexando para el asistente")}` : ""}
                      {doc.aiIndexStatus === "failed" ? ` · ${t(language, "Assistant index failed", "Falló el índice del asistente")}` : ""}
                    </small>
                    {!isFeatured && canManage && !doc.encrypted && doc.quoteReferenceSupported && (
                      <label className="quote-reference-document-toggle" onPointerDown={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={doc.quoteReferenceEnabled === true}
                          disabled={busy || !canManage}
                          aria-label={t(language, `Use ${doc.name} in quote reviews`, `Usar ${doc.name} en cotizaciones`)}
                          onChange={(event) => void onUpdateQuoteReference(doc.id, event.target.checked)}
                        />
                        <span>{t(language, "Use in Quotes", "Usar en Cotizaciones")}</span>
                      </label>
                    )}
                    {doc.description && <em className="document-description">{doc.description}</em>}
                  </span>
                </span>
                <span className="type-chip">
                  {doc.contentType.split("/").pop()}
                </span>
                {isFeatured ? <button type="button" className="featured-document-path" aria-label={t(language, `Open folder for ${doc.name}: ${featuredFolderLabel(doc)}`, `Abrir carpeta de ${doc.name}: ${featuredFolderLabel(doc)}`)} onClick={() => { setSearch(""); if (doc.folderId) setSelectedFolder(doc.folderId); else setRootView("unfiled"); }}>{featuredFolderLabel(doc)}</button> : canManage ? <select
                  aria-label={t(
                    language,
                    `Folder for ${doc.name}`,
                    `Carpeta de ${doc.name}`,
                  )}
                  value={doc.folderId ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    onMoveDocument(doc.id, event.target.value || null)
                  }
                >
                  {!doc.encrypted && <option value="">
                    {t(language, "Unfiled", "Sin carpeta")}
                  </option>}
                  {[...folders]
                    .filter((folder) => (!protectedFolderRoot(folders, folder.id) || protectedFolderRoot(folders, folder.id)?.unlocked === true) && (!doc.encrypted || protectedFolderRoot(folders, folder.id)?.id === protectedFolderRoot(folders, doc.folderId)?.id))
                    .sort((a, b) =>
                      folderOptionLabel(a, folders).localeCompare(
                        folderOptionLabel(b, folders),
                      ),
                    )
                    .map((folder) => (
                    <option value={folder.id} key={folder.id}>
                      {folderOptionLabel(folder, folders)}
                    </option>
                    ))}
                </select> : <span className="doc-folder-name">{sharedFolderLabel(doc.folderId)}</span>}
                <span>
                  {new Date(doc.createdAt).toLocaleDateString(
                    language === "es" ? "es-CR" : "en-US",
                  )}
                </span>
                <span>{mode === "demo" && doc.uploadedBy === "Demo Visitor" ? t(language, "Demo Visitor", "Visitante Demo") : doc.uploadedBy}</span>
                <div className="document-row-actions">
                  <FileShareButton kind="document" id={doc.id} name={doc.name} projectId={projectId} language={language} canShare={mode === "real" && canShare} encrypted={Boolean(doc.encrypted || protectedFolderRoot(folders, doc.folderId))} disabled={busy} />
                  {selectedIsInvoiceFolder && canLinkExpenses && (
                    <button
                      className="link-expense-document-button"
                      disabled={busy}
                      aria-label={t(language, `Link ${doc.name} to an expense`, `Vincular ${doc.name} a un gasto`)}
                      onClick={() => void openExpenseLinker(doc)}
                    >
                      ↔ {t(language, "Link to expense", "Vincular a gasto")}
                    </button>
                  )}
                  {!isFeatured && canManage && (
                    <button
                      className="description-document-button"
                      disabled={busy}
                      aria-label={t(language, `Describe ${doc.name}`, `Describir ${doc.name}`)}
                      onClick={() => {
                        setDescribing(doc);
                        setDescriptionDraft(doc.description || "");
                      }}
                    >
                      {t(language, "Describe", "Describir")}
                    </button>
                  )}
                  <a
                    className="download-button"
                    onClick={() => trackUsageInteraction("document.download")} href={doc.downloadUrl}
                    download
                    aria-label={t(
                      language,
                      `Download ${doc.name}`,
                      `Descargar ${doc.name}`,
                    )}
                  >
                    ↓
                  </a>
                  {!isFeatured && canDelete && (
                    <button
                      className="delete-document-button"
                      disabled={busy}
                      aria-label={t(
                        language,
                        `Delete ${doc.name}`,
                        `Eliminar ${doc.name}`,
                      )}
                      onClick={() =>
                        setConfirmation({
                          title: (nextLanguage: Language) => t(nextLanguage, "Remove document?", "¿Eliminar documento?"),
                          body: (nextLanguage: Language) => t(
                            nextLanguage,
                            `“${documentDisplayName(doc, nextLanguage)}” will be moved out of the active project. A recovery copy will be retained.`,
                            `“${documentDisplayName(doc, nextLanguage)}” se quitará del proyecto activo. Se conservará una copia de recuperación.`,
                          ),
                          confirmLabel: (nextLanguage: Language) => t(nextLanguage, "Remove document", "Eliminar documento"),
                          cancelLabel: (nextLanguage: Language) => t(nextLanguage, "Cancel", "Cancelar"),
                          onConfirm: () => void onDeleteDocument(doc.id),
                          danger: true,
                        })
                      }
                    >
                      {t(language, "Delete", "Eliminar")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        ) : (
          <EmptyState
            title={
              isFeatured
                ? featuredSelection.loading ? t(language, "Loading featured documents…", "Cargando documentos destacados…")
                  : featuredSelection.error === "load" ? t(language, "Featured documents unavailable", "Documentos destacados no disponibles")
                  : t(language, "No featured documents yet", "Aún no hay documentos destacados")
                : selected
                ? t(language, "This folder is empty", "Esta carpeta está vacía")
                : t(language, "No documents yet", "Todavía no hay documentos")
            }
            body={
              isFeatured ? featuredSelection.loading || featuredSelection.error === "load" ? ""
                : canManage ? t(language, "Choose the documents you want to see here. Files stay in their folders.", "Selecciona los documentos que quieres ver aquí. Los archivos permanecen en sus carpetas.")
                : t(language, "No featured documents have been shared with you yet.", "Aún no se han compartido documentos destacados contigo.")
              : mode === "demo"
                ? t(
                    language,
                    "Add a temporary file to test the folder workflow.",
                    "Agrega un archivo temporal para probar el flujo de carpetas.",
                  )
                : canManage ? t(
                    language,
                    "Upload a receipt, quote, plan or contract into this folder.",
                    "Sube un recibo, cotización, plano o contrato a esta carpeta.",
                  ) : t(language, "There are no files shared with you here. Open another folder to explore its documents.", "Aquí no hay archivos compartidos contigo. Abre otra carpeta para consultar sus documentos.")
            }
          />
        )}
      </section>
      {!selectedLocked && linkingDocument && (
        <ModalOverlay className="confirm-modal" role="dialog" aria-modal="true" aria-label={t(language, "Link file to expense", "Vincular archivo a gasto")} onMouseDown={() => setLinkingDocument(null)} onEscape={() => { if (!expenseLinkBusy) setLinkingDocument(null); }}>
          <div className="confirm-card expense-document-link-card" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-mark" aria-hidden="true">¤</span>
            <h3>{t(language, "Manage expense links", "Administrar vínculos con gastos")}</h3>
            <p><b>{mode === "demo" ? localizeMainDemoRecord("documents", linkingDocument, language).name : linkingDocument.name}</b><small>{t(language, "Choose any existing paid line. The file stays in the invoices folder and can be linked to more than one expense.", "Elegí cualquier partida pagada existente. El archivo permanece en Factura y puede vincularse a más de un gasto.")}</small></p>
            <div className="expense-link-modal-tools">
              <input  value={expenseLinkQuery} onChange={(event) => setExpenseLinkQuery(event.target.value)} placeholder={t(language, "Search expense, supplier or chapter…", "Buscar gasto, proveedor o capítulo…")} />
              <span>{linkedExpenseCount} {linkedExpenseCount === 1 ? t(language, "linked expense", "gasto vinculado") : t(language, "linked expenses", "gastos vinculados")}</span>
            </div>
            {expenseLinkError && <div className="form-error" role="alert">{expenseLinkError}</div>}
            <div className="expense-document-link-list">
              {expenseLinkBusy === "loading" ? <div className="editor-loading">{t(language, "Reading paid lines…", "Leyendo partidas pagadas…")}</div> : expenseChoices.length === 0 ? <div className="expense-empty"><b>{t(language, "No paid lines yet", "Aún no hay partidas pagadas")}</b><p>{t(language, "Add a Price paid in Excel and publish the workbook first.", "Agregá un Precio pagado en el Excel y publicá el libro primero.")}</p></div> : visibleExpenseChoices.length === 0 ? <div className="expense-empty"><b>{t(language, "No matching expenses", "No hay gastos que coincidan")}</b></div> : visibleExpenseChoices.map((expense) => {
                const linked = expense.attachments.some((attachment) => attachment.documentId === linkingDocument.id);
                return <article className={linked ? "linked" : ""} key={expense.id}><span><b>{expense.description}</b><small>{expense.vendor} · {expense.chapter}</small></span><strong>{formatBudgetAmount(expense.amount, language, currency)}</strong><button className={linked ? "unlink" : ""} disabled={Boolean(expenseLinkBusy)} onClick={() => void (linked ? unlinkDocumentFromExpense(expense) : linkDocumentToExpense(expense))}>{expenseLinkBusy === expense.id ? t(language, "Saving…", "Guardando…") : linked ? t(language, "Unlink", "Desvincular") : t(language, "Link", "Vincular")}</button></article>;
              })}
            </div>
            <div className="confirm-actions"><button className="secondary-button" disabled={Boolean(expenseLinkBusy)} onClick={() => setLinkingDocument(null)}>{t(language, "Close", "Cerrar")}</button></div>
          </div>
        </ModalOverlay>
      )}
      {!selectedLocked && describing && (
        <ModalOverlay className="confirm-modal" role="dialog" aria-modal="true" aria-label={t(language, "Document description", "Descripción del documento")} onMouseDown={() => setDescribing(null)} onEscape={() => { if (!busy) setDescribing(null); }}>
          <div className="confirm-card document-description-card" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-mark" aria-hidden="true">▱</span>
            <h3>{t(language, "Reference for the assistant", "Referencia para el asistente")}</h3>
            <p><b>{mode === "demo" ? localizeMainDemoRecord("documents", describing, language).name : describing.name}</b><small>{t(language, "Save a short description of what this file contains. Gemini uses it to find the right document before checking the source text.", "Guarda una descripción breve de lo que contiene. Gemini la usa para ubicar el documento correcto antes de revisar el texto fuente.")}</small></p>
            <label className="document-description-field">
              <span>{t(language, "Short description", "Descripción breve")}</span>
              <textarea  maxLength={400} value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} placeholder={t(language, "Example: Signed construction contract with payment and warranty terms.", "Ejemplo: Contrato de obra firmado con condiciones de pago y garantía.")} />
              <small>{descriptionDraft.length}/400</small>
            </label>
            <div className="confirm-actions">
              <button className="secondary-button" disabled={busy} onClick={() => setDescribing(null)}>{t(language, "Cancel", "Cancelar")}</button>
              <button className="primary-button" disabled={busy || !descriptionDraft.trim()} onClick={() => void onUpdateDescription(describing.id, descriptionDraft).then((saved) => { if (saved) setDescribing(null); })}>{t(language, "Save description", "Guardar descripción")}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {!selectedLocked && movingFolder && (
        <ModalOverlay
          className="confirm-modal move-folder-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t(language, "Move folder", "Mover carpeta")}
          onMouseDown={() => {
            setMovingFolder(null);
            setMoveSearch("");
          }}
         onEscape={() => { if (!busy) { setMovingFolder(null); setMoveSearch(""); } }}>
          <div
            className="confirm-card move-folder-card"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="confirm-mark" aria-hidden="true">
              ⇱
            </span>
            <h3>{t(language, "Move folder", "Mover carpeta")}</h3>
            <p>
              <b>{mode === "demo" ? localizeMainDemoRecord("folders", movingFolder, language).name : movingFolder.name}</b>
              <small>
                {t(
                  language,
                  "Choose the new parent folder. Subfolders inherit the destination folder’s access.",
                  "Elige la carpeta principal nueva. Las subcarpetas heredan el acceso de la carpeta destino.",
                )}
              </small>
            </p>
            {movingFolder.parentId === null && (
              <div className="move-access-warning">
                <b>{t(language, "Access changes with the destination", "El acceso cambia con el destino")}</b>
                <span>{t(language, "This main folder and everything inside it will inherit the destination folder’s access.", "Esta carpeta principal y todo su contenido heredarán el acceso de la carpeta destino.")}</span>
              </div>
            )}
            <div className="move-location-summary">
              <span>{t(language, "Current location", "Ubicación actual")}</span>
              <b>
                {movingFolder.parentId && folders.some((folder) => folder.id === movingFolder.parentId)
                  ? folderOptionLabel(folders.find((folder) => folder.id === movingFolder.parentId)!, folders)
                  : t(language, "Documents (top level)", "Documentos (nivel principal)")}
              </b>
            </div>
            <label className="move-search-label">
              <span>{t(language, "Find a destination", "Buscar un destino")}</span>
              <input

                type="search"
                value={moveSearch}
                placeholder={t(language, "Search folders…", "Buscar carpetas…")}
                onChange={(event) => setMoveSearch(event.target.value)}
              />
            </label>
            <div className="move-destination-list" role="listbox" aria-label={t(language, "Destination", "Destino")}>
              {canMoveToTopLevel && !protectedFolderRoot(folders, movingFolder.id) && !moveSearch.trim() && (
                <button
                  className={moveTarget === "" ? "selected" : ""}
                  disabled={busy || movingFolder.parentId === null}
                  onClick={() => setMoveTarget("")}
                  role="option"
                  aria-selected={moveTarget === ""}
                >
                  <span className="move-folder-icon">⌂</span>
                  <span><b>{t(language, "Documents", "Documentos")}</b><small>{t(language, "Top level", "Nivel principal")}</small></span>
                  {moveTarget === "" && <i>✓</i>}
                </button>
              )}
              {filteredMoveDestinations.map((folder) => {
                const depth = Math.max(0, folderPath(folders, folder.id).length - 1);
                const unchanged = folder.id === movingFolder.parentId;
                return (
                  <button
                    style={{ "--folder-depth": depth } as React.CSSProperties}
                    className={moveTarget === folder.id ? "selected" : ""}
                    disabled={busy || unchanged}
                    onClick={() => setMoveTarget(folder.id)}
                    role="option"
                    aria-selected={moveTarget === folder.id}
                    key={folder.id}
                  >
                    <span className="move-folder-icon">▱</span>
                    <span><b>{folder.name}</b><small>{folderOptionLabel(folder, folders)}</small></span>
                    {moveTarget === folder.id && <i>✓</i>}
                    {unchanged && <em>{t(language, "Current", "Actual")}</em>}
                  </button>
                );
              })}
              {filteredMoveDestinations.length === 0 && moveSearch.trim() && (
                <div className="move-empty">{t(language, "No matching folders", "No hay carpetas coincidentes")}</div>
              )}
            </div>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setMovingFolder(null);
                  setMoveSearch("");
                }}
              >
                {t(language, "Cancel", "Cancelar")}
              </button>
              <button
                className="primary-button"
                disabled={busy || moveUnchanged}
                onClick={confirmMoveFolder}
              >
                {t(language, "Move here", "Mover aquí")}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {!selectedLocked && confirmation && (
        <ModalOverlay
          className="confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-label={confirmation.title(language)}
          onMouseDown={() => setConfirmation(null)}
         onEscape={() => { if (!busy) setConfirmation(null); }}>
          <div
            className={`confirm-card ${confirmation.danger ? "danger" : ""}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="confirm-mark" aria-hidden="true">
              {confirmation.danger ? "!" : "?"}
            </span>
            <h3>{confirmation.title(language)}</h3>
            <p>{confirmation.body(language)}</p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                onClick={() => setConfirmation(null)}
              >
                {confirmation.cancelLabel(language)}
              </button>
              <button
                className={confirmation.danger ? "danger-button" : "primary-button"}
                disabled={busy}
                onClick={() => {
                  const action = confirmation.onConfirm;
                  setConfirmation(null);
                  action();
                }}
              >
                {confirmation.confirmLabel(language)}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {preview?.previewUrl && preview.previewKind && (
        <ModalOverlay
          className="photo-preview"
          role="dialog"
          aria-modal="true"
          aria-label={t(
            language,
            `Preview ${preview.name}`,
            `Vista previa de ${preview.name}`,
          )}
          onMouseDown={() => setPreview(null)}
         onEscape={() => setPreview(null)}>
          <div onMouseDown={(event) => event.stopPropagation()}>
            <div>
              <b>{preview.name}</b>
              <button
                onClick={() => setPreview(null)}
                aria-label={t(language, "Close preview", "Cerrar vista previa")}
              >
                ×
              </button>
            </div>
            {preview.previewKind === "image" ? (
              <Image
                unoptimized
                width={1600}
                height={1200}
                src={preview.previewUrl}
                alt={preview.name}
              />
            ) : preview.previewKind === "audio" ? (
              <audio className="document-audio" controls preload="metadata" src={preview.previewUrl} />
            ) : (
              <iframe
                className={`document-frame ${preview.previewKind}`}
                src={preview.previewUrl}
                title={preview.name}
                sandbox={
                  preview.previewKind === "docx" ? "allow-popups" : undefined
                }
              />
            )}
            <a
              className="primary-button link-button"
              onClick={() => trackUsageInteraction("document.download")} href={preview.downloadUrl}
              download
            >
              ↓ {t(language, "Download original", "Descargar original")}
            </a>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

const planDate = (value: string) => new Date(`${value}T00:00:00`);
const planStatusLabel = (status: PlanItem["status"], language: Language) => ({
  not_started: t(language, "Not started", "Sin iniciar"),
  in_progress: t(language, "In progress", "En curso"),
  blocked: t(language, "Blocked", "Bloqueado"),
  done: t(language, "Done", "Completado"),
})[status];

function PlanGantt({ language, items }: { language: Language; items: PlanItem[] }) {
  const dated = items.filter((item) => item.startDate && item.endDate);
  if (!dated.length) {
    return (
      <EmptyState
        title={t(language, "No dated plan items", "No hay elementos con fecha")}
        body={t(language, "Apply a template or add start and end dates to see the Gantt chart.", "Aplica una plantilla o agrega fechas de inicio y fin para ver el cronograma.")}
      />
    );
  }
  const sorted = [...dated].sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1));
  const min = planDate(sorted[0].startDate!);
  const max = new Date(Math.max(...dated.map((item) => planDate(item.endDate!).getTime())));
  const totalDays = Math.max(1, Math.round((max.getTime() - min.getTime()) / 86400000) + 1);
  const left = (date: string) => Math.max(0, Math.min(100, ((planDate(date).getTime() - min.getTime()) / 86400000 / totalDays) * 100));
  const width = (item: PlanItem) => {
    const start = planDate(item.startDate!);
    const end = planDate(item.endDate!);
    return Math.max(1, Math.min(100, ((end.getTime() - start.getTime()) / 86400000 + 1) / totalDays * 100));
  };
  return (
    <section className="card gantt-card">
      <div className="section-head">
        <div>
          <span className="overline">{t(language, "GANTT VIEW", "VISTA DE CRONOGRAMA")}</span>
          <h3>{t(language, "Project timeline", "Cronograma del proyecto")}</h3>
        </div>
        <span className="gantt-range">
          {min.toLocaleDateString(language === "es" ? "es-CR" : "en-US")} — {max.toLocaleDateString(language === "es" ? "es-CR" : "en-US")}
        </span>
      </div>
      <div className="gantt-list">
        {sorted.map((item) => (
          <div className="gantt-row" key={item.id}>
            <div className="gantt-label">
              <b>{item.title}</b>
              <small>{item.phase || t(language, "No phase", "Sin fase")}</small>
            </div>
            <div className="gantt-track">
              <span
                className={`gantt-bar status-${item.status}`}
                style={{ left: `${left(item.startDate!)}%`, width: `${width(item)}%` }}
                title={`${item.startDate} → ${item.endDate}`}
              >
                <i />
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Plan({
  language,
  items,
  countdowns,
  recipients,
  demoMode,
  currentUserEmail,
  emailEnabled,
  emailConfigured,
  notificationSender,
  now,
  busy,
  canEdit,
  phaseKey,
  formatDemoItem,
  onSave,
  onApplyTemplate,
  onDelete,
  onCreateCountdown,
  onUpdateCountdownRecipients,
  onEmailPreference,
  canSetEmailPreference,
  onAcknowledgeCountdown,
  canAcknowledgeCountdown,
  onDeleteCountdown,
  onCompleteCountdown,
}: {
  language: Language;
  items: PlanItem[];
  countdowns: CountdownRecord[];
  recipients: NotificationRecipient[];
  demoMode: boolean;
  currentUserEmail: string;
  emailEnabled: boolean;
  emailConfigured: boolean;
  notificationSender: string;
  now: number;
  busy: boolean;
  canEdit: boolean;
  phaseKey?: (item: PlanItem) => string;
  formatDemoItem?: <T extends object>(item: T, editedFields?: string[]) => T;
  onSave: (item: Omit<PlanItem, "id"> & { id?: string }, editedFields?: string[]) => Promise<boolean>;
  onApplyTemplate: (items: Omit<PlanItem, "id">[], startDate: string | null) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onCreateCountdown: (title: string, durationDays: number, recipientUids: string[]) => Promise<boolean>;
  onUpdateCountdownRecipients: (id: string, recipientUids: string[]) => Promise<boolean>;
  onEmailPreference: (enabled: boolean) => Promise<void>;
  canSetEmailPreference: boolean;
  onAcknowledgeCountdown: (id: string) => Promise<boolean>;
  canAcknowledgeCountdown: boolean;
  onDeleteCountdown: (id: string) => Promise<boolean>;
  onCompleteCountdown: (id: string) => Promise<boolean>;
}) {
  const emptyDraft: Omit<PlanItem, "id"> = {
    title: "",
    phase: "",
    owner: "",
    startDate: null,
    endDate: null,
    status: "not_started",
    dependsOn: [],
    notes: "",
  };
  const [editing, setEditing] = useState<PlanItem | Omit<PlanItem, "id"> | null>(null);
  const [editedTextFields, setEditedTextFields] = useState<string[]>([]);
  const editTextField = (field: string) => setEditedTextFields(current => current.includes(field) ? current : [...current, field]);
  const displayedEditing = editing && formatDemoItem ? formatDemoItem(editing, editedTextFields) : editing;
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateStart, setTemplateStart] = useState<{ template: (typeof PLAN_TEMPLATES)[number]; date: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PlanItem | null>(null);
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"cards" | "gantt">("cards");
  const [countdownTitle, setCountdownTitle] = useState("");
  const [countdownDays, setCountdownDays] = useState(10);
  const [selectedRecipientUids, setSelectedRecipientUids] = useState<string[]>([]);
  useEffect(() => {
    if (selectedRecipientUids.length || !recipients.length) return;
    const current = recipients.find((recipient) => recipient.email.toLowerCase() === currentUserEmail.toLowerCase());
    window.setTimeout(() => setSelectedRecipientUids([current?.uid || recipients[0].uid]), 0);
  }, [currentUserEmail, recipients, selectedRecipientUids.length]);
  const phases = [...new Map(items.filter(item => item.phase).map(item => [phaseKey ? phaseKey(item) : item.phase, item.phase])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const visible = items.filter((item) =>
    (phaseFilter === "all" || (phaseKey ? phaseKey(item) : item.phase) === phaseFilter) &&
    (statusFilter === "all" || item.status === statusFilter),
  );
  const startEdit = (item?: PlanItem) => {
    setEditedTextFields([]);
    setEditing(item ? { ...item } : { ...emptyDraft });
  };
  const save = async () => {
    if (!editing || !editing.title.trim()) return;
    if (await onSave(displayedEditing || editing, editedTextFields)) setEditing(null);
  };
  const completedCount = items.filter((item) => item.status === "done").length;
  const activeCount = items.filter((item) => item.status === "in_progress").length;
  const blockedCount = items.filter((item) => item.status === "blocked").length;
  const planProgress = items.length ? Math.round(completedCount / items.length * 100) : 0;
  const nextMilestone = items.filter((item) => item.status !== "done" && item.endDate).sort((a, b) => a.endDate!.localeCompare(b.endDate!))[0];
  const startCountdown = async () => {
    if (!countdownTitle.trim() || !selectedRecipientUids.length) return;
    if (await onCreateCountdown(countdownTitle.trim(), countdownDays, selectedRecipientUids)) setCountdownTitle("");
  };
  const toggleRecipient = (uid: string, current: string[], update: (uids: string[]) => void) => {
    update(current.includes(uid) ? current.filter((item) => item !== uid) : [...current, uid]);
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="overline">{t(language, "PROJECT PLAN", "PLAN DEL PROYECTO")}</span>
          <h2>{t(language, "Plan and schedule", "Plan y cronograma")}</h2>
          <p>{t(language, "Track phases, milestones and handoffs in one place.", "Controla fases, hitos y entregas en un solo lugar.")}</p>
        </div>
      </div>
      <section className="plan-overview-panel">
        <div className="plan-progress-hero">
          <div className="plan-progress-ring" style={{ "--plan-progress": `${planProgress * 3.6}deg` } as CSSProperties}>
            <span><b>{planProgress}%</b><small>{t(language, "complete", "completo")}</small></span>
          </div>
          <div><span className="overline">{t(language, "TOTAL PROGRESS", "AVANCE TOTAL")}</span><h3>{t(language, "Project at a glance", "El proyecto de un vistazo")}</h3><p>{t(language, `${completedCount} of ${items.length} plan items completed.`, `${completedCount} de ${items.length} elementos completados.`)}</p></div>
        </div>
        <div className="plan-stat-grid">
          <article><span>◐</span><div><small>{t(language, "In progress", "En curso")}</small><b>{activeCount}</b></div></article>
          <article className={blockedCount ? "attention" : ""}><span>!</span><div><small>{t(language, "Blocked", "Bloqueados")}</small><b>{blockedCount}</b></div></article>
          <article><span>◇</span><div><small>{t(language, "Next milestone", "Próximo hito")}</small><b>{nextMilestone?.endDate ? new Date(`${nextMilestone.endDate}T00:00:00`).toLocaleDateString(language === "es" ? "es-CR" : "en-US", { day: "numeric", month: "short" }) : "—"}</b></div></article>
        </div>
      </section>
      <section className="countdown-panel">
        <header>
          <div><span className="overline">{t(language, "DEADLINE WATCH", "CONTROL DE PLAZOS")}</span><h3>{t(language, "Countdown reminders", "Cuentas regresivas")}</h3><p>{t(language, "Send an email 24 hours before and again when the countdown reaches zero.", "Envía un correo 24 horas antes y otro cuando la cuenta regresiva llegue a cero.")}</p></div>
          {canSetEmailPreference && <label className={`email-reminder-toggle ${emailConfigured ? "configured" : "pending"}`}><input type="checkbox" checked={emailConfigured && emailEnabled} disabled={!emailConfigured} onChange={(event) => void onEmailPreference(event.target.checked)} /><span><b>{emailConfigured ? t(language, "Email reminders", "Recordatorios por correo") : demoMode ? t(language, "Email disabled in demo", "Correo desactivado en la demo") : t(language, "Email activation pending", "Activación de correo pendiente")}</b><small>{emailConfigured ? `${t(language, "Sent by", "Enviado por")} ${notificationSender}` : demoMode ? t(language, "The public demo never sends external messages.", "La demo pública nunca envía mensajes externos.") : t(language, "The exclusive Gmail sender is being connected.", "Se está conectando el Gmail exclusivo remitente.")}</small></span></label>}
        </header>
        {canEdit && <div className="countdown-compose"><div className="countdown-create"><input aria-label={t(language, "Reminder title", "Título del recordatorio")} value={countdownTitle} maxLength={140} placeholder={t(language, "What needs a reminder?", "¿Qué necesitas recordar?")} onChange={(event) => setCountdownTitle(event.target.value)} /><label><input aria-label={t(language, "Countdown days", "Días de la cuenta regresiva")} type="number" min="1" max="365" value={countdownDays} onChange={(event) => setCountdownDays(Math.min(365, Math.max(1, Number(event.target.value) || 10)))} /><span>{t(language, "days", "días")}</span></label><button className="primary-button" disabled={busy || !countdownTitle.trim() || !selectedRecipientUids.length} onClick={() => void startCountdown()}>{t(language, "Start countdown", "Iniciar contador")}</button></div><div className="countdown-recipient-picker"><small>{t(language, "EMAIL RECIPIENTS", "DESTINATARIOS DEL CORREO")}</small><div>{recipients.map((recipient) => <label key={recipient.uid}><input type="checkbox" checked={selectedRecipientUids.includes(recipient.uid)} onChange={() => toggleRecipient(recipient.uid, selectedRecipientUids, setSelectedRecipientUids)} /><span><b>{recipient.name}</b><small>{recipient.email}</small></span></label>)}</div></div></div>}
        <CountdownList countdowns={countdowns} recipients={recipients} language={language} now={now} busy={busy} canEdit={canEdit} canAcknowledge={canAcknowledgeCountdown} onComplete={onCompleteCountdown} onAcknowledge={onAcknowledgeCountdown} onUpdateRecipients={onUpdateCountdownRecipients} onDelete={onDeleteCountdown} />
      </section>
      {editing && (
        <div className="editor-panel">
          <div className="editor-head">
            <h3>{t(language, "Plan item", "Elemento del plan")}</h3>
            <button className="icon-button" onClick={() => setEditing(null)} aria-label={t(language, "Close editor", "Cerrar editor")}>×</button>
          </div>
          <div className="editor-grid">
            <label>
              <span>{t(language, "Title", "Título")}</span>
              <input value={displayedEditing!.title} maxLength={300} onChange={(event) => { editTextField("title"); setEditing({ ...editing, title: event.target.value }); }} />
            </label>
            <label>
              <span>{t(language, "Phase", "Fase")}</span>
              <input value={displayedEditing!.phase} maxLength={120} onChange={(event) => { editTextField("phase"); setEditing({ ...editing, phase: event.target.value }); }} />
            </label>
            <label>
              <span>{t(language, "Owner", "Responsable")}</span>
              <input value={displayedEditing!.owner} maxLength={160} onChange={(event) => { editTextField("owner"); setEditing({ ...editing, owner: event.target.value }); }} />
            </label>
            <label>
              <span>{t(language, "Start", "Inicio")}</span>
              <input type="date" value={editing.startDate ?? ""} onChange={(event) => setEditing({ ...editing, startDate: event.target.value || null })} />
            </label>
            <label>
              <span>{t(language, "End", "Fin")}</span>
              <input type="date" value={editing.endDate ?? ""} onChange={(event) => setEditing({ ...editing, endDate: event.target.value || null })} />
            </label>
            <label>
              <span>{t(language, "Status", "Estado")}</span>
              <select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as PlanItem["status"] })}>
                <option value="not_started">{t(language, "Not started", "Sin iniciar")}</option>
                <option value="in_progress">{t(language, "In progress", "En curso")}</option>
                <option value="blocked">{t(language, "Blocked", "Bloqueado")}</option>
                <option value="done">{t(language, "Done", "Completado")}</option>
              </select>
            </label>
          </div>
          <label className="editor-wide">
            <span>{t(language, "Dependencies", "Dependencias")}</span>
            <input value={displayedEditing!.dependsOn.join(", ")} placeholder={t(language, "Item titles separated by commas", "Títulos separados por comas")} onChange={(event) => { editTextField("dependsOn"); setEditing({ ...editing, dependsOn: event.target.value.split(",").map((part) => part.trim()).filter(Boolean) }); }} />
          </label>
          <label className="editor-wide">
            <span>{t(language, "Notes", "Notas")}</span>
            <textarea value={displayedEditing!.notes} onChange={(event) => { editTextField("notes"); setEditing({ ...editing, notes: event.target.value }); }} />
          </label>
          <div className="editor-actions">
            <button className="secondary-button" onClick={() => setEditing(null)}>{t(language, "Cancel", "Cancelar")}</button>
            <button className="primary-button" disabled={busy || !editing.title.trim()} onClick={() => void save()}>{t(language, "Save", "Guardar")}</button>
          </div>
        </div>
      )}
      <div className="filter-row">
        <select value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value)} aria-label={t(language, "Filter by phase", "Filtrar por fase")}>
          <option value="all">{t(language, "All phases", "Todas las fases")}</option>
          {phases.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label={t(language, "Filter by status", "Filtrar por estado")}>
          <option value="all">{t(language, "All statuses", "Todos los estados")}</option>
          <option value="not_started">{t(language, "Not started", "Sin iniciar")}</option>
          <option value="in_progress">{t(language, "In progress", "En curso")}</option>
          <option value="blocked">{t(language, "Blocked", "Bloqueado")}</option>
          <option value="done">{t(language, "Done", "Completado")}</option>
        </select>
        <div className="view-switch" role="group" aria-label={t(language, "Plan view", "Vista del plan")}>
          <button className={viewMode === "cards" ? "selected" : ""} onClick={() => setViewMode("cards")}>
            {t(language, "Cards", "Tarjetas")}
          </button>
          <button className={viewMode === "gantt" ? "selected" : ""} onClick={() => setViewMode("gantt")}>
            {t(language, "Gantt", "Cronograma")}
          </button>
        </div>
        {canEdit && (
          <div className="filter-actions">
            <button className="secondary-button" disabled={busy} onClick={() => setShowTemplates(true)}>
              ▤ {t(language, "Templates", "Plantillas")}
            </button>
            <button className="primary-button" disabled={busy} onClick={() => startEdit()}>
              ＋ {t(language, "New item", "Nuevo elemento")}
            </button>
          </div>
        )}
      </div>
      {viewMode === "gantt" ? (
        <PlanGantt language={language} items={visible} />
      ) : visible.length ? (
        <div className="project-card-grid">
          {visible.map((item) => (
            <article className={`project-card plan-card status-${item.status}`} key={item.id}>
              <header>
                <div>
                  <span className="overline">{item.phase || t(language, "No phase", "Sin fase")}</span>
                  <h3>{item.title}</h3>
                </div>
                <span className={`status-chip ${item.status.replaceAll("_", "-")}`}>
                  {planStatusLabel(item.status, language)}
                </span>
              </header>
              <div className="project-meta">
                <span>{item.owner || t(language, "Unassigned", "Sin asignar")}</span>
                <span>{item.startDate ? planDate(item.startDate).toLocaleDateString(language === "es" ? "es-CR" : "en-US") : "—"} → {item.endDate ? planDate(item.endDate).toLocaleDateString(language === "es" ? "es-CR" : "en-US") : "—"}</span>
              </div>
              {item.dependsOn.length > 0 && <p className="project-deps">↳ {item.dependsOn.map((id) => demoMode ? items.find((dependency) => dependency.id === id)?.title || id : id).join(" · ")}</p>}
              {item.notes && <p className="project-notes">{item.notes}</p>}
              {canEdit && (
                <div className="project-card-actions">
                  <button className="secondary-button" disabled={busy} onClick={() => startEdit(item)}>{t(language, "Edit", "Editar")}</button>
                  <button className="text-danger" disabled={busy} onClick={() => setConfirmDelete(item)}>{t(language, "Delete", "Eliminar")}</button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title={t(language, "No plan items", "No hay elementos del plan")} body={t(language, "Add the first phase or task to start planning.", "Agrega la primera fase o tarea para empezar a planificar.")} />
      )}
      {showTemplates && (
        <ModalOverlay className="confirm-modal template-modal" role="dialog" aria-modal="true" onMouseDown={() => setShowTemplates(false)} onEscape={() => setShowTemplates(false)} aria-label={t(language, "Plan templates", "Plantillas del plan")}>
          <div className="confirm-card template-card" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-mark">▤</span>
            <h3>{t(language, "Plan templates", "Plantillas del plan")}</h3>
            <p>{t(language, "Choose a starting point. You can edit every item after applying it.", "Elige un punto de partida. Puedes editar cada elemento después de aplicarlo.")}</p>
            <div className="template-list">
              {localizePlanTemplates(PLAN_TEMPLATES, language).map((template) => (
                <article className="template-option" key={template.id}>
                  <div>
                    <b>{template.name}</b>
                    <small>{template.description}</small>
                  </div>
                  <button className="primary-button" disabled={busy} onClick={() => {
                    setShowTemplates(false);
                    setTemplateStart({ template, date: new Date().toISOString().slice(0, 10) });
                  }}>
                    {t(language, "Use template", "Usar plantilla")}
                  </button>
                </article>
              ))}
            </div>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setShowTemplates(false)}>{t(language, "Close", "Cerrar")}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {templateStart && (
        <ModalOverlay className="confirm-modal" role="dialog" aria-modal="true" onMouseDown={() => setTemplateStart(null)} onEscape={() => setTemplateStart(null)} aria-label={t(language, "Project start date", "Fecha de inicio del proyecto")}>
          <div className="confirm-card" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-mark">▤</span>
            <h3>
              {templateStart.template.id === "costa-rica-construction"
                ? t(language, "Target construction start date", "Fecha objetivo para iniciar construcción")
                : t(language, "Project start date", "Fecha de inicio del proyecto")}
            </h3>
            <p>
              {templateStart.template.id === "costa-rica-construction"
                ? t(language, "Choose when construction should start and the schedule will adjust automatically.", "Indica cuándo quieres comenzar la obra y ajustaré el cronograma automáticamente.")
                : t(language, "Choose the project start date and the timeline will be adjusted automatically.", "Elige la fecha de inicio y el cronograma se ajustará automáticamente.")}
            </p>
            <label className="move-target-label">
              <span>
                {templateStart.template.id === "costa-rica-construction"
                  ? t(language, "Construction start", "Inicio de construcción")
                  : t(language, "Start date", "Fecha de inicio")}
              </span>
              <input type="date" value={templateStart.date} onChange={(event) => setTemplateStart({ ...templateStart, date: event.target.value })} />
            </label>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setTemplateStart(null)}>{t(language, "Cancel", "Cancelar")}</button>
              <button className="primary-button" disabled={!templateStart.date} onClick={() => {
                const selection = templateStart;
                setTemplateStart(null);
                void onApplyTemplate(selection.template.items, selection.date);
              }}>
                {t(language, "Apply template", "Aplicar plantilla")}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {confirmDelete && (
        <ModalOverlay className="confirm-modal" role="dialog" aria-modal="true" onMouseDown={() => setConfirmDelete(null)} onEscape={() => { if (!busy) setConfirmDelete(null); }} aria-label={t(language, "Delete plan item?", "¿Eliminar elemento del plan?")}>
          <div className="confirm-card danger" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-mark">!</span>
            <h3>{t(language, "Delete plan item?", "¿Eliminar elemento del plan?")}</h3>
            <p>{formatDemoItem ? formatDemoItem(confirmDelete).title : confirmDelete.title}</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setConfirmDelete(null)}>{t(language, "Cancel", "Cancelar")}</button>
              <button className="danger-button" disabled={busy} onClick={() => { const id = confirmDelete.id; setConfirmDelete(null); void onDelete(id); }}>{t(language, "Delete", "Eliminar")}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

function CaptureAttachmentList({ attachments, language }: { attachments: MobileCaptureAttachment[]; language: Language }) {
  const groups = [...new Map(attachments.map((attachment) => [attachment.captureId, [] as MobileCaptureAttachment[]])).entries()];
  for (const attachment of attachments) groups.find(([captureId]) => captureId === attachment.captureId)![1].push(attachment);
  if (!groups.length) return null;
  return <div className="field-capture-list">
    {groups.map(([captureId, items]) => <article key={captureId}>
      <header><span>⌁</span><b>{t(language, "Mobile field capture", "Captura móvil de obra")}</b></header>
      {items[0]?.note && <p>{items[0].note}</p>}
      <div>{items.map((attachment) => attachment.contentType.startsWith("image/")
        ? <a key={attachment.documentId} onClick={() => trackUsageInteraction("document.open")} href={`/api/files?id=${encodeURIComponent(attachment.documentId)}&preview=image`} target="_blank" rel="noreferrer"><Image unoptimized src={`/api/files?id=${encodeURIComponent(attachment.documentId)}&preview=thumb`} width={180} height={130} alt={attachment.fileName} /></a>
        : attachment.contentType.startsWith("audio/")
          ? <audio key={attachment.documentId} onPlay={() => trackUsageInteraction("document.open")} controls preload="metadata" src={`/api/files?id=${encodeURIComponent(attachment.documentId)}&preview=audio`} />
          : <a key={attachment.documentId} onClick={() => trackUsageInteraction("document.open")} href={`/api/files?id=${encodeURIComponent(attachment.documentId)}`}>{attachment.fileName}</a>)}</div>
    </article>)}
  </div>;
}

function Decisions({
  language,
  items,
  busy,
  canEdit,
  formatDemoItem,
  onSave,
  onDelete,
}: {
  language: Language;
  items: DecisionRecord[];
  busy: boolean;
  canEdit: boolean;
  formatDemoItem?: <T extends object>(item: T, editedFields?: string[]) => T;
  onSave: (item: Omit<DecisionRecord, "id"> & { id?: string }, editedFields?: string[]) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const emptyDraft: Omit<DecisionRecord, "id"> = {
    area: "",
    title: "",
    options: "",
    selected: "",
    dueDate: null,
    status: "open",
    owner: "",
    captureAttachments: [],
  };
  const [editing, setEditing] = useState<DecisionRecord | Omit<DecisionRecord, "id"> | null>(null);
  const [editedTextFields, setEditedTextFields] = useState<string[]>([]);
  const editTextField = (field: string) => setEditedTextFields(current => current.includes(field) ? current : [...current, field]);
  const displayedEditing = editing && formatDemoItem ? formatDemoItem(editing, editedTextFields) : editing;
  const [confirmDelete, setConfirmDelete] = useState<DecisionRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const visible = items.filter((item) => statusFilter === "all" || item.status === statusFilter);
  const save = async () => {
    if (!editing || !editing.title.trim()) return;
    if (await onSave(displayedEditing || editing, editedTextFields)) setEditing(null);
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="overline">{t(language, "DECISIONS & SELECTIONS", "DECISIONES Y SELECCIONES")}</span>
          <h2>{t(language, "Project decisions", "Decisiones del proyecto")}</h2>
          <p>{t(language, "Record options, deadlines and the final selection.", "Registra opciones, fechas límite y la selección final.")}</p>
        </div>
      </div>
      {editing && (
        <div className="editor-panel">
          <div className="editor-head">
            <h3>{t(language, "Decision", "Decisión")}</h3>
            <button className="icon-button" onClick={() => setEditing(null)} aria-label={t(language, "Close editor", "Cerrar editor")}>×</button>
          </div>
          <div className="editor-grid">
            <label>
              <span>{t(language, "Title", "Título")}</span>
              <input value={displayedEditing!.title} maxLength={500} onChange={(event) => { editTextField("title"); setEditing({ ...editing, title: event.target.value }); }} />
            </label>
            <label>
              <span>{t(language, "Area", "Área")}</span>
              <input value={displayedEditing!.area} maxLength={120} onChange={(event) => { editTextField("area"); setEditing({ ...editing, area: event.target.value }); }} />
            </label>
            <label>
              <span>{t(language, "Owner", "Responsable")}</span>
              <input value={displayedEditing!.owner} maxLength={160} onChange={(event) => { editTextField("owner"); setEditing({ ...editing, owner: event.target.value }); }} />
            </label>
            <label>
              <span>{t(language, "Due date", "Fecha límite")}</span>
              <input type="date" value={editing.dueDate ?? ""} onChange={(event) => setEditing({ ...editing, dueDate: event.target.value || null })} />
            </label>
            <label>
              <span>{t(language, "Status", "Estado")}</span>
              <select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as DecisionRecord["status"] })}>
                <option value="open">{t(language, "Open", "Abierta")}</option>
                <option value="decided">{t(language, "Decided", "Decidida")}</option>
                <option value="deferred">{t(language, "Deferred", "Aplazada")}</option>
              </select>
            </label>
          </div>
          <label className="editor-wide">
            <span>{t(language, "Options", "Opciones")}</span>
            <input value={displayedEditing!.options} maxLength={500} onChange={(event) => { editTextField("options"); setEditing({ ...editing, options: event.target.value }); }} />
          </label>
          <label className="editor-wide">
            <span>{t(language, "Selected option", "Opción seleccionada")}</span>
            <input value={displayedEditing!.selected} maxLength={300} onChange={(event) => { editTextField("selected"); setEditing({ ...editing, selected: event.target.value }); }} />
          </label>
          <div className="editor-actions">
            <button className="secondary-button" onClick={() => setEditing(null)}>{t(language, "Cancel", "Cancelar")}</button>
            <button className="primary-button" disabled={busy || !editing.title.trim()} onClick={() => void save()}>{t(language, "Save", "Guardar")}</button>
          </div>
        </div>
      )}
      <div className="filter-row">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label={t(language, "Filter by status", "Filtrar por estado")}>
          <option value="all">{t(language, "All statuses", "Todos los estados")}</option>
          <option value="open">{t(language, "Open", "Abiertas")}</option>
          <option value="decided">{t(language, "Decided", "Decididas")}</option>
          <option value="deferred">{t(language, "Deferred", "Aplazadas")}</option>
        </select>
        {canEdit && (
          <div className="filter-actions">
            <button className="primary-button" disabled={busy} onClick={() => { setEditedTextFields([]); setEditing({ ...emptyDraft }); }}>
              ＋ {t(language, "New decision", "Nueva decisión")}
            </button>
          </div>
        )}
      </div>
      {visible.length ? (
        <div className="project-card-grid">
          {visible.map((item) => (
            <article className={`project-card decision-card status-${item.status}`} key={item.id}>
              <header>
                <div>
                  <span className="overline">{item.area || t(language, "General", "General")}</span>
                  <h3>{item.title}</h3>
                </div>
                <span className="status-chip">{workspaceEnumLabel(item.status, language)}</span>
              </header>
              <p className="project-options"><b>{t(language, "Options", "Opciones")}:</b> {item.options || "—"}</p>
              <p className="project-selected"><b>{t(language, "Selected", "Seleccionada")}:</b> {item.selected || t(language, "Not selected yet", "Aún sin seleccionar")}</p>
              <CaptureAttachmentList attachments={item.captureAttachments || []} language={language} />
              <div className="project-meta">
                <span>{item.owner || t(language, "Unassigned", "Sin asignar")}</span>
                <span>{item.dueDate ? new Date(item.dueDate).toLocaleDateString(language === "es" ? "es-CR" : "en-US") : "—"}</span>
              </div>
              {canEdit && (
                <div className="project-card-actions">
                  <button className="secondary-button" disabled={busy} onClick={() => { setEditedTextFields([]); setEditing({ ...item }); }}>{t(language, "Edit", "Editar")}</button>
                  <button className="text-danger" disabled={busy} onClick={() => setConfirmDelete(item)}>{t(language, "Delete", "Eliminar")}</button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title={t(language, "No decisions", "No hay decisiones")} body={t(language, "Add a selection or decision that needs tracking.", "Agrega una selección o decisión que necesite seguimiento.")} />
      )}
      {confirmDelete && (
        <ModalOverlay className="confirm-modal" role="dialog" aria-modal="true" onMouseDown={() => setConfirmDelete(null)} onEscape={() => { if (!busy) setConfirmDelete(null); }} aria-label={t(language, "Delete decision?", "¿Eliminar decisión?")}>
          <div className="confirm-card danger" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-mark">!</span>
            <h3>{t(language, "Delete decision?", "¿Eliminar decisión?")}</h3>
            <p>{formatDemoItem ? formatDemoItem(confirmDelete).title : confirmDelete.title}</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setConfirmDelete(null)}>{t(language, "Cancel", "Cancelar")}</button>
              <button className="danger-button" disabled={busy} onClick={() => { const id = confirmDelete.id; setConfirmDelete(null); void onDelete(id); }}>{t(language, "Delete", "Eliminar")}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

function SiteIssues({
  mode,
  language,
  items,
  busy,
  canEdit,
  formatDemoItem,
  onSave,
  onDelete,
}: {
  mode: WorkspaceMode;
  language: Language;
  items: SiteIssue[];
  busy: boolean;
  canEdit: boolean;
  formatDemoItem?: <T extends object>(item: T, editedFields?: string[]) => T;
  onSave: (item: Omit<SiteIssue, "id"> & { id?: string }, editedFields?: string[]) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const emptyDraft: Omit<SiteIssue, "id"> = {
    title: "",
    category: "observation",
    priority: "medium",
    status: "open",
    assignee: "",
    dueDate: null,
    notes: "",
    photos: [],
    captureAttachments: [],
  };
  const [editing, setEditing] = useState<SiteIssue | Omit<SiteIssue, "id"> | null>(null);
  const [editedTextFields, setEditedTextFields] = useState<string[]>([]);
  const editTextField = (field: string) => setEditedTextFields(current => current.includes(field) ? current : [...current, field]);
  const displayedEditing = editing && formatDemoItem ? formatDemoItem(editing, editedTextFields) : editing;
  const [confirmDelete, setConfirmDelete] = useState<SiteIssue | null>(null);
  const [reportIssue, setReportIssue] = useState<SiteIssue | null>(null);
  const displayedReportIssue = reportIssue && formatDemoItem ? formatDemoItem(reportIssue) : reportIssue;
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoProgress, setPhotoProgress] = useState<UploadProgressState | null>(null);
  const [photoError, setPhotoError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const visible = items.filter((item) => categoryFilter === "all" || item.category === categoryFilter);
  const save = async () => {
    if (!editing || !editing.title.trim() || photoBusy) return;
    if (await onSave(displayedEditing || editing, editedTextFields)) setEditing(null);
  };
  const photoUrl = (key: string) =>
    mode === "demo" ? key : `/api/site-issues/photo?key=${encodeURIComponent(key)}`;
  const uploadPhotos = async (files: File[]) => {
    const images = files.filter(file => file.type.startsWith("image/"));
    if (!editing || !images.length || photoBusy) return;
    setPhotoBusy(true);
    setPhotoError("");
    const nextPhotos = [...editing.photos];
    try {
      const batch = mode === "real" ? createUploadBatch(images, setPhotoProgress) : null;
      for (const [index, file] of images.entries()) {
        if (mode === "demo") {
          nextPhotos.push(URL.createObjectURL(file));
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        const response = await uploadFormData("/api/site-issues/photo", form, { onProgress: batch!.track(index) });
        if (!response.ok) throw new Error(t(language, "A photo could not be uploaded. Photos already uploaded are kept in this entry.", "No se pudo subir una foto. Las fotos ya subidas se conservan en este registro."));
        const data = (await response.json()) as { key: string };
        nextPhotos.push(data.key);
        batch!.complete(index);
      }
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : t(language, "The photos could not be uploaded", "No se pudieron subir las fotos"));
    } finally {
      setEditing(current => current ? { ...current, photos: nextPhotos } : current);
      setPhotoProgress(null);
      setPhotoBusy(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="overline">{t(language, "SITE PROGRESS & INSPECTIONS", "PROGRESO E INSPECCIONES")}</span>
          <h2>{t(language, "Site progress", "Progreso de obra")}</h2>
          <p>{t(language, "Track observations, punch-list items and inspections.", "Controla observaciones, pendientes de obra e inspecciones.")}</p>
        </div>
      </div>
      {editing && (
        <div className="editor-panel">
          <div className="editor-head">
            <h3>{t(language, "Progress entry", "Registro de avance")}</h3>
            <button className="icon-button" disabled={photoBusy} onClick={() => setEditing(null)} aria-label={t(language, "Close editor", "Cerrar editor")}>×</button>
          </div>
          <div className="editor-grid">
            <label className="editor-wide">
              <span>{t(language, "Title", "Título")}</span>
              <input value={displayedEditing!.title} maxLength={500} onChange={(event) => { editTextField("title"); setEditing({ ...editing, title: event.target.value }); }} />
            </label>
            <label>
              <span>{t(language, "Category", "Categoría")}</span>
              <select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value as SiteIssue["category"] })}>
                <option value="observation">{t(language, "Observation", "Observación")}</option>
                <option value="punch">{t(language, "Punch list", "Pendiente")}</option>
                <option value="inspection">{t(language, "Inspection", "Inspección")}</option>
                <option value="permit">{t(language, "Permit", "Permiso")}</option>
              </select>
            </label>
            <label>
              <span>{t(language, "Priority", "Prioridad")}</span>
              <select value={editing.priority} onChange={(event) => setEditing({ ...editing, priority: event.target.value as SiteIssue["priority"] })}>
                <option value="low">{t(language, "Low", "Baja")}</option>
                <option value="medium">{t(language, "Medium", "Media")}</option>
                <option value="high">{t(language, "High", "Alta")}</option>
                <option value="critical">{t(language, "Critical", "Crítica")}</option>
              </select>
            </label>
            <label>
              <span>{t(language, "Status", "Estado")}</span>
              <select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as SiteIssue["status"] })}>
                <option value="open">{t(language, "Open", "Abierta")}</option>
                <option value="in_progress">{t(language, "In progress", "En curso")}</option>
                <option value="resolved">{t(language, "Resolved", "Resuelta")}</option>
              </select>
            </label>
            <label>
              <span>{t(language, "Assignee", "Responsable")}</span>
              <input value={displayedEditing!.assignee} maxLength={160} onChange={(event) => { editTextField("assignee"); setEditing({ ...editing, assignee: event.target.value }); }} />
            </label>
            <label>
              <span>{t(language, "Due date", "Fecha límite")}</span>
              <input type="date" value={editing.dueDate ?? ""} onChange={(event) => setEditing({ ...editing, dueDate: event.target.value || null })} />
            </label>
          </div>
          <label className="editor-wide">
            <span>{t(language, "Notes", "Notas")}</span>
            <textarea value={displayedEditing!.notes} onChange={(event) => { editTextField("notes"); setEditing({ ...editing, notes: event.target.value }); }} />
          </label>
          <div className="editor-wide photo-field">
            <UploadProgress progress={photoProgress} language={language} />
            {photoError && <p role="alert">{photoError}</p>}
            <div className="photo-field-head">
              <span>{t(language, "Report photos", "Fotos del reporte")}</span>
              <button className="secondary-button" disabled={photoBusy} onClick={() => photoInput.current?.click()}>
                {photoBusy ? t(language, "Uploading…", "Subiendo…") : t(language, "Add photos", "Agregar fotos")}
              </button>
              <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(event) => void uploadPhotos(Array.from(event.target.files ?? []))} />
            </div>
            {editing.photos.length > 0 ? (
              <div className="photo-strip">
                {editing.photos.map((key) => (
                  <span className="photo-thumb" key={key}>
                    <Image src={photoUrl(key)} alt="" width={320} height={240} unoptimized />
                    <button disabled={photoBusy} onClick={() => setEditing({ ...editing, photos: editing.photos.filter((photo) => photo !== key) })} aria-label={t(language, "Remove photo", "Quitar foto")}>×</button>
                  </span>
                ))}
              </div>
            ) : (
              <small>{t(language, "No photos attached yet.", "Aún no hay fotos adjuntas.")}</small>
            )}
          </div>
          <div className="editor-actions">
            <button className="secondary-button" disabled={photoBusy} onClick={() => setEditing(null)}>{t(language, "Cancel", "Cancelar")}</button>
            <button className="primary-button" disabled={busy || photoBusy || !editing.title.trim()} onClick={() => void save()}>{t(language, "Save", "Guardar")}</button>
          </div>
        </div>
      )}
      <div className="filter-row">
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label={t(language, "Filter by category", "Filtrar por categoría")}>
          <option value="all">{t(language, "All categories", "Todas las categorías")}</option>
          <option value="observation">{t(language, "Observations", "Observaciones")}</option>
          <option value="punch">{t(language, "Punch list", "Pendientes")}</option>
          <option value="inspection">{t(language, "Inspections", "Inspecciones")}</option>
          <option value="permit">{t(language, "Permits", "Permisos")}</option>
        </select>
        {canEdit && (
          <div className="filter-actions">
            <button className="primary-button" disabled={busy || photoBusy} onClick={() => { setPhotoError(""); setEditing({ ...emptyDraft }); }}>
              ＋ {t(language, "New report", "Nuevo reporte")}
            </button>
          </div>
        )}
      </div>
      {visible.length ? (
        <div className="project-card-grid">
          {visible.map((item) => (
            <article className={`project-card issue-card priority-${item.priority}`} key={item.id}>
              <header>
                <div>
                  <span className="overline">{workspaceEnumLabel(item.category, language)}</span>
                  <h3>{item.title}</h3>
                </div>
                <span className={`status-chip ${item.status.replaceAll("_", "-")}`}>{workspaceEnumLabel(item.status, language)}</span>
              </header>
              <div className="project-meta">
                <span>{workspaceEnumLabel(item.priority, language)}</span>
                <span>{item.assignee || t(language, "Unassigned", "Sin asignar")}</span>
                <span>{item.dueDate ? new Date(item.dueDate).toLocaleDateString(language === "es" ? "es-CR" : "en-US") : "—"}</span>
              </div>
              {item.notes && <p className="project-notes">{item.notes}</p>}
              <CaptureAttachmentList attachments={item.captureAttachments || []} language={language} />
              {item.photos.length > 0 && (
                <p className="project-photos">📷 {item.photos.length} {t(language, "photo(s)", "foto(s)")}</p>
              )}
              <div className="project-card-actions">
                <button className="secondary-button" disabled={busy} onClick={() => setReportIssue(item)}>
                  {t(language, "Report", "Reporte")}
                </button>
                {canEdit && (
                  <>
                  <button className="secondary-button" disabled={busy || photoBusy} onClick={() => { setPhotoError(""); setEditing({ ...item }); }}>{t(language, "Edit", "Editar")}</button>
                  <button className="text-danger" disabled={busy || photoBusy} onClick={() => setConfirmDelete(item)}>{t(language, "Delete", "Eliminar")}</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title={t(language, "No progress entries", "No hay registros de avance")} body={t(language, "Add an observation, punch item, inspection, or completed milestone.", "Agrega una observación, pendiente, inspección o hito completado.")} />
      )}
      {confirmDelete && (
        <ModalOverlay className="confirm-modal" role="dialog" aria-modal="true" onMouseDown={() => setConfirmDelete(null)} onEscape={() => { if (!busy) setConfirmDelete(null); }} aria-label={t(language, "Delete progress entry?", "¿Eliminar registro de avance?")}>
          <div className="confirm-card danger" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-mark">!</span>
            <h3>{t(language, "Delete progress entry?", "¿Eliminar registro de avance?")}</h3>
            <p>{formatDemoItem ? formatDemoItem(confirmDelete).title : confirmDelete.title}</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setConfirmDelete(null)}>{t(language, "Cancel", "Cancelar")}</button>
              <button className="danger-button" disabled={busy} onClick={() => { const id = confirmDelete.id; setConfirmDelete(null); void onDelete(id); }}>{t(language, "Delete", "Eliminar")}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {displayedReportIssue && (
        <ModalOverlay className="report-modal" role="dialog" aria-modal="true" onMouseDown={() => setReportIssue(null)} onEscape={() => setReportIssue(null)} aria-label={displayedReportIssue.title}>
          <div className="report-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="report-head">
              <div>
                <span className="overline">{workspaceEnumLabel(displayedReportIssue.category, language)}</span>
                <h2>{displayedReportIssue.title}</h2>
              </div>
              <button className="icon-button" onClick={() => setReportIssue(null)} aria-label={t(language, "Close report", "Cerrar reporte")}>×</button>
            </div>
            <div className="report-meta">
              <span><b>{t(language, "Priority", "Prioridad")}:</b> {workspaceEnumLabel(displayedReportIssue.priority, language)}</span>
              <span><b>{t(language, "Status", "Estado")}:</b> {workspaceEnumLabel(displayedReportIssue.status, language)}</span>
              <span><b>{t(language, "Assignee", "Responsable")}:</b> {displayedReportIssue.assignee || t(language, "Unassigned", "Sin asignar")}</span>
              <span><b>{t(language, "Due", "Vence")}:</b> {displayedReportIssue.dueDate || "—"}</span>
            </div>
            <p className="report-notes">{displayedReportIssue.notes || t(language, "No notes.", "Sin notas.")}</p>
            <CaptureAttachmentList attachments={displayedReportIssue.captureAttachments || []} language={language} />
            {displayedReportIssue.photos.length > 0 ? (
              <div className="report-photos">
                {displayedReportIssue.photos.map((key) => (
                  <Image src={photoUrl(key)} alt="" width={1200} height={900} unoptimized key={key} />
                ))}
              </div>
            ) : (
              <p className="report-empty">{t(language, "No photos were attached to this report.", "Este reporte no tiene fotos adjuntas.")}</p>
            )}
            <div className="report-actions">
              <button className="secondary-button" onClick={() => setReportIssue(null)}>{t(language, "Close", "Cerrar")}</button>
              <button className="primary-button" onClick={() => window.print()}>{t(language, "Print / Save PDF", "Imprimir / Guardar PDF")}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

function Approvals({
  currency = "CRC",
  language,
  demoMode = false,
  approvals,
  isAdmin,
  busy,
  resolve,
}: {
  language: Language;
  currency?: ProjectCurrency;
  demoMode?: boolean;
  approvals: ApprovalRecord[];
  isAdmin: boolean;
  busy: boolean;
  resolve: (id: string, action: "approved" | "rejected") => void;
}) {
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="overline">
            {t(
              language,
              "AUDITABLE CHANGE CONTROL",
              "CONTROL DE CAMBIOS AUDITABLE",
            )}
          </span>
          <h2>
            {t(language, "Approval history", "Historial de aprobaciones")}
          </h2>
          <p>
            {isAdmin
              ? t(
                  language,
                  "You can approve or reject pending changes.",
                  "Puedes aprobar o rechazar cambios pendientes.",
                )
              : t(
                  language,
                  "Your proposed changes remain pending until the administrator reviews them.",
                  "Tus cambios propuestos quedan pendientes hasta que el administrador los revise.",
                )}
          </p>
        </div>
        <span className="admin-lock">
          ●{" "}
          {isAdmin
            ? t(language, "Administrator", "Administrador")
            : t(language, "Editor", "Editor")}
        </span>
      </div>
      {approvals.length ? (
        <section className="card approval-table">
          {approvals.map((item) => {
            const details = approvalDetails(item);
            const edited = details.filter((change) => !change.calculated);
            const calculated = details.filter((change) => change.calculated);
            const changes = approvalChanges(item);
            const confirmResolution = (action: "approved" | "rejected") => {
              const confirmed = window.confirm(t(
                language,
                `${action === "approved" ? "Approve" : "Reject"} “${item.title}”? This decision will be recorded in the audit history.`,
                `¿${action === "approved" ? "Aprobar" : "Rechazar"} “${item.title}”? Esta decisión quedará registrada en el historial.`,
              ));
              if (confirmed) resolve(item.id, action);
            };
            return (
              <article className="approval-record" key={item.id}>
                <div className="approval-record-head">
                  <div>
                  <span className={`status-chip ${item.status}`}>
                    {statusLabel(item.status, language)}
                  </span>
                  <h3>{item.title || t(language, "Workbook change", "Cambio del presupuesto")}</h3>
                  <p>
                    {item.requested_by} ·{" "}
                    {new Date(item.created_at).toLocaleString(
                      language === "es" ? "es-CR" : "en-US",
                    )}
                  </p>
                  </div>
                  <div className="approval-counts" aria-label={t(language, "Change summary", "Resumen de cambios")}>
                    <span><b>{edited.length || changes}</b>{t(language, "proposed", "propuestos")}</span>
                    {calculated.length > 0 && <span><b>{calculated.length}</b>{t(language, "recalculated", "recalculados")}</span>}
                  </div>
                </div>
                <details className="approval-review" open={item.status === "pending"}>
                  <summary>
                    <span>{t(language, "Review proposed changes", "Revisar cambios propuestos")}</span>
                    <small>{t(language, `${changes} affected cells`, `${changes} celdas afectadas`)}</small>
                  </summary>
                  <div className="approval-review-body">
                    {edited.length ? (
                      <ApprovalChangeList language={language} currency={currency} demoMode={demoMode} changes={edited} />
                    ) : (
                      <p className="approval-details-warning">
                        {t(language, "Detailed changes are unavailable for this older record.", "El detalle no está disponible para este registro anterior.")}
                      </p>
                    )}
                    {calculated.length > 0 && (
                      <details className="calculated-changes">
                        <summary>{t(language, `Show ${calculated.length} automatically recalculated cells`, `Mostrar ${calculated.length} celdas recalculadas automáticamente`)}</summary>
                        <ApprovalChangeList language={language} currency={currency} demoMode={demoMode} changes={calculated} />
                      </details>
                    )}
                    {item.details_complete === false && (
                      <p className="approval-details-warning">
                        {t(language, "Only the stored preview is available; do not approve until the complete detail can be loaded.", "Solo está disponible la vista parcial guardada; no apruebes hasta poder cargar el detalle completo.")}
                      </p>
                    )}
                    {item.status === "pending" && isAdmin && (
                      <div className="approval-actions approval-decision-actions">
                        <button disabled={busy} onClick={() => confirmResolution("rejected")}>{t(language, "Reject", "Rechazar")}</button>
                        <button disabled={busy || item.details_complete === false} onClick={() => confirmResolution("approved")}>✓ {t(language, "Approve", "Aprobar")}</button>
                      </div>
                    )}
                  </div>
                </details>
              </article>
            );
          })}
        </section>
      ) : (
        <EmptyState
          title={t(
            language,
            "No approval records yet",
            "Todavía no hay aprobaciones",
          )}
          body={t(
            language,
            "Workbook edits will appear here automatically.",
            "Las ediciones del presupuesto aparecerán aquí automáticamente.",
          )}
        />
      )}
    </>
  );
}

function ApprovalChangeList({ language, changes, demoMode = false, currency = "CRC" }: { language: Language; changes: ApprovalChangeDetail[]; demoMode?: boolean; currency?: ProjectCurrency }) {
  const grouped = changes.reduce<Record<string, ApprovalChangeDetail[]>>((result, change) => {
    (result[change.sheet] ||= []).push(change);
    return result;
  }, {});
  return (
    <div className="approval-sheet-groups">
      {Object.entries(grouped).map(([sheet, sheetChanges]) => {
        const displayedSheet = demoMode ? sheet === "Presupuesto" ? t(language, "Budget", "Presupuesto") : sheet === "Resumen" ? t(language, "Summary", "Resumen") : sheet : sheet;
        const generalLabor = sheetChanges.filter((change) => change.groupLabel === "Mano de obra general");
        const otherChanges = sheetChanges.filter((change) => change.groupLabel !== "Mano de obra general");
        const laborRows = new Set(generalLabor.map((change) => change.row)).size;
        const laborTotals = (column: number, side: "before" | "after") => generalLabor
          .filter((change) => change.column === column)
          .reduce((sum, change) => {
            const value = change[side]?.value;
            return sum + (typeof value === "number" ? value : 0);
          }, 0);
        return (
          <section className="approval-sheet" key={sheet}>
            <div className="approval-sheet-title"><b>{displayedSheet}</b><span>{sheetChanges.length}</span></div>
            {generalLabor.length > 0 && (
              <div className="approval-labor-group">
                <div className="approval-labor-heading">
                  <div>
                    <small>{t(language, "ONE COST CATEGORY", "UNA SOLA CATEGORÍA DE COSTO")}</small>
                    <b>{t(language, "General labor", "Mano de obra general")}</b>
                    <span>{t(language, `${laborRows} line items from the same crew`, `${laborRows} partidas de la misma cuadrilla`)}</span>
                  </div>
                  <span className="approval-labor-badge">{t(language, "Electrical excluded", "Electricidad excluida")}</span>
                </div>
                <div className="approval-labor-totals">
                  <span><small>{t(language, "Objective", "Objetivo")}</small><b>{formatBudgetAmount(laborTotals(5, "before"), language, demoMode ? "USD" : currency)} → {formatBudgetAmount(laborTotals(5, "after"), language, demoMode ? "USD" : currency)}</b></span>
                  <span><small>{t(language, "Excess over objective", "Exceso sobre objetivo")}</small><b>{formatBudgetAmount(laborTotals(6, "before"), language, demoMode ? "USD" : currency)} → {formatBudgetAmount(laborTotals(6, "after"), language, demoMode ? "USD" : currency)}</b></span>
                </div>
                <details className="approval-labor-lines">
                  <summary>{t(language, `Review the ${laborRows} included line items`, `Revisar las ${laborRows} partidas incluidas`)}</summary>
                  <ApprovalDiffTable language={language} sheet={displayedSheet} changes={generalLabor} demoMode={demoMode} />
                </details>
              </div>
            )}
            {otherChanges.length > 0 && <ApprovalDiffTable language={language} sheet={displayedSheet} changes={otherChanges} demoMode={demoMode} />}
          </section>
        );
      })}
    </div>
  );
}

function ApprovalDiffTable({ language, sheet, changes }: { language: Language; sheet: string; changes: ApprovalChangeDetail[]; demoMode?: boolean }) {
  return (
    <div className="approval-diff-table" role="table" tabIndex={0} aria-label={t(language, `${sheet} changes`, `Cambios en ${sheet}`)}>
      <div className="approval-diff-header" role="row">
        <span role="columnheader">{t(language, "Row / item", "Fila / partida")}</span>
        <span role="columnheader">{t(language, "Field", "Campo")}</span>
        <span role="columnheader">{t(language, "Before", "Antes")}</span>
        <span role="columnheader">{t(language, "After", "Después")}</span>
      </div>
      {changes.map((change, index) => (
        <div className="approval-diff-row" role="row" key={`${change.row}-${change.column}-${index}`}>
          <span role="cell"><b>{change.rowLabel}</b><small>{t(language, `Row ${change.row}`, `Fila ${change.row}`)}</small></span>
          <span role="cell">{approvalColumnLabel(change, language)}</span>
          <span className="approval-before" role="cell">{formatApprovalCell(change.before, language)}</span>
          <span className="approval-after" role="cell">{formatApprovalCell(change.after, language)}</span>
        </div>
      ))}
    </div>
  );
}

function Access({
  language, user, users, folders, invitations, inviteLink, busy, resolve,
  onPermissionsChange, onFolderAccessChange, onInvite, onRevokeInvitation,
  onDeleteMember, onRefreshUsers, onSignOut,
}: {
  language: Language;
  user: User;
  users: AccessRecord[];
  folders: FolderRecord[];
  invitations: InvitationRecord[];
  inviteLink: string;
  busy: boolean;
  resolve: (uid: string, action: "approve" | "reject" | "revoke", role?: "editor" | "viewer") => void;
  onPermissionsChange: (uid: string, permissions: MemberPermissions) => void;
  onFolderAccessChange: (uid: string, folderAccess: FolderAccess) => void;
  onInvite: (email: string, role: "editor" | "viewer", permissions: MemberPermissions, folderAccess: FolderAccess) => Promise<boolean>;
  onRevokeInvitation: (id: string) => void;
  onDeleteMember: (uid: string) => Promise<boolean>;
  onRefreshUsers: () => Promise<unknown>;
  onSignOut: () => void;
}) {
  const [view, setView] = useState<"users" | "invitations" | "links">("users");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "pending" | "no-access">("all");
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [roleChoices, setRoleChoices] = useState<Record<string, "editor" | "viewer">>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [invitePermissions, setInvitePermissions] = useState<MemberPermissions>({ ...DEFAULT_PERMISSIONS });
  const [inviteFolderAccess, setInviteFolderAccess] = useState<FolderAccess>({ ...DEFAULT_FOLDER_ACCESS });
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const inviteLinkInput = useRef<HTMLInputElement | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<AccessRecord | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const stateOf = (member: AccessRecord) => member.accessState ?? memberAccessState(member);
  const stateLabel = (state: MemberAccessState) => state === "active"
    ? t(language, "Active", "Activo")
    : state === "pending" ? t(language, "Pending approval", "Pendiente de aprobación")
      : state === "rejected" ? t(language, "Rejected", "Rechazado") : t(language, "Access revoked", "Acceso revocado");
  const roleLabel = (role: AccessRecord["role"]) => role === "admin"
    ? t(language, "Administrator", "Administrador") : role === "editor" ? t(language, "Editor", "Editor") : t(language, "Viewer", "Lector");
  const activeCount = users.filter((member) => stateOf(member) === "active").length;
  const pendingCount = users.filter((member) => stateOf(member) === "pending").length;
  const noAccessCount = users.length - activeCount - pendingCount;
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleUsers = users.filter((member) => {
    const state = stateOf(member);
    return (!normalizedSearch || `${member.name} ${member.email}`.toLocaleLowerCase().includes(normalizedSearch))
      && (filter === "all" || filter === state || (filter === "no-access" && (state === "revoked" || state === "rejected")));
  });
  const activeMemberFor = (invitation: InvitationRecord) => users.find((member) => stateOf(member) === "active" && member.email.trim().toLowerCase() === invitation.email.trim().toLowerCase());
  const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending" && !activeMemberFor(invitation));
  const pastInvitations = invitations.filter((invitation) => invitation.status !== "pending" || activeMemberFor(invitation));
  const validInviteEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());

  const cancelDelete = () => {
    if (busy) return;
    setMemberToDelete(null);
    setDeleteError(false);
    deleteTrigger.current?.focus();
  };
  const confirmDelete = async () => {
    if (!memberToDelete || busy) return;
    setDeleteError(false);
    if (await onDeleteMember(memberToDelete.uid)) {
      setMemberToDelete(null);
      setExpandedUid(null);
    } else setDeleteError(true);
  };
  const create = async () => {
    if (!validInviteEmail || busy) return;
    if (await onInvite(inviteEmail.trim(), inviteRole, invitePermissions, inviteFolderAccess)) {
      setInviteEmail(""); setCopied(false); setCopyFailed(false);
    }
  };
  const copyLink = async () => {
    setCopyFailed(false);
    let success = false;
    try { await navigator.clipboard.writeText(inviteLink); success = true; }
    catch {
      inviteLinkInput.current?.focus();
      inviteLinkInput.current?.select();
      try { success = document.execCommand("copy"); } catch { /* Keep the selected link available for manual copying. */ }
    }
    setCopied(success);
    setCopyFailed(!success);
    if (success) window.setTimeout(() => setCopied(false), 2500);
  };
  const goToMember = (member: AccessRecord) => {
    setView("users"); setSearch(""); setFilter("all"); setExpandedUid(member.uid);
  };
  const invitationRow = (invitation: InvitationRecord) => {
    const activeMember = activeMemberFor(invitation);
    const accessGranted = activeMember && invitation.status === "pending";
    return (
      <article className="invite-row access-invitation-row" key={invitation.id}>
        <div>
          <b>{invitation.email}</b>
          <small>{roleLabel(invitation.role)}{invitation.expiresAt && ` · ${t(language, "expires", "caduca")} ${new Date(invitation.expiresAt).toLocaleDateString(language === "es" ? "es-CR" : "en-US")}`}</small>
          <p className="access-row-summary">{PERMISSION_TABS.filter((tab) => invitation.permissions[tab]).length} {t(language, "sections", "secciones")} · {folderAccessLabel(invitation.folderAccess, folders, language)}</p>
          {activeMember && <p className="access-invitation-note">{t(language, "This person already has access. Revoking the invitation only cancels its link.", "Esta persona ya tiene acceso. Revocar la invitación solo cancela su enlace.")}</p>}
        </div>
        <div className="access-invitation-actions">
          <span className={`status-chip ${accessGranted ? "approved" : invitation.status}`}>{accessGranted ? t(language, "Access granted", "Acceso concedido") : invitation.status === "accepted" ? t(language, "Accepted", "Aceptada") : invitation.status === "revoked" ? t(language, "Revoked", "Revocada") : invitation.status === "expired" ? t(language, "Expired", "Caducada") : t(language, "Awaiting acceptance", "Espera aceptación")}</span>
          {activeMember && <button className="secondary-button" onClick={() => goToMember(activeMember)}>{t(language, "Manage user", "Gestionar usuario")}</button>}
          {invitation.status === "pending" && <button className="text-danger" disabled={busy} onClick={() => onRevokeInvitation(invitation.id)}>{t(language, "Revoke invitation", "Revocar invitación")}</button>}
        </div>
      </article>
    );
  };

  return (
    <>
      <div className="page-intro">
        <div>
          <span className="overline">{t(language, "PROJECT ACCESS", "ACCESO AL PROYECTO")}</span>
          <h2>{t(language, "Users and access", "Usuarios y acceso")}</h2>
          <p>{user.role === "admin" ? t(language, "Manage who can enter the project and what each person can see.", "Gestiona quién puede entrar al proyecto y qué puede ver cada persona.") : t(language, "Your account and project access.", "Tu cuenta y acceso al proyecto.")}</p>
        </div>
        <button className="secondary-button" onClick={onSignOut}>{t(language, "Sign out", "Cerrar sesión")}</button>
      </div>
      <section className="card access-card access-management">
        {user.role !== "admin" ? <>
          <div className="access-note"><b>{t(language, "Access is private and approval-based", "El acceso es privado y requiere aprobación")}</b><span>{t(language, "Only approved accounts can open the real workbook and files.", "Solo las cuentas aprobadas pueden abrir el presupuesto y los archivos reales.")}</span></div>
          <div className="current-user"><span className="avatar">{user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><b>{user.name}</b><small>{user.email}</small></div><span className="type-chip">{roleLabel(user.role)}</span></div>
        </> : <>
          <nav className="access-view-nav" aria-label={t(language, "Access management views", "Vistas de gestión de acceso")}>
            <button aria-pressed={view === "users"} onClick={() => setView("users")}>{t(language, "Users", "Usuarios")} <span>{users.length}</span></button>
            <button aria-pressed={view === "invitations"} onClick={() => setView("invitations")}>{t(language, "Invitations", "Invitaciones")} <span>{pendingInvitations.length}</span></button>
            <button aria-pressed={view === "links"} onClick={() => setView("links")}>{t(language, "Read links", "Enlaces de lectura")}</button>
          </nav>
          {view === "users" && <section className="access-directory" aria-label={t(language, "Project users", "Usuarios del proyecto")}>
            <div className="access-directory-head"><div><h3>{t(language, "Project users", "Usuarios del proyecto")}</h3><p>{t(language, "Open a person's access settings to change their role, sections or folders.", "Abre la gestión de una persona para cambiar su rol, secciones o carpetas.")}</p></div><button className="primary-button" onClick={() => setView("invitations")}>{t(language, "Invite a person", "Invitar persona")}</button></div>
            <label className="access-search"><span>{t(language, "Find a user", "Buscar usuario")}</span><input type="search" value={search} placeholder={t(language, "Name or email", "Nombre o correo")} onChange={(event) => setSearch(event.target.value)} /></label>
            <div className="access-filters" role="group" aria-label={t(language, "Filter users by access", "Filtrar usuarios por acceso")}>
              {([ ["all", t(language, "All", "Todos"), users.length], ["active", t(language, "Active", "Activos"), activeCount], ["pending", t(language, "Pending", "Pendientes"), pendingCount], ["no-access", t(language, "No access", "Sin acceso"), noAccessCount] ] as const).map(([value, label, count]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}
            </div>
            <div className="access-users">
              {visibleUsers.map((member) => {
                const state = stateOf(member);
                const expanded = expandedUid === member.uid;
                const memberName = member.name || member.email;
                const role = state === "active" ? member.role as "viewer" | "editor" : roleChoices[member.uid] ?? (member.role === "editor" ? "editor" : "viewer");
                return <article className={`access-user-row ${expanded ? "is-expanded" : ""}`} key={member.uid}>
                  <div className="access-user-summary">
                    <div className="member-identity"><span className="avatar">{memberName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><b>{memberName}</b><small>{member.email}</small></div></div>
                    <div className="access-user-badges"><span className="type-chip">{roleLabel(member.role)}</span><span className={`status-chip ${state === "active" ? "approved" : state}`}>{stateLabel(state)}</span>{member.accessSource === "read_link" && <span className="access-source-chip">{t(language, "Via read link", "Por enlace de lectura")}</span>}</div>
                    <p className="access-row-summary">{member.role === "admin" ? t(language, "Full project access", "Acceso total al proyecto") : <>{PERMISSION_TABS.filter((tab) => member.permissions[tab]).length} {state === "active" ? t(language, "enabled sections", "secciones habilitadas") : t(language, "configured sections", "secciones configuradas")} · {folderAccessLabel(member.folderAccess, folders, language)}</>}</p>
                    {member.role !== "admin" && <button className="secondary-button access-manage-button" aria-expanded={expanded} aria-controls={`member-access-${member.uid}`} aria-label={t(language, `Manage access for ${memberName}`, `Gestionar acceso de ${memberName}`)} onClick={() => setExpandedUid(expanded ? null : member.uid)}>{expanded ? t(language, "Close settings", "Cerrar gestión") : t(language, "Manage access", "Gestionar acceso")} <span aria-hidden="true">{expanded ? "−" : "+"}</span></button>}
                  </div>
                  {expanded && member.role !== "admin" && <div className="member-access-settings" id={`member-access-${member.uid}`}>
                    <label className="access-role-field"><span>{t(language, "Project role", "Rol en el proyecto")}</span><select className="member-role-select" aria-label={t(language, `Role for ${memberName}`, `Rol de ${memberName}`)} value={role} disabled={busy} onChange={(event) => {
                      const nextRole = event.target.value as "editor" | "viewer";
                      if (state === "active") resolve(member.uid, "approve", nextRole);
                      else setRoleChoices((current) => ({ ...current, [member.uid]: nextRole }));
                    }}><option value="viewer">{t(language, "Viewer — view and download", "Lector — ver y descargar")}</option><option value="editor">{t(language, "Editor — add and propose changes", "Editor — agregar y proponer cambios")}</option></select></label>
                    {state !== "active" && <p className="access-state-note">{state === "pending" ? t(language, "Choose a role, review the permissions, then approve or reject this request.", "Elige un rol, revisa los permisos y aprueba o rechaza esta solicitud.") : t(language, "This person cannot enter the project. Choose a role and restore access before changing permissions.", "Esta persona no puede entrar al proyecto. Elige un rol y restablece el acceso antes de cambiar los permisos.")}</p>}
                    {member.accessSource === "read_link" && <p className="access-state-note">{state === "active" ? t(language, "Changing this person's role or permissions grants direct access. They will no longer depend on the read link.", "Cambiar el rol o los permisos de esta persona le asigna acceso directo; después no dependerá del enlace de lectura.") : t(language, "Restoring access grants this person direct access to the project.", "Restablecer el acceso le asigna a esta persona acceso directo al proyecto.")}</p>}
                    {state !== "pending" && !PERMISSION_TABS.some((tab) => member.permissions[tab]) && <p className="access-state-note">{state === "active" ? t(language, "Select the sections this person can see.", "Selecciona las secciones que esta persona puede ver.") : t(language, "Select the available sections after restoring access.", "Después de restablecer el acceso, selecciona las secciones disponibles.")}</p>}
                    <PermissionPicker language={language} memberName={memberName} permissions={member.permissions} disabled={busy || (state !== "active" && state !== "pending")} onChange={(permissions) => onPermissionsChange(member.uid, permissions)} />
                    <FolderAccessPicker language={language} folders={folders} value={member.folderAccess} disabled={busy || !member.permissions.documents || (state !== "active" && state !== "pending")} documentsEnabled={member.permissions.documents} className="member-folder-access" onChange={(folderAccess) => onFolderAccessChange(member.uid, folderAccess)} />
                    <div className="access-member-actions">
                      {state === "active" ? <button className="secondary-button revoke-member" disabled={busy} onClick={() => resolve(member.uid, "revoke", role)}>{t(language, "Revoke access", "Revocar acceso")}</button> : <>
                        {state === "pending" && <button className="secondary-button" disabled={busy} onClick={() => resolve(member.uid, "reject", role)}>{t(language, "Reject request", "Rechazar solicitud")}</button>}
                        <button className="primary-button" disabled={busy} onClick={() => resolve(member.uid, "approve", role)}>{state === "pending" ? t(language, "Approve access", "Aprobar acceso") : t(language, "Restore access", "Restablecer acceso")}</button>
                      </>}
                      <button className="secondary-button delete-member" disabled={busy} aria-label={t(language, `Delete user ${memberName}`, `Eliminar usuario ${memberName}`)} onClick={(event) => { deleteTrigger.current = event.currentTarget; setDeleteError(false); setMemberToDelete(member); }}>{t(language, "Delete user", "Eliminar usuario")}</button>
                    </div>
                  </div>}
                </article>;
              })}
              {visibleUsers.length === 0 && <EmptyState title={t(language, "No users match", "No hay usuarios que coincidan")} body={t(language, "Try another name, email or access filter.", "Prueba otro nombre, correo o filtro de acceso.")} />}
            </div>
          </section>}
          {view === "invitations" && <section className="access-invitations" aria-label={t(language, "Project invitations", "Invitaciones del proyecto")}>
            <div className="invite-people">
              <div className="section-head"><div><h3>{t(language, "Invite a person", "Invitar persona")}</h3><p>{t(language, "An invitation is tied to one email address. The person signs in to accept it.", "La invitación está vinculada a un correo. La persona inicia sesión para aceptarla.")}</p></div></div>
              <form className="invite-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
                <label><span>{t(language, "Account email", "Correo de la cuenta")}</span><input type="email" required maxLength={254} placeholder="name@example.com" value={inviteEmail} disabled={busy} onChange={(event) => setInviteEmail(event.target.value)} /></label>
                <label><span>{t(language, "Project role", "Rol en el proyecto")}</span><select value={inviteRole} disabled={busy} onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}><option value="viewer">{t(language, "Viewer — view and download", "Lector — ver y descargar")}</option><option value="editor">{t(language, "Editor — add and propose changes", "Editor — agregar y proponer cambios")}</option></select></label>
                <button type="submit" className="primary-button" disabled={busy || !validInviteEmail}>{busy ? t(language, "Creating…", "Creando…") : t(language, "Create invite", "Crear invitación")}</button>
                <details className="access-invite-permissions"><summary>{t(language, "Customize permissions", "Personalizar permisos")}<span>{PERMISSION_TABS.filter((tab) => invitePermissions[tab]).length} {t(language, "sections", "secciones")}</span></summary>
                  <fieldset className="permission-picker invite-permissions"><legend>{t(language, "Enabled sections", "Secciones habilitadas")}</legend>{PERMISSION_TABS.map((tab) => <label key={tab}><input type="checkbox" checked={invitePermissions[tab]} disabled={busy} onChange={(event) => setInvitePermissions((current) => ({ ...current, [tab]: event.target.checked }))} /><span>{navLabel(tab, language)}</span></label>)}</fieldset>
                  <FolderAccessPicker language={language} folders={folders} value={inviteFolderAccess} disabled={busy || !invitePermissions.documents} documentsEnabled={invitePermissions.documents} className="invite-folder-access" onChange={setInviteFolderAccess} />
                </details>
              </form>
              <p className="invite-help">{t(language, "The link is valid for 14 days and only works with the invited email address.", "El enlace es válido durante 14 días y solo funciona con el correo invitado.")}</p>
              {inviteLink && <div className="invite-link"><div><b>{t(language, "Invitation ready", "Invitación lista")}</b><input ref={inviteLinkInput} readOnly value={inviteLink} aria-label={t(language, "Invitation link", "Enlace de invitación")} /></div><button className="secondary-button" onClick={() => void copyLink()}>{copied ? t(language, "Copied!", "¡Copiado!") : t(language, "Copy link", "Copiar enlace")}</button>{copyFailed && <p role="status">{t(language, "Select and copy the link above.", "Selecciona y copia el enlace de arriba.")}</p>}</div>}
            </div>
            <div className="access-invitation-list"><h3>{t(language, "Awaiting acceptance", "En espera de aceptación")} <span className="access-count">{pendingInvitations.length}</span></h3>{pendingInvitations.length ? pendingInvitations.map(invitationRow) : <p className="access-empty-note">{t(language, "No invitations are awaiting acceptance.", "No hay invitaciones en espera de aceptación.")}</p>}</div>
            {pastInvitations.length > 0 && <details className="access-invitation-history"><summary>{t(language, "Invitation history", "Historial de invitaciones")} <span>{pastInvitations.length}</span></summary>{pastInvitations.map(invitationRow)}</details>}
          </section>}
          <div hidden={view !== "links"}><ReadAccessLinks key={user.projectId} projectId={user.projectId} language={language} onAccessChanged={onRefreshUsers} sections={PERMISSION_TABS.map(id => ({ id, label: navLabel(id, language) }))} renderFolderPicker={(value, change, disabled) => <FolderAccessPicker language={language} folders={folders} value={value} onChange={change} disabled={disabled} className="invite-folder-access" />} /></div>
        </>}
      </section>
      {memberToDelete && (
        <ModalOverlay
          className="confirm-modal member-delete-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="member-delete-title"
          aria-describedby="member-delete-description"
          onMouseDown={cancelDelete}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelDelete();
            }
            if (event.key === "Tab") {
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
              const first = buttons[0];
              const last = buttons.at(-1);
              if (!first) event.preventDefault();
              else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
              }
            }
          }}
         onEscape={cancelDelete}>
          <div className="confirm-card danger" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-mark" aria-hidden="true">!</span>
            <h3 id="member-delete-title">{t(language, "Delete user from project?", "¿Eliminar usuario del proyecto?")}</h3>
            <p className="member-delete-identity"><b>{memberToDelete.name || memberToDelete.email}</b><small>{memberToDelete.email}</small></p>
            <p id="member-delete-description">{t(
              language,
              'This user will lose project access and disappear from this list. Their files and edits will be preserved under “Usuario desactivado” (deactivated user).',
              'Este usuario perderá el acceso al proyecto y desaparecerá de esta lista. Sus archivos y ediciones se conservarán a nombre de “Usuario desactivado”.',
            )}</p>
            {deleteError && <p className="member-delete-error" role="alert">{t(language, "The user could not be removed. Try again.", "No se pudo eliminar el usuario. Inténtalo de nuevo.")}</p>}
            <div className="confirm-actions">
              <button className="secondary-button" disabled={busy} data-modal-initial-focus="true" onClick={cancelDelete}>{t(language, "Cancel", "Cancelar")}</button>
              <button className="danger-button" disabled={busy} onClick={() => void confirmDelete()}>{busy ? t(language, "Deleting…", "Eliminando…") : t(language, "Delete user", "Eliminar usuario")}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {user.role === "admin" && <details className="access-advanced"><summary>{t(language, "Advanced tools", "Herramientas avanzadas")}</summary><QaResetPanel language={language} /></details>}
    </>
  );
}

type QaResetAvailability = {
  available: boolean;
  projectId?: string;
  projectName?: string;
  confirmation?: string;
  preview?: {
    records: number;
    storedFiles: number;
    storedBytes: number;
    otherMembers: number;
  };
};

function QaResetPanel({ language }: { language: Language }) {
  const [availability, setAvailability] = useState<QaResetAvailability | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/qa/reset", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: QaResetAvailability) => { if (active) setAvailability(data); })
      .catch(() => { if (active) setAvailability({ available: false }); });
    return () => { active = false; };
  }, []);

  if (!availability?.available) return null;

  const loadPreview = async () => {
    setPreviewing(true);
    setError("");
    try {
      const response = await fetch("/api/qa/reset?preview=1", { cache: "no-store" });
      const data = await response.json() as QaResetAvailability & { error?: string };
      if (!response.ok) throw new Error(data.error || "preview_failed");
      setAvailability(data);
      setConfirmation("");
    } catch {
      setError(t(language, "The QA reset preview could not be loaded.", "No se pudo cargar la vista previa del restablecimiento QA."));
    } finally {
      setPreviewing(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    setError("");
    try {
      const response = await fetch("/api/qa/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation, confirmPermanentDeletion: true }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "reset_failed");
      window.location.reload();
    } catch {
      setError(t(language, "The QA workspace could not be reset. No other workspace was touched.", "No se pudo restablecer el ambiente QA. No se modificó ningún otro espacio."));
      setResetting(false);
    }
  };

  const phrase = availability.confirmation || "";
  return (
    <section className="card qa-reset-panel">
      <div>
        <span className="overline">{t(language, "QA ENVIRONMENT", "AMBIENTE QA")}</span>
        <h3>{t(language, "Start the QA workspace from zero", "Iniciar el ambiente QA desde cero")}</h3>
        <p>{t(language, "Deletes only test content in this account's exclusive personal project. The account and its owner access are preserved.", "Elimina únicamente el contenido de prueba del proyecto personal exclusivo de esta cuenta. Se conservan la cuenta y su acceso propietario.")}</p>
      </div>
      {!availability.preview ? (
        <button className="qa-reset-button" disabled={previewing} onClick={() => void loadPreview()}>
          {previewing ? t(language, "Reviewing…", "Revisando…") : t(language, "Review reset", "Revisar restablecimiento")}
        </button>
      ) : (
        <div className="qa-reset-confirmation" role="group" aria-label={t(language, "QA reset confirmation", "Confirmación de restablecimiento QA")}>
          <div className="qa-reset-summary">
            <span><b>{availability.preview.records}</b>{t(language, "database records", "registros de base de datos")}</span>
            <span><b>{availability.preview.storedFiles}</b>{t(language, "stored files", "archivos almacenados")}</span>
            <span><b>{availability.preview.otherMembers}</b>{t(language, "other members", "otros miembros")}</span>
          </div>
          <p>{t(language, `Type “${phrase}” to enable the permanent reset.`, `Escribe “${phrase}” para habilitar el restablecimiento permanente.`)}</p>
          <input aria-label={t(language, "QA reset phrase", "Frase de restablecimiento QA")} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
          <div className="qa-reset-actions">
            <button className="secondary-button" disabled={resetting} onClick={() => setAvailability((current) => current ? { ...current, preview: undefined } : current)}>{t(language, "Cancel", "Cancelar")}</button>
            <button className="qa-reset-button" disabled={resetting || confirmation !== phrase} onClick={() => void reset()}>{resetting ? t(language, "Resetting…", "Restableciendo…") : t(language, "Permanently reset QA workspace", "Restablecer ambiente QA permanentemente")}</button>
          </div>
        </div>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
  );
}

function FolderAccessPicker({
  language,
  folders,
  value,
  disabled,
  documentsEnabled,
  className,
  onChange,
}: {
  language: Language;
  folders: FolderRecord[];
  value: FolderAccess;
  disabled: boolean;
  documentsEnabled?: boolean;
  className?: string;
  onChange: (value: FolderAccess) => void;
}) {
  const restricted = value.mode === "selected";
  return (
    <fieldset className={`folder-access-picker ${className ?? ""}`}>
      <legend>{t(language, "Top-level document folders", "Carpetas principales de documentos")}</legend>
      <label className="folder-scope-toggle">
        <input
          type="checkbox"
          checked={!restricted}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? { ...DEFAULT_FOLDER_ACCESS }
                : { mode: "selected", folderIds: [], allowUnfiled: false },
            )
          }
        />
        <span>{t(language, "Allow all folders", "Permitir todas las carpetas")}</span>
      </label>
      {restricted && (
        <div className="folder-choice-grid">
          <label>
            <input
              type="checkbox"
              checked={value.allowUnfiled}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, allowUnfiled: event.target.checked })
              }
            />
            <span>{t(language, "Unfiled documents", "Documentos sin carpeta")}</span>
          </label>
          {topLevelFolders(folders).map((folder) => (
            <label key={folder.id}>
              <input
                type="checkbox"
                checked={value.folderIds.includes(folder.id)}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    folderIds: event.target.checked
                      ? [...value.folderIds, folder.id]
                      : value.folderIds.filter((id) => id !== folder.id),
                  })
                }
              />
              <span>{folder.name}</span>
            </label>
          ))}
        </div>
      )}
      {disabled && documentsEnabled === false && (
        <small>
          {t(
            language,
            "Enable Documents to configure folder access.",
            "Habilita Documentos para configurar el acceso a carpetas.",
          )}
        </small>
      )}
    </fieldset>
  );
}

function folderAccessLabel(
  access: FolderAccess,
  folders: FolderRecord[],
  language: Language,
) {
  if (access.mode === "all") return t(language, "All folders", "Todas las carpetas");
  const count = access.folderIds.filter((id) =>
    topLevelFolders(folders).some((folder) => folder.id === id),
  ).length + (access.allowUnfiled ? 1 : 0);
  return t(
    language,
    `${count} folder location${count === 1 ? "" : "s"}`,
    `${count} ubicación${count === 1 ? "" : "es"} de carpeta`,
  );
}

function PermissionPicker({
  language,
  memberName,
  permissions,
  disabled,
  onChange,
}: {
  language: Language;
  memberName: string;
  permissions: MemberPermissions;
  disabled: boolean;
  onChange: (permissions: MemberPermissions) => void;
}) {
  return (
    <fieldset className="permission-picker member-permissions">
      <legend>
        {t(
          language,
          `Section visibility for ${memberName}`,
          `Visibilidad de secciones para ${memberName}`,
        )}
      </legend>
      <p className="member-permissions-help">
        {t(
          language,
          "Turn off any section to hide it immediately. You can change this at any time, even after the invitation was accepted.",
          "Desactivá cualquier sección para ocultarla inmediatamente. Podés cambiar esto en cualquier momento, incluso después de que la invitación haya sido aceptada.",
        )}
      </p>
      {PERMISSION_TABS.map((tab) => (
        <label
          className={permissions[tab] ? "section-visible" : "section-hidden"}
          key={tab}
        >
          <input
            type="checkbox"
            checked={permissions[tab]}
            disabled={disabled}
            aria-label={t(
              language,
              `Show ${navLabel(tab, language)} to ${memberName}`,
              `Mostrar ${navLabel(tab, language)} a ${memberName}`,
            )}
            onChange={(event) =>
              onChange({ ...permissions, [tab]: event.target.checked })
            }
          />
          <span className="permission-tab-label">{navLabel(tab, language)}</span>
          <em>
            {permissions[tab]
              ? t(language, "Visible", "Visible")
              : t(language, "Hidden", "Oculta")}
          </em>
        </label>
      ))}
    </fieldset>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>○</span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function approvalChanges(item: ApprovalRecord) {
  if (typeof item.change_count === "number") return item.change_count;
  try {
    const payload = JSON.parse(item.payload) as { changeCount?: number; changes?: unknown[]; preview?: unknown[] };
    return payload.changeCount ?? payload.changes?.length ?? payload.preview?.length ?? 0;
  } catch {
    return 0;
  }
}
function approvalDetails(item: ApprovalRecord): ApprovalChangeDetail[] {
  if (item.change_details) return item.change_details;
  try {
    const payload = JSON.parse(item.payload) as {
      changes?: Array<{ sheetName?: string; rowIndex?: number; columnIndex?: number; value?: string | number | boolean | null }>;
      preview?: Array<{ sheet?: string; row?: number; column?: number; before?: { v?: string | number | boolean | null; f?: string; s?: { n?: string } } | null; after?: { v?: string | number | boolean | null; f?: string; s?: { n?: string } } | null }>;
    };
    if (payload.preview?.length) return payload.preview.map((change) => ({
      sheet: change.sheet || "Workbook",
      row: Number(change.row || 0),
      column: Number(change.column || 0),
      rowLabel: `Row ${change.row || 0}`,
      groupLabel: null,
      before: approvalCellFromPayload(change.before),
      after: approvalCellFromPayload(change.after),
      calculated: false,
    }));
    return (payload.changes || []).map((change) => ({
      sheet: change.sheetName || "Workbook",
      row: Number(change.rowIndex || 0) + 1,
      column: Number(change.columnIndex || 0) + 1,
      rowLabel: `Row ${Number(change.rowIndex || 0) + 1}`,
      groupLabel: null,
      before: null,
      after: { value: change.value ?? null, formula: null, numberFormat: null },
      calculated: false,
    }));
  } catch { return []; }
}
function approvalCellFromPayload(cell: { v?: string | number | boolean | null; f?: string; s?: { n?: string } } | null | undefined): ApprovalCell | null {
  if (!cell) return null;
  return { value: cell.v ?? null, formula: cell.f || null, numberFormat: cell.s?.n || null };
}
function formatBudgetAmount(value: number, language: Language, currency: "CRC" | "USD" = "CRC") {
  return `${currency === "USD" ? "$" : "₡"}${new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US", { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value)}`;
}
function formatApprovalCell(cell: ApprovalCell | null, language: Language) {
  if (!cell) return "—";
  const value = cell.value;
  if (value === null || value === "") return cell.formula ? `=${cell.formula}` : "—";
  const locale = language === "es" ? "es-CR" : "en-US";
  if (typeof value === "number" && /₡|CRC/i.test(cell.numberFormat || "")) return formatBudgetAmount(value, language, "CRC");
  if (typeof value === "number" && /%/.test(cell.numberFormat || "")) return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value);
  if (typeof value === "number" && /\$|USD/i.test((cell.numberFormat || "").replace(/\[\$-[^\]]*\]/g, ""))) return formatBudgetAmount(value, language, "USD");
  if (typeof value === "number") return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "boolean") return value ? t(language, "Yes", "Sí") : "No";
  return String(value);
}
function excelColumn(column: number) {
  let result = ""; let value = column;
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
  return result || "?";
}
function approvalColumnLabel(change: ApprovalChangeDetail, language: Language) {
  const budget = [
    ["Chapter", "Capítulo"], ["Item", "Partida"], ["Type", "Tipo"], ["Subcategory", "Subcategoría"],
    ["Objective", "Objetivo"], ["Excess over objective", "Exceso sobre objetivo"], ["Current quote", "Cotización vigente"], ["Difference", "Diferencia"],
    ["Status", "Estado"], ["Paid price", "Precio pagado"], ["Supplier / note", "Proveedor / nota"],
    ["Control cost", "Costo de control"], ["Alert", "Alerta"], ["Source / evidence", "Fuente / evidencia"],
    ["Pricing basis", "Base de precio"], ["Review date", "Fecha de revisión"],
    ["Regulation reference", "Referencia reglamento"], ["Required", "Obligatorio"],
  ];
  const purchases = [
    ["Area", "Área"], ["Item", "Partida"], ["Quantity", "Cantidad"], ["Unit objective", "Objetivo unitario"], ["Unit excess", "Exceso unitario"],
    ["Total objective", "Objetivo total"], ["Excess over objective", "Exceso sobre objetivo"], ["Quote", "Cotización"], ["Paid price", "Precio pagado"],
    ["Status", "Estado"], ["Control cost", "Costo de control"], ["Alert", "Alerta"], ["Notes", "Notas"], ["Market reference", "Referencia de mercado"], ["Date", "Fecha"],
  ];
  let label: string | undefined;
  if (change.sheet === "Presupuesto") label = budget[change.column - 1]?.[language === "es" ? 1 : 0];
  else if (change.sheet === "Compras") label = purchases[change.column - 1]?.[language === "es" ? 1 : 0];
  else if (change.sheet === "Resumen") {
    const summary = change.row >= 10
      ? [["Type", "Tipo"], ["Objective", "Objetivo"], ["Excess over objective", "Exceso sobre objetivo"], ["Share of objective", "% del objetivo"], ["Value", "Valor"]]
      : [["Indicator", "Indicador"], ["Amount", "Monto"], ["Value", "Valor"], ["Control", "Control"], ["Value", "Valor"]];
    label = summary[change.column - 1]?.[language === "es" ? 1 : 0];
  }
  return `${label || t(language, "Column", "Columna")} ${excelColumn(change.column)}`;
}
function statusLabel(status: ApprovalRecord["status"], language: Language) {
  return {
    pending: t(language, "Pending", "Pendiente"),
    approved: t(language, "Approved", "Aprobado"),
    rejected: t(language, "Rejected", "Rechazado"),
  }[status];
}
