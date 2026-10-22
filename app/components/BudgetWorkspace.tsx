"use client";

import "./budget-feedback.css";

import { trackDemoAction, trackUsageInteraction } from "@/lib/usage-client";

import BudgetTableEditor from "./BudgetTableEditor";
import BudgetPaidAmount from "./BudgetPaidAmount";
import ExpensesWorkspace from "./ExpensesWorkspace";
import BudgetLinePayments, { useBudgetPayments } from "./BudgetLinePayments";
import ExpensePaymentDetails from "./ExpensePaymentDetails";
import type { ExpensePaymentRecord } from "@/lib/expense-records";
import CopyWorkspaceLink from "./CopyWorkspaceLink";
import { readApiResponse } from "@/lib/read-api-response";
import GoogleSheetsEditing from "./GoogleSheetsEditing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BudgetLine, UniverWorkbook } from "@/lib/workbook";
import type { UniverEditorHandle } from "./UniverEditor";
import { buildWorkspacePath, type BudgetRouteScope } from "@/lib/workspace-navigation";

type Language = "en" | "es";
type Currency = "CRC" | "USD";
type GroupKey = "chapter" | "type" | "subcategory";
type Summary = { label: string; scopeLabel?: string; objective: number; excess: number; spent: number; count: number };
type EditorScope = BudgetRouteScope | null;
type Payload = {
  outsideObjective?: { CRC: number; USD: number; count: number; unpricedCount: number; budgetLinesCRC?: number; budgetLinesUSD?: number; budgetLineCount?: number };
  currency: string; objective: number; excess: number; spent: number; remaining: number;
  percentUsed: number; status: string; lines: BudgetLine[];
  paymentsModelVersion?: number;
  summaries: Record<GroupKey, Summary[]>;
  unsupported: string[]; editingAllowed: boolean; planVersion: number; actualsRevision: number;
  googleSyncError?: string;
  googleSyncPending?: boolean;
};
type WorkbookVersion = { id: string; kind: string; planVersion: number; actualsRevision: number; createdBy: string; createdAt: string | null };

const CHART_COLORS = ["#334155", "#2563eb", "#8b5cf6", "#f59e0b", "#ef4444", "#64748b", "#0ea5e9", "#a855f7", "#f97316", "#94a3b8", "#1e293b", "#6366f1"];
const t = (language: Language, en: string, es: string) => language === "es" ? es : en;
const money = (value: number, language: Language, currency: Currency = "CRC") => new Intl.NumberFormat(
  language === "es" ? "es-CR" : "en-US",
  { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 },
).format(value);
const scopeIdentity = (scope: EditorScope) => scope ? JSON.stringify([scope.key, Boolean(scope.all), scope.all ? null : scope.label]) : "dashboard";
const percentage = (value: number, language: Language) => new Intl.NumberFormat(
  language === "es" ? "es-CR" : "en-US",
  { minimumFractionDigits: 1, maximumFractionDigits: 1 },
).format(value);

const demoLines: BudgetLine[] = [
  { id: "demo-structure", row: 4, chapter: "Structure", item: "Concrete and reinforcement", type: "Construction", subcategory: "Foundation", objective: 30000, excess: 0, quote: 29000, paid: 6200, supplier: "Demo Builder", status: "Completada" },
  { id: "demo-finishes", row: 5, chapter: "Finishes", item: "Floors and wall finishes", type: "Construction", subcategory: "Interior", objective: 15000, excess: 500, quote: 15500, paid: 0, supplier: "Demo Finishes", status: "En progreso" },
  { id: "demo-kitchen", row: 6, chapter: "Interiors", item: "Kitchen cabinetry", type: "Furniture", subcategory: "Kitchen", objective: 10000, excess: 0, quote: 0, paid: 0, supplier: "", status: "Pendiente" },
];

type DemoTextKey = GroupKey | "item" | "supplier";
const DEMO_COPY: Record<string, Record<DemoTextKey, readonly [string, string]>> = {
  "demo-structure": { chapter: ["Structure", "Estructura"], item: ["Concrete and reinforcement", "Concreto y refuerzo"], type: ["Construction", "Construcción"], subcategory: ["Foundation", "Cimentación"], supplier: ["Demo Builder", "Constructora Demo"] },
  "demo-finishes": { chapter: ["Finishes", "Acabados"], item: ["Floors and wall finishes", "Pisos y acabados de paredes"], type: ["Construction", "Construcción"], subcategory: ["Interior", "Interior"], supplier: ["Demo Finishes", "Acabados Demo"] },
  "demo-kitchen": { chapter: ["Interiors", "Interiores"], item: ["Kitchen cabinetry", "Muebles de cocina"], type: ["Furniture", "Mobiliario"], subcategory: ["Kitchen", "Cocina"], supplier: ["", ""] },
};
const DEMO_COLUMNS: Partial<Record<number, DemoTextKey>> = { 0: "chapter", 1: "item", 2: "type", 3: "subcategory", 10: "supplier" };
const DEMO_HEADERS: Record<number, readonly [string, string]> = {
  0: ["Chapter", "Capítulo"], 1: ["Item", "Partida"], 2: ["Type", "Tipo"], 3: ["Subcategory", "Subcategoría"], 4: ["Objective", "Objetivo"], 5: ["Excess over objective", "Exceso sobre objetivo"], 6: ["Current quote", "Cotización actual"], 8: ["Status", "Estado"], 9: ["Actual spent", "Gasto real"], 10: ["Supplier", "Proveedor"], 13: ["Source / evidence", "Fuente / evidencia"], 14: ["Pricing basis", "Base del precio"], 15: ["Review date", "Fecha de revisión"], 16: ["Regulation reference", "Referencia normativa"], 17: ["Required", "Requerido"],
};

function demoCategory(label: string, key: GroupKey, language: Language) {
  if (label === "Unassigned" || label === "Sin asignar") return t(language, "Unassigned", "Sin asignar");
  const pair = Object.values(DEMO_COPY).map((copy) => copy[key]).find((values) => values.includes(label));
  return pair ? pair[language === "es" ? 1 : 0] : label;
}

function demoValue(value: string, column: number, rowId: string, language: Language) {
  const key = DEMO_COLUMNS[column];
  if (!key) return value;
  if (key === "chapter" || key === "type" || key === "subcategory") return demoCategory(value, key, language);
  const pair = DEMO_COPY[rowId]?.[key];
  return pair?.includes(value) ? pair[language === "es" ? 1 : 0] : value;
}

function demoDisplayLine(line: BudgetLine, language: Language): BudgetLine {
  return { ...line, chapter: demoCategory(line.chapter, "chapter", language), type: demoCategory(line.type, "type", language), subcategory: demoCategory(line.subcategory, "subcategory", language), item: demoValue(line.item, 1, line.id, language), supplier: demoValue(line.supplier, 10, line.id, language) };
}

function canonicalDemoSnapshot(workbook: UniverWorkbook): UniverWorkbook {
  const next = structuredClone(workbook);
  for (const sheet of Object.values(next.sheets)) for (const [row, cells] of Object.entries(sheet.cellData)) {
    if (Number(row) < 3) continue;
    const rowId = String(cells[25]?.v || "");
    for (const column of [0, 1, 2, 3, 10]) if (cells[column]?.v !== undefined) {
      cells[column] = { ...cells[column], v: demoValue(String(cells[column].v), column, rowId, "en") };
    }
  }
  return next;
}

function demoEditorWorkbook(workbook: UniverWorkbook, scope: EditorScope, language: Language): UniverWorkbook {
  const next = structuredClone(workbook);
  next.name = t(language, "House Planner Demo", "Demostración de House Planner");
  for (const sheet of Object.values(next.sheets)) {
    sheet.name = scope ? demoCategory(sheet.name, scope.key, language).slice(0, 31) : t(language, "Budget", "Presupuesto");
    sheet.cellData[2] ||= {};
    for (const [column, copy] of Object.entries(DEMO_HEADERS)) {
      const index = Number(column);
      sheet.cellData[2][index] = { ...sheet.cellData[2][index], v: copy[language === "es" ? 1 : 0] };
    }
    sheet.cellData[1] ||= {};
    for (const [column, status, symbol, en, es] of [[8, "Completada", "✓", "completed", "completada"], [10, "En progreso", "◐", "in progress", "en progreso"], [12, "Pendiente", "○", "pending", "pendiente"]] as const) {
      const count = Object.entries(sheet.cellData).filter(([row, cells]) => Number(row) >= 3 && cells[0]?.v && cells[1]?.v && cells[8]?.v === status).length;
      const label = language === "es" && status !== "En progreso" && count !== 1 ? `${es}s` : t(language, en, es);
      sheet.cellData[1][column] = { ...sheet.cellData[1][column], v: `${symbol} ${count} ${label}` };
    }
  }
  return next;
}

function summarize(lines: BudgetLine[], key: GroupKey) {
  return Object.values(lines.reduce<Record<string, Summary>>((all, line) => {
    if (line.outsideObjective) return all;
    const label = line[key] || "Unassigned";
    const item = all[label] ||= { label, objective: 0, excess: 0, spent: 0, count: 0 };
    item.objective += line.objective;
    item.excess += line.excess;
    item.spent += line.paid;
    item.count += 1;
    return all;
  }, {})).sort((a, b) => b.objective - a.objective);
}

function withLines(payload: Payload, lines: BudgetLine[]): Payload {
  const normalizedLines = lines.map((line) => {
    const previous = payload.lines.find((item) => item.id === line.id);
    const transactionPaid = previous?.transactionPaid || 0;
    const workbookPaid = line.workbookPaid ?? line.paid;
    const paid = payload.paymentsModelVersion === 2 ? previous?.paid ?? line.paid : workbookPaid + transactionPaid;
    return { ...line, ...(previous?.workbookPaid !== undefined ? { workbookPaid, transactionPaid } : {}), paid,
      excess: line.outsideObjective ? 0 : Math.max(0, Math.max(paid, line.quote) - line.objective) };
  });
  const includedLines = normalizedLines.filter((line) => !line.outsideObjective);
  const outsideLines = normalizedLines.filter((line) => line.outsideObjective);
  const outsidePaid = outsideLines.reduce((sum, line) => sum + line.paid, 0);
  const budgetLinesCRC = payload.currency === "USD" ? 0 : outsidePaid;
  const budgetLinesUSD = payload.currency === "USD" ? outsidePaid : 0;
  const objective = includedLines.reduce((sum, line) => sum + line.objective, 0);
  const excess = includedLines.reduce((sum, line) => sum + line.excess, 0);
  const spent = includedLines.reduce((sum, line) => sum + line.paid, 0);
  return {
    ...payload,
    lines: normalizedLines,
    outsideObjective: { CRC: (payload.outsideObjective?.CRC || 0) - (payload.outsideObjective?.budgetLinesCRC || 0) + budgetLinesCRC, USD: (payload.outsideObjective?.USD || 0) - (payload.outsideObjective?.budgetLinesUSD || 0) + budgetLinesUSD, count: payload.outsideObjective?.count || 0, unpricedCount: payload.outsideObjective?.unpricedCount || 0, budgetLinesCRC, budgetLinesUSD, budgetLineCount: outsideLines.length },
    objective,
    excess,
    spent,
    remaining: objective - spent,
    percentUsed: objective ? spent / objective * 100 : 0,
    status: excess > 0 ? "over_objective" : "within_objective",
    summaries: {
      chapter: summarize(normalizedLines, "chapter"),
      type: summarize(normalizedLines, "type"),
      subcategory: summarize(normalizedLines, "subcategory"),
    },
  };
}

function demoPayload(): Payload {
  return withLines({
    currency: "USD", objective: 0, excess: 0, spent: 0, remaining: 0, percentUsed: 0,
    status: "within_objective", lines: [], summaries: { chapter: [], type: [], subcategory: [] },
    unsupported: [], editingAllowed: true, planVersion: 1, actualsRevision: 1,
  }, demoLines);
}

function demoWorkbook(lines = demoLines): UniverWorkbook {
  const statusCount = (status: string) => lines.filter((line) => line.status === status).length;
  const cells: UniverWorkbook["sheets"][string]["cellData"] = {
    1: {
      8: { v: `✓ ${statusCount("Completada")} completada` },
      10: { v: `◐ ${statusCount("En progreso")} en progreso` },
      12: { v: `○ ${statusCount("Pendiente")} pendiente` },
    },
    2: { 0: { v: "Chapter" }, 1: { v: "Item" }, 2: { v: "Type" }, 3: { v: "Subcategory" }, 4: { v: "Objective" }, 5: { v: "Excess over objective" }, 6: { v: "Current quote" }, 8: { v: "Status" }, 9: { v: "Actual spent" }, 10: { v: "Supplier" }, 13: { v: "Source / evidence" }, 14: { v: "Pricing basis" }, 15: { v: "Review date" }, 16: { v: "Regulation reference" }, 17: { v: "Required" } },
  };
  lines.forEach((line) => {
    const rowBackground = line.status === "Completada" ? "#EAF4E2" : line.status === "En progreso" ? "#FFF4CC" : "#F7F7F7";
    const statusBackground = line.status === "Completada" ? "#C6E0B4" : line.status === "En progreso" ? "#FFE699" : "#F2F2F2";
    cells[line.row - 1] = {
      0: { v: line.chapter, s: { bg: { rgb: rowBackground } } }, 1: { v: line.item, s: { bg: { rgb: rowBackground } } }, 2: { v: line.type, s: { bg: { rgb: rowBackground } } }, 3: { v: line.subcategory, s: { bg: { rgb: rowBackground } } },
      4: { v: line.objective, s: { bg: { rgb: rowBackground } } }, 5: { v: line.excess, s: { bg: { rgb: rowBackground } } }, 6: { v: line.quote, s: { bg: { rgb: rowBackground } } },
      8: { v: line.status, s: { bg: { rgb: statusBackground }, bl: true } },
      25: { v: line.id }, 26: { v: line.outsideObjective ? 1 : 0 },
      9: { v: line.paid, s: { bg: { rgb: rowBackground } } }, 10: { v: line.supplier, s: { bg: { rgb: rowBackground } } },
    };
  });
  return {
    id: "demo-house-planner", name: "House Planner Demo", sheetOrder: ["budget"],
    sheets: { budget: { id: "budget", name: "Presupuesto", rowCount: 100, columnCount: 18, cellData: cells, mergeData: [], rowData: {}, columnData: { 1: { w: 210 }, 8: { w: 120 }, 9: { w: 120 } } } },
  };
}

function workbookForScope(workbook: UniverWorkbook, lines: BudgetLine[], scope: EditorScope) {
  if (!scope) return { workbook, rowMaps: {} as Record<string, Record<number, number>> };
  const sheetId = workbook.sheetOrder.find((id) => workbook.sheets[id]?.name === "Presupuesto")
    || workbook.sheetOrder.find((id) => workbook.sheets[id]?.name === "Budget")
    || workbook.sheetOrder[0];
  const source = workbook.sheets[sheetId];
  if (!source) return { workbook, rowMaps: {} as Record<string, Record<number, number>> };
  const labels = scope.all ? [...new Set(lines.map((line) => line[scope.key] || "Unassigned"))].sort() : [scope.label || "Unassigned"];
  if (!labels.length) labels.push("General");
  const sheets: UniverWorkbook["sheets"] = {}; const sheetOrder: string[] = []; const rowMaps: Record<string, Record<number, number>> = {};
  labels.forEach((label, sheetIndex) => {
    const id = `category-${sheetIndex + 1}`; const matching = lines.filter((line) => (line[scope.key] || "Unassigned") === label);
    const rows = [1, 2, 3, ...matching.map((line) => line.row)]; const cellData: typeof source.cellData = {}; const rowData: typeof source.rowData = {};
    rows.forEach((sourceRow, targetIndex) => {
      const targetRow = targetIndex + 1;
      (rowMaps[label] ||= {})[targetRow] = sourceRow;
      if (source.cellData[sourceRow - 1]) cellData[targetRow - 1] = structuredClone(source.cellData[sourceRow - 1]);
      if (source.rowData[sourceRow - 1]) rowData[targetRow - 1] = { ...source.rowData[sourceRow - 1], hd: false };
    });
    cellData[1] ||= {};
    const statusSummaries = [
      { column: 8, status: "Completada", symbol: "✓", singular: "completada", plural: "completadas" },
      { column: 10, status: "En progreso", symbol: "◐", singular: "en progreso", plural: "en progreso" },
      { column: 12, status: "Pendiente", symbol: "○", singular: "pendiente", plural: "pendientes" },
    ];
    for (const summary of statusSummaries) {
      const count = matching.filter((line) => line.status === summary.status).length;
      cellData[1][summary.column] = { ...cellData[1][summary.column], v: `${summary.symbol} ${count} ${count === 1 ? summary.singular : summary.plural}` };
    }
    sheets[id] = { ...source, id, name: label.slice(0, 31), rowCount: Math.max(30, rows.length + 8), cellData, rowData, mergeData: source.mergeData.filter((merge) => merge.endRow < 3), hidden: false };
    sheetOrder.push(id);
  });
  return { workbook: { ...workbook, id: `${workbook.id}-${scope.key}-${scope.label || "all"}`, name: scope.all ? `${workbook.name} · ${scope.key}` : `${scope.label} · ${workbook.name}`, sheetOrder, sheets }, rowMaps };
}

function payloadFromSnapshot(payload: Payload, workbook: UniverWorkbook, rowMaps: Record<string, Record<number, number>>) {
  const touched = new Set(Object.values(rowMaps).flatMap((map) => Object.values(map)));
  const touchedIds = new Set(Object.values(workbook.sheets).flatMap((sheet) => Object.values(sheet.cellData).map((cells) => String(cells[25]?.v || "").replace(/^new:/, ""))));
  const nextLines = payload.lines.filter((line) => !touched.has(line.row) && !touchedIds.has(line.id));
  let nextRow = Math.max(3, ...payload.lines.map((line) => line.row));
  for (const sheet of Object.values(workbook.sheets)) for (const [row, cells] of Object.entries(sheet.cellData)) {
    if (Number(row) < 3 || !cells[0]?.v || !cells[1]?.v || /^TOTAL/i.test(String(cells[0].v))) continue;
    const id = String(cells[25]?.v || `${sheet.id}-${row}`);
    const original = payload.lines.find((line) => line.id === id || `new:${line.id}` === id);
    const objective = Number(cells[4]?.v || 0), quote = Number(cells[6]?.v || 0), paid = Number(cells[9]?.v || 0);
    nextLines.push({ id: id.replace(/^new:/, ""), row: original?.row || ++nextRow, chapter: String(cells[0].v), item: String(cells[1].v), type: String(cells[2]?.v || ""), subcategory: String(cells[3]?.v || ""), outsideObjective: Number(cells[26]?.v) === 1, objective, quote, paid, excess: Math.max(0,(paid || quote)-objective), supplier: String(cells[10]?.v || ""), status: String(cells[8]?.v || "Pendiente") });
  }
  return withLines(payload, [...new Map(nextLines.map((line) => [line.id, line])).values()]);
}

export default function BudgetWorkspace({ mode, language, canEdit, canReplace, isOwner, onReplace, assistantDraftId = null, onAssistantDraftOpened, projectId, routeScope, onRouteScopeChange, onRegisterNavigationGuard, canViewPurchases = false }: {
  mode: "demo" | "real"; language: Language; canEdit: boolean; canReplace: boolean;
  isOwner: boolean; onReplace: () => void; assistantDraftId?: string | null; onAssistantDraftOpened?: () => void;
  projectId?: string; routeScope?: BudgetRouteScope | null; onRouteScopeChange?: (scope: BudgetRouteScope | null) => void;
  canViewPurchases?: boolean;
  onRegisterNavigationGuard?: (guard: (() => Promise<boolean>) | null) => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(mode === "demo" ? demoPayload() : null);
  const [error, setError] = useState("");
  const [paymentContext, setPaymentContext] = useState<{ budgetLineId: string; item: string; paymentId?: string; paymentsModelVersion?: number } | null>(null);
  const [paymentNotice, setPaymentNotice] = useState("");
  const [paymentRefreshFailed, setPaymentRefreshFailed] = useState(false);
  const canRegisterPayments = mode === "real" && canEdit && canViewPurchases;
  const [selectedPayment, setSelectedPayment] = useState<ExpensePaymentRecord | null>(null);
  const [paymentHistoryRevision, setPaymentHistoryRevision] = useState(0);
  const paymentHistoryData = useBudgetPayments({ enabled: mode === "real" && canViewPurchases, projectId, revision: paymentHistoryRevision });
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GroupKey>("chapter");
  const [editor, setEditor] = useState<UniverWorkbook | null>(null);
  const currency: Currency = mode === "demo" || (editor?.currency || payload?.currency) === "USD" ? "USD" : "CRC";
  const [googleOpen, setGoogleOpen] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleNotice, setGoogleNotice] = useState("");
  const [googleRefreshFailed, setGoogleRefreshFailed] = useState(false);
  const googleLocked = false;
  const savedBudgetOnly = Boolean(payload?.googleSyncError || payload?.googleSyncPending);
  const editorGeneration = 0;
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editorScope, setEditorScope] = useState<EditorScope>(null);
  const [editorRowMaps, setEditorRowMaps] = useState<Record<string, Record<number, number>>>({});
  const [draftId, setDraftId] = useState("");
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState("");
  const [savingNow, setSavingNow] = useState(false);
  const [publishNotice, setPublishNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [openingScope, setOpeningScope] = useState<EditorScope>(null);
  const [budgetRefreshing, setBudgetRefreshing] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [savedDrafts, setSavedDrafts] = useState<Array<{ id: string; googleFileId?: string; scope?: EditorScope }> | null>(null);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const draftsLoadingRef = useRef(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<WorkbookVersion[]>([]);
  const [versionsState, setVersionsState] = useState("");
  const [versionsLoading, setVersionsLoading] = useState(false);
  const versionsLoadingRef = useRef(false);
  const [restoringVersion, setRestoringVersion] = useState("");
  const openingEditorRef = useRef(false);
  const openingCompletionRef = useRef<{ promise: Promise<boolean>; resolve: (ready: boolean) => void } | null>(null);
  const mountedRef = useRef(true);
  const budgetRequestRef = useRef(0);
  const budgetReadRef = useRef<{ projectId: string | undefined; request: number; promise: Promise<boolean> } | null>(null);
  const budgetShownProjectRef = useRef<string | undefined | null>(null);
  const budgetProjectRef = useRef(projectId);
  const saveInFlightRef = useRef(false);
  const pendingSnapshotRef = useRef<UniverWorkbook | null>(null);
  const revisionRef = useRef(0);
  const editorHandleRef = useRef<UniverEditorHandle | null>(null);
  const submittingRef = useRef(false);
  const submittedRef = useRef(false);
  const saveErrorRef = useRef("");
  const handledRouteRef = useRef(routeScope ? "" : "dashboard");
  const navigationGuardRef = useRef<() => Promise<boolean>>(async () => true);
  const navigationSavingRef = useRef(false);

  useEffect(() => { budgetProjectRef.current = projectId; }, [projectId]);
  useEffect(() => { revisionRef.current = revision; }, [revision]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      budgetRequestRef.current += 1;
      budgetReadRef.current = null;
      openingCompletionRef.current?.resolve(false);
      openingCompletionRef.current = null;
    };
  }, []);
  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); }, []);
  const refreshBudget = useCallback((options: { background?: boolean; storedFirst?: boolean } = {}): Promise<boolean> => {
    const pending = budgetReadRef.current;
    if (options.background && pending && pending.projectId === projectId) return pending.promise;
    const request = ++budgetRequestRef.current;
    const isCurrent = () => mountedRef.current && request === budgetRequestRef.current && budgetProjectRef.current === projectId;
    setBudgetRefreshing(true);
    const read = async (stored = false) => {
      const response = await fetch("/api/budget", { cache: "no-store", ...(stored ? { headers: { "x-house-planner-budget-source": "stored" } } : {}) });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error);
      return data;
    };
    const operation: Promise<boolean> = (async () => {
      try {
        if (options.storedFirst && budgetShownProjectRef.current !== projectId) {
          // Show the saved plan and current ledger without waiting for Drive.
          // If that snapshot is unavailable, the normal read can still recover it.
          try {
            const saved = await read(true);
            if (!isCurrent()) return false;
            budgetShownProjectRef.current = projectId;
            setPayload({ ...saved, editingAllowed: false, googleSyncPending: true }); setError("");
          } catch { if (!isCurrent()) return false; }
        }
        const data = await read();
        if (!isCurrent()) return false;
        budgetShownProjectRef.current = projectId;
        // Keep the draft snapshot and its base version; only replace official totals.
        setPayload(data); setError("");
        return true;
      } catch (reason) {
        if (!isCurrent()) return false;
        const message = reason instanceof Error ? reason.message : "Budget unavailable";
        setPayload((current) => current?.googleSyncPending ? { ...current, googleSyncPending: false, googleSyncError: message, editingAllowed: false } : current);
        throw reason;
      } finally {
        if (isCurrent()) setBudgetRefreshing(false);
        if (budgetReadRef.current?.request === request) budgetReadRef.current = null;
      }
    })();
    budgetReadRef.current = { projectId, request, promise: operation };
    return operation;
  }, [projectId]);
  useEffect(() => () => { budgetRequestRef.current += 1; budgetReadRef.current = null; budgetShownProjectRef.current = null; }, [mode, projectId]);
  useEffect(() => {
    if (mode === "demo") return;
    const timer = window.setTimeout(() => {
      void refreshBudget({ background: true, storedFirst: true }).catch((reason) => setError(reason instanceof Error ? reason.message : "Budget unavailable"));
    }, 0);
    return () => { window.clearTimeout(timer); };
  }, [mode, projectId, refreshRevision, refreshBudget]);

  useEffect(() => {
    if (mode !== "real" || editor) return;
    const refresh = () => setRefreshRevision((value) => value + 1);
    const refreshCommittedChange = () => {
      void refreshBudget({ storedFirst: true }).catch((reason) => setError(reason instanceof Error ? reason.message : "Budget unavailable"));
    };
    window.addEventListener("focus", refresh); window.addEventListener("houseplanner-budget-updated", refreshCommittedChange);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("houseplanner-budget-updated", refreshCommittedChange); };
  }, [mode, editor, refreshBudget]);

  const filtered = useMemo(() => payload?.lines.filter((line) => {
    const displayed = mode === "demo" ? demoDisplayLine(line, language) : line;
    return `${displayed.chapter} ${displayed.item} ${displayed.type} ${displayed.subcategory} ${displayed.supplier} ${line.chapter} ${line.item}`.toLowerCase().includes(query.toLowerCase());
  }) || [], [payload, query, mode, language]);
  const quoteTotal = useMemo(() => payload?.lines.reduce((sum, line) => sum + (line.outsideObjective ? 0 : line.quote), 0) || 0, [payload]);
  const displayedEditor = useMemo(() => editor && mode === "demo" ? demoEditorWorkbook(editor, editorScope, language) : editor, [editor, editorScope, mode, language]);
  const displayedSummaries = mode === "demo" && payload
    ? payload.summaries[group].map((item) => ({ ...item, scopeLabel: item.label, label: demoCategory(item.label, group, language) }))
    : payload?.summaries[group] || [];
  const formatDemoValue = mode === "demo" ? (value: string, column: number, rowId = "") => column === -1
    ? value === "Budget" || value === "Presupuesto" ? t(language, "Budget", "Presupuesto") : demoCategory(value, editorScope?.key || group, language)
    : demoValue(value, column, rowId, language) : undefined;

  const beginEditorOpening = (scope: EditorScope = null) => {
    let resolve!: (ready: boolean) => void;
    const promise = new Promise<boolean>((completed) => { resolve = completed; });
    openingCompletionRef.current = { promise, resolve };
    openingEditorRef.current = true;
    setOpeningScope(scope);
    setOpeningEditor(true);
  };

  const openAssistantDraft = async (id: string, assistant = true) => {
    if (googleBusy || openingEditorRef.current || editor || !payload || savedBudgetOnly) return;
    beginEditorOpening();
    setGoogleOpen(false);
    setError("");
    setPublishNotice("");
    setSubmitted(false);
    submittedRef.current = false;
    submittingRef.current = false;
    saveErrorRef.current = "";
    setSaveState(assistant ? t(language, "Opening assistant draft…", "Abriendo borrador del asistente…") : t(language, "Opening saved draft…", "Abriendo borrador guardado…"));
    try {
      const response = await fetch(`/api/workbook/drafts?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || t(language, "The assistant draft could not be opened", "No se pudo abrir el borrador del asistente"));
      if (data.draft?.status !== "editing") throw new Error(t(language, "This draft is no longer editable", "Este borrador ya no se puede editar"));
      setGoogleOpen(false);
      setEditorScope(data.draft.scope || null);
      setEditorRowMaps(data.draft.rowMaps || {});
      setEditor(data.workbook);
      setDraftId(data.draft.id);
      setRevision(data.draft.revision || 0);
      revisionRef.current = data.draft.revision || 0;
      setSaveState(assistant ? t(language, "Assistant draft ready for review", "Borrador del asistente listo para revisión") : t(language, "Saved draft reopened", "Borrador guardado reabierto"));
      handledRouteRef.current = scopeIdentity(data.draft.scope || null);
      onRouteScopeChange?.(data.draft.scope || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(language, "The assistant draft could not be opened", "No se pudo abrir el borrador del asistente"));
      setSaveState("");
    } finally {
      openingEditorRef.current = false;
      setOpeningEditor(false);
      if (assistant) onAssistantDraftOpened?.();
    }
  };

  useEffect(() => {
    if (mode !== "real" || !assistantDraftId || !payload || editor || googleBusy) return;
    const timer = window.setTimeout(() => void openAssistantDraft(assistantDraftId), 0);
    // The parent consumes the id after this one-time open.
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantDraftId, payload, editor, mode, googleBusy]);

  const openEditor = async (scope: EditorScope = null, fromRoute = false) => {
    if (googleBusy || openingEditorRef.current || (!fromRoute && editor) || !payload || savedBudgetOnly) return;
    if (scope && !scope.all && !payload.lines.some((line) => (line[scope.key] || "Unassigned") === scope.label)) {
      setError(t(language, `The category “${scope.label}” no longer exists in the official budget.`, `La categoría «${scope.label}» ya no existe en el presupuesto oficial.`));
      return;
    }
    beginEditorOpening(scope);
    setGoogleOpen(false);
    setError("");
    setPublishNotice("");
    setSubmitted(false);
    submittedRef.current = false;
    submittingRef.current = false;
    saveErrorRef.current = "";
    const label = scope && !scope.all ? (mode === "demo" ? demoCategory(scope.label || "", scope.key, language) : scope.label) : "";
    setSaveState(label ? t(language, `Opening ${label}…`, `Abriendo ${label}…`) : t(language, "Opening budget…", "Abriendo presupuesto…"));
    try {
      if (mode === "demo") {
        const generated = workbookForScope(demoWorkbook(payload.lines), payload.lines, scope);
        setEditorScope(scope);
        setEditorRowMaps(generated.rowMaps);
        setEditor(generated.workbook);
        setSaveState("");
        handledRouteRef.current = scopeIdentity(scope);
        if (!fromRoute) onRouteScopeChange?.(scope);
        return;
      }
      const viewerQuery = scope ? `?group=${encodeURIComponent(scope.key)}&${scope.all ? "all=true" : `label=${encodeURIComponent(scope.label || "Unassigned")}`}` : "";
      const response = await fetch(canEdit ? "/api/workbook/drafts" : `/api/workbook/editor${viewerQuery}`, {
        method: canEdit ? "POST" : "GET",
        headers: canEdit ? { "Content-Type": "application/json" } : undefined,
        body: canEdit ? JSON.stringify({ action: "create", scope, expectedCurrency: currency }) : undefined,
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || t(language, "The spreadsheet could not be opened", "No se pudo abrir la hoja"));
      setEditorScope(scope);
      setEditorRowMaps(data.rowMaps || {});
      setEditor(data.workbook);
      setDraftId(data.id || "");
      setRevision(data.revision || 0);
      revisionRef.current = data.revision || 0;
      setSaveState(canEdit ? (isOwner ? t(language, "Ready to edit the official workbook", "Listo para editar el libro oficial") : t(language, "Private draft created", "Borrador privado creado")) : "");
      handledRouteRef.current = scopeIdentity(scope);
      if (!fromRoute) onRouteScopeChange?.(scope);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(language, "The spreadsheet could not be opened", "No se pudo abrir la hoja"));
      setSaveState("");
    } finally {
      openingEditorRef.current = false;
      setOpeningEditor(false);
    }
  };

  const autosave = async (workbook: UniverWorkbook, force = false) => {
    if (mode === "demo") {
      const canonical = canonicalDemoSnapshot(workbook);
      setEditor(canonical);
      setPayload((current) => current ? payloadFromSnapshot(current, canonical, editorRowMaps) : current);
      trackDemoAction("budget.save");
      setSaveState("");
      return;
    }
    if (!draftId || submittedRef.current || (submittingRef.current && !force)) return;
    pendingSnapshotRef.current = workbook;
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    try {
      while (pendingSnapshotRef.current) {
        const snapshot = pendingSnapshotRef.current;
        pendingSnapshotRef.current = null;
        saveErrorRef.current = "";
        setSaveState(isOwner ? t(language, "Saving changes…", "Guardando cambios…") : t(language, "Saving draft…", "Guardando borrador…"));
        const response = await fetch("/api/workbook/drafts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", id: draftId, revision: revisionRef.current, workbook: snapshot }),
        });
        const data = await readApiResponse(response);
        if (!response.ok) {
          pendingSnapshotRef.current = null;
          saveErrorRef.current = data.code === "revision_conflict" ? t(language, "Conflict: reload the draft", "Conflicto: recarga el borrador") : data.error;
          setSaveState(saveErrorRef.current);
          break;
        }
        revisionRef.current = data.revision;
        setRevision(data.revision);
        setSaveState(isOwner ? t(language, "Draft saved · apply with Save", "Borrador guardado · aplica con Guardar") : t(language, "Draft saved", "Borrador guardado"));
      }
    } catch (reason) {
      pendingSnapshotRef.current = null;
      saveErrorRef.current = reason instanceof Error ? reason.message : "Saving failed. Try again.";
      setSaveState(saveErrorRef.current);
    } finally {
      saveInFlightRef.current = false;
    }
  };

  const persistLatestSnapshot = async () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    const activeSheet = editorHandleRef.current?.getActiveSheet() || null;
    const snapshot = await editorHandleRef.current?.commitPendingEdit();
    // Quote defaults may schedule autosave while committing; persist this snapshot once.
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (!snapshot) throw new Error(t(language, "The spreadsheet is still loading", "La hoja todavía se está cargando"));
    setSaveState(t(language, "Saving the latest cell changes…", "Guardando los últimos cambios de celdas…"));
    await autosave(snapshot, true);
    const deadline = Date.now() + 30_000;
    while (saveInFlightRef.current && Date.now() < deadline) await new Promise((resolve) => window.setTimeout(resolve, 50));
    if (saveInFlightRef.current) throw new Error(t(language, "Saving took too long. Try again.", "El guardado tardó demasiado. Inténtalo de nuevo."));
    if (saveErrorRef.current) throw new Error(saveErrorRef.current);
    return activeSheet;
  };

  const saveNow = async () => {
    if (!draftId || savingNow || submittingRef.current || submittedRef.current || savedBudgetOnly) return;
    submittingRef.current = true;
    setSavingNow(true);
    saveErrorRef.current = "";
    try {
      await persistLatestSnapshot();
      setSaveState(t(language, "Saved · continuing on this sheet", "Guardado · continúas en esta hoja"));
    } catch (reason) {
      setSaveState(reason instanceof Error ? reason.message : t(language, "The workbook could not be saved", "No se pudo guardar el libro"));
    } finally {
      submittingRef.current = false;
      setSavingNow(false);
    }
  };

  const submit = async () => {
    if (!draftId || savingNow || submittingRef.current || submittedRef.current || savedBudgetOnly) return;
    submittingRef.current = true;
    setSubmitting(true);
    saveErrorRef.current = "";
    try {
      await persistLatestSnapshot();
      setSaveState(isOwner ? t(language, "Publishing official workbook…", "Publicando el libro oficial…") : t(language, "Submitting for approval…", "Enviando para aprobación…"));
      const response = await fetch("/api/workbook/drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: isOwner ? "publish" : "submit", id: draftId }),
      });
      const data = await readApiResponse(response);
      if (data.code === "no_changes") { setSaveState(t(language, "No pending changes", "No hay cambios pendientes")); return; }
      if (data.code === "stale_base") throw new Error(t(language, "The official budget changed. Your draft is saved; return to the dashboard and reopen the budget before publishing.", "El presupuesto oficial cambió. Tu borrador está guardado; vuelve al Panel y abre el presupuesto actual antes de publicar."));
      if (!response.ok) throw new Error(data.error || t(language, "The workbook could not be submitted", "No se pudo procesar el libro"));
      submittedRef.current = true;
      const notice = data.googleSyncError || (isOwner ? t(language, "Official workbook published", "Libro oficial publicado") : t(language, "Submitted for owner approval", "Enviado para aprobación del propietario"));
      setPublishNotice(notice);
      if (data.googleSyncError) { setSubmitted(true); setSaveState(data.googleSyncError); return; }
      if (isOwner) {
        const nextResponse = await fetch("/api/workbook/drafts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", scope: editorScope, expectedCurrency: currency }),
        });
        const next = await readApiResponse(nextResponse);
        if (nextResponse.ok) {
          setEditorRowMaps(next.rowMaps || {});
          setEditor(next.workbook);
          setDraftId(next.id);
          setRevision(next.revision || 0);
          revisionRef.current = next.revision || 0;
          submittedRef.current = false;
          setSubmitted(false);
          setSaveState(t(language, "Published · ready to continue editing", "Publicado · listo para continuar editando"));
        } else {
          setSubmitted(true);
          setSaveState(t(language, "Published, but a new editable copy could not be opened", "Publicado, pero no se pudo abrir una nueva copia editable"));
        }
        setRefreshRevision((value) => value + 1);
      } else {
        setSubmitted(true);
        setSaveState(notice);
      }
    } catch (reason) {
      setSaveState(reason instanceof Error ? reason.message : t(language, "The workbook could not be submitted", "No se pudo procesar el libro"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const openSavedDrafts = async () => {
    if (draftsLoadingRef.current) return;
    if (savedDrafts) { setSavedDrafts(null); return; }
    draftsLoadingRef.current = true;
    setDraftsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workbook/drafts", { cache: "no-store" });
      const result = await readApiResponse(response); if (!response.ok) throw new Error(result.error);
      setSavedDrafts(result.drafts.filter((draft: { status: string }) => draft.status === "editing"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t(language, "Drafts unavailable", "Borradores no disponibles")); }
    finally { draftsLoadingRef.current = false; setDraftsLoading(false); }
  };

  const openVersions = async () => {
    if (versionsLoadingRef.current || restoringVersion) return;
    versionsLoadingRef.current = true;
    setVersionsLoading(true);
    setVersionsOpen(true);
    setVersionsState(t(language, "Loading version history…", "Cargando historial de versiones…"));
    try {
      const response = await fetch("/api/workbook/versions", { cache: "no-store" });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error);
      setVersions(data.versions || []);
      setVersionsState("");
    } catch (reason) {
      setVersionsState(reason instanceof Error ? reason.message : t(language, "Version history is unavailable", "El historial de versiones no está disponible"));
    } finally {
      versionsLoadingRef.current = false;
      setVersionsLoading(false);
    }
  };

  const restoreVersion = async (version: WorkbookVersion) => {
    if (!window.confirm(t(language, `Restore plan version ${version.planVersion}? The current workbook will remain in version history.`, `¿Restaurar la versión ${version.planVersion} del plan? El libro actual permanecerá en el historial.`))) return;
    setRestoringVersion(version.id);
    setVersionsState(t(language, "Restoring version…", "Restaurando versión…"));
    try {
      const response = await fetch("/api/workbook/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: version.id }) });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error);
      setVersionsState(t(language, `Restored as plan version ${data.planVersion}`, `Restaurado como versión ${data.planVersion} del plan`));
      setRefreshRevision((value) => value + 1);
      const refreshed = await fetch("/api/workbook/versions", { cache: "no-store" });
      if (refreshed.ok) setVersions((await readApiResponse(refreshed)).versions || []);
    } catch (reason) {
      setVersionsState(reason instanceof Error ? reason.message : t(language, "The version could not be restored", "No se pudo restaurar la versión"));
    } finally {
      setRestoringVersion("");
    }
  };

  const prepareNavigation = async () => {
    const opening = openingCompletionRef.current;
    if (opening) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ready = await Promise.race([
        opening.promise,
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 30_000); }),
      ]);
      if (timer) clearTimeout(timer);
      if (!ready || !mountedRef.current) {
        if (mountedRef.current) setError(t(language, "Opening the spreadsheet took too long. Try navigating again.", "La apertura de la hoja tardó demasiado. Intenta navegar de nuevo."));
        return false;
      }
      // Opening commits the editor, draft id and imperative handle in a new render.
      // Save through that render's guard before accepting the original navigation.
      return navigationGuardRef.current();
    }
    if (googleBusy || openingEditorRef.current || submittingRef.current || navigationSavingRef.current || savingNow) return false;
    if (!editor || submittedRef.current || googleLocked || !canEdit) return true;
    navigationSavingRef.current = true;
    setSavingNow(true);
    try {
      await persistLatestSnapshot();
      return true;
    } catch (reason) {
      setSaveState(reason instanceof Error ? reason.message : t(language, "Saving failed. Try again.", "No se pudo guardar. Inténtalo de nuevo."));
      return false;
    } finally {
      navigationSavingRef.current = false;
      setSavingNow(false);
    }
  };

  useEffect(() => {
    navigationGuardRef.current = prepareNavigation;
    if (!openingEditor && !openingEditorRef.current) {
      const opening = openingCompletionRef.current;
      openingCompletionRef.current = null;
      opening?.resolve(true);
    }
  });
  useEffect(() => {
    if (!onRegisterNavigationGuard) return;
    onRegisterNavigationGuard(() => navigationGuardRef.current());
    return () => onRegisterNavigationGuard(null);
  }, [onRegisterNavigationGuard]);

  const closeEditor = async (updateRoute = true) => {
    if (!await prepareNavigation()) return false;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setEditor(null);
    setEditorScope(null);
    setEditorRowMaps({});
    setDraftId("");
    setSubmitted(false);
    submittedRef.current = false;
    submittingRef.current = false;
    pendingSnapshotRef.current = null;
    if (mode === "real") setRefreshRevision((value) => value + 1);
    if (updateRoute) {
      // Keep the old destination consumed while the parent updates the URL prop.
      handledRouteRef.current = scopeIdentity(routeScope || null);
      onRouteScopeChange?.(null);
    }
    return true;
  };

  const requestedRouteKey = scopeIdentity(routeScope || null);
  useEffect(() => {
    if (googleBusy || savedBudgetOnly || routeScope === undefined || !payload || handledRouteRef.current === requestedRouteKey) return;
    const requestedScope = routeScope ? { ...routeScope } : null;
    const timer = window.setTimeout(() => void (async () => {
      handledRouteRef.current = requestedRouteKey;
      if (editor && !await closeEditor(false)) {
        handledRouteRef.current = scopeIdentity(editorScope);
        onRouteScopeChange?.(editorScope);
        return;
      }
      if (requestedScope) {
        setGroup(requestedScope.key);
        await openEditor(requestedScope, true);
      }
    })(), 0);
    return () => window.clearTimeout(timer);
    // A route is consumed once; editor and draft saves must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedRouteKey, payload, googleBusy]);

  async function refreshAfterPayment() {
    setPaymentNotice(t(language, "Payment saved. Updating paid totals…", "Pago guardado. Actualizando el total pagado…"));
    setPaymentRefreshFailed(false);
    try {
      if (!await refreshBudget()) {
        if (!mountedRef.current) return;
        throw new Error("Budget refresh superseded");
      }
      setPaymentNotice(t(language, "Payment saved. Paid totals updated.", "Pago guardado. El total pagado se actualizó."));
    } catch {
      setPaymentRefreshFailed(true);
      setPaymentNotice(t(language, "Payment saved. The paid total could not be refreshed.", "Pago guardado. No se pudo actualizar el total pagado."));
    }
  }

  async function refreshAfterGoogle() {
    setGoogleNotice(t(language, "Google updated. Updating paid totals…", "Google actualizado. Actualizando el total pagado…"));
    setGoogleRefreshFailed(false);
    setPaymentHistoryRevision((value) => value + 1);
    try {
      if (!await refreshBudget()) {
        if (!mountedRef.current) return;
        throw new Error("Budget refresh superseded");
      }
      setGoogleNotice(editor
        ? t(language, "Paid totals updated from Google. Your draft is retained.", "Pagado actualizado desde Google. Tu borrador se conserva.")
        : t(language, "Budget updated from Google.", "Presupuesto actualizado desde Google."));
    } catch {
      setGoogleRefreshFailed(true);
      setGoogleNotice(t(language, "Google updated, but the budget could not be refreshed. Retry without synchronizing Google again.", "Google se actualizó, pero no se pudo actualizar el presupuesto. Reintenta sin volver a sincronizar Google."));
    }
  }

  const missingRouteCategory = routeScope && !routeScope.all && payload
    && !payload.lines.some((line) => (line[routeScope.key] || "Unassigned") === routeScope.label)
    ? t(language, `The category “${routeScope.label}” no longer exists in the official budget.`, `La categoría «${routeScope.label}» ya no existe en el presupuesto oficial.`)
    : "";
  const dashboardError = missingRouteCategory || error;

  if (error && !payload && !budgetRefreshing) return <div className="empty-state"><h2>{t(language, "Budget unavailable", "Presupuesto no disponible")}</h2><p role="alert">{error}</p><button className="secondary-button" onClick={() => { setError(""); setRefreshRevision((value) => value + 1); }}>{t(language, "Retry", "Reintentar")}</button><GoogleSheetsEditing language={language} onSynced={() => setRefreshRevision((value) => value + 1)} /></div>;
  if (!payload) return <div className="editor-loading budget-initial-loading" role="status"><BudgetSpinner />{t(language, "Loading budget…", "Cargando presupuesto…")}</div>;
  const openingBlocked = !payload.editingAllowed || savedBudgetOnly || openingEditor || googleBusy || Boolean(restoringVersion);
  const categoryOpening = (label: string) => openingEditor && openingScope?.key === group && (openingScope.all || openingScope.label === label);
  const paymentDialog = paymentContext && canRegisterPayments && <ExpensesWorkspace key={`${paymentContext.budgetLineId}:${paymentContext.paymentId || "new"}`} mode={mode} language={language} projectId={projectId} isOwner paymentContext={paymentContext} onPaymentClose={() => setPaymentContext(null)} onPaymentSaved={async () => { setPaymentHistoryRevision((value) => value + 1); await refreshAfterPayment(); }} />;
  const paymentDetails = selectedPayment && mode === "real" && canViewPurchases && <ExpensePaymentDetails key={selectedPayment.id} payment={selectedPayment} language={language} paymentsModelVersion={payload.paymentsModelVersion} onClose={() => setSelectedPayment(null)} onEdit={canRegisterPayments && !googleBusy && payload.lines.some((line) => line.id === selectedPayment.budgetLineId) ? () => {
    const line = payload.lines.find((candidate) => candidate.id === selectedPayment.budgetLineId);
    if (!line) return;
    setSelectedPayment(null);
    setPaymentContext({ budgetLineId: line.id, item: line.item, paymentId: selectedPayment.id, paymentsModelVersion: payload.paymentsModelVersion });
  } : undefined} />;
  const renderPaymentHistory = mode === "real" && canViewPurchases ? (lineId: string, item: string, showLabel = false) => {
    const line = payload.lines.find((candidate) => candidate.id === lineId);
    return line ? <BudgetLinePayments line={{ ...line, item }} language={language} currency={currency} paymentsModelVersion={payload.paymentsModelVersion} data={paymentHistoryData} onSelectPayment={setSelectedPayment} showLabel={showLabel} onRegisterPayment={canRegisterPayments && !googleBusy ? () => setPaymentContext({ budgetLineId: lineId, item, paymentsModelVersion: payload.paymentsModelVersion }) : undefined} /> : null;
  } : undefined;
  const paymentFeedback = paymentNotice && <div className="budget-payment-notice" role="status">{paymentNotice}{paymentRefreshFailed && <button type="button" className="secondary-button" onClick={() => void refreshAfterPayment()}>{t(language, "Refresh total", "Actualizar total")}</button>}</div>;
  const googleFeedback = googleNotice && <div className="budget-payment-notice" role={googleRefreshFailed ? "alert" : "status"}>{googleNotice}{googleRefreshFailed && <button type="button" className="secondary-button" disabled={googleBusy} onClick={() => void refreshAfterGoogle()}>{t(language, "Refresh budget", "Actualizar presupuesto")}</button>}</div>;
  const googleSyncWarning = payload.googleSyncError && <div className="warning-banner" role="alert"><strong>{t(language, "Showing the saved budget in read-only mode.", "Mostrando el presupuesto guardado en modo de solo lectura.")}</strong> {t(language, "Google changes are pending synchronization. Recorded payments remain included. Retry Google synchronization before editing the budget.", "Los cambios de Google están pendientes de sincronización. Se incluyen los pagos registrados. Reintenta la sincronización con Google antes de editar el presupuesto.")} <span>{payload.googleSyncError}</span></div>;
  const googleSyncProgress = payload.googleSyncPending && !payload.googleSyncError && <div className="budget-payment-notice" role="status"><BudgetSpinner />{t(language, "Showing the saved budget and recorded payments. Updating from Google…", "Mostrando el presupuesto guardado y los pagos registrados. Actualizando desde Google…")}</div>;
  if (editor) return <div className="budget-editor-page">
    <div className="budget-editor-bar">
      <button className="secondary-button" disabled={savingNow || submitting || googleBusy} onClick={() => void closeEditor()}>← {t(language, "Dashboard", "Panel")}</button>
      <span role="status" aria-live="polite">{(savingNow || submitting) && <BudgetSpinner />}{saveState || (editorScope?.all
        ? t(language, `All ${editorScope.key} sheets`, `Todas las hojas por ${editorScope.key === "chapter" ? "capítulo" : editorScope.key === "type" ? "tipo" : "subcategoría"}`)
        : t(language, `${mode === "demo" && editorScope ? demoCategory(editorScope.label || "Category", editorScope.key, language) : editorScope?.label || "Category"} · single category sheet`, `${mode === "demo" && editorScope ? demoCategory(editorScope.label || "Categoría", editorScope.key, language) : editorScope?.label || "Categoría"} · hoja única`))}</span>
      {projectId && <CopyWorkspaceLink language={language} destination={{ projectId, section: "budget", budgetScope: editorScope }} />}
      <a className="secondary-button link-button" onClick={() => trackUsageInteraction("workbook.download")} href={mode === "demo" ? `/demo/House_Planner_Demo_${language}.xlsx` : "/api/workbook/file"}>↓ XLSX</a>
      {mode === "real" && draftId && !submitted && <button className="secondary-button" disabled={googleBusy || savingNow || submitting} onClick={() => setGoogleOpen((value) => !value)}>Google Sheets</button>}
      {draftId && (submitted
        ? <span className="status-chip approved">✓ {isOwner ? t(language, "Published", "Publicado") : t(language, "Submitted", "Enviado")}</span>
        : <><button className="secondary-button" aria-busy={savingNow || (isOwner && submitting)} disabled={savingNow || submitting || googleBusy || googleLocked || savedBudgetOnly} onClick={() => void (isOwner ? submit() : saveNow())}>{savingNow || (isOwner && submitting) ? <><BudgetSpinner />{t(language, "Saving…", "Guardando…")}</> : t(language, "Save", "Guardar")}</button>{!isOwner && <button className="primary-button" aria-busy={submitting} disabled={savingNow || submitting || googleBusy || googleLocked || savedBudgetOnly} onClick={() => void submit()}>{submitting ? <><BudgetSpinner />{t(language, "Submitting…", "Enviando…")}</> : t(language, "Submit draft", "Enviar borrador")}</button>}</>)}
    </div>
    {paymentFeedback}
    {googleFeedback}
    {googleSyncWarning}
    {googleSyncProgress}
    {googleOpen && <GoogleSheetsEditing language={language} busy={savingNow || submitting} onWorkingChange={setGoogleBusy} onSynced={refreshAfterGoogle} />}
    {googleLocked && <p role="status">{t(language, "Editing in Google Sheets. Import changes before continuing here.", "Edición en Google Sheets. Trae los cambios antes de continuar aquí.")}</p>}
    {<BudgetTableEditor key={`${draftId}-${editorGeneration}`} ref={editorHandleRef} data={displayedEditor || editor} language={language} currency={currency} canEdit={canEdit} projectId={projectId} purchaseLines={canViewPurchases ? payload.lines : []} paymentTotals={mode === "real" ? Object.fromEntries(payload.lines.map((line) => [line.id, line.paid])) : undefined} canCreatePurchases={canEdit && canViewPurchases} onRegisterPayment={canRegisterPayments && !googleBusy ? (budgetLineId, item) => setPaymentContext({ budgetLineId, item, paymentsModelVersion: payload.paymentsModelVersion }) : undefined} renderPaymentHistory={renderPaymentHistory} quoteDefaultsAllowed={canEdit && !submitted && !googleBusy && !googleLocked && !savedBudgetOnly} demo={mode === "demo"} formatDemoValue={formatDemoValue} readOnly={!canEdit || submitted || googleBusy || googleLocked || savedBudgetOnly || savingNow || submitting} onSnapshot={(snapshot) => { if (mode === "demo") { void autosave(snapshot); return; } if (autosaveTimer.current) clearTimeout(autosaveTimer.current); autosaveTimer.current = setTimeout(() => void autosave(snapshot), 650); setSaveState(t(language, "Unsaved changes…", "Cambios sin guardar…")); }} />}
    {paymentDialog}
    {paymentDetails}
  </div>;

  return <div className="budget-dashboard">
    <div className="page-intro">
      <div><span className="overline">{t(language, `CONSOLIDATED PLAN + ACTUALS · ${currency}`, `PRESUPUESTO CONSOLIDADO · ${currency}`)}</span><h2>{t(language, "Budget dashboard", "Panel de presupuesto")}</h2><p>{canRegisterPayments ? t(language, "Set objectives and quotes here. Select View payments beside the paid amount to review payments and receipts or add another payment.", "Define objetivos y cotizaciones aquí. Junto al importe pagado, pulsa Ver pagos para consultar pagos y comprobantes o agregar otro pago.") : t(language, "Review objectives, quotes and accumulated payments for each item.", "Consulta objetivos, cotizaciones y pagos acumulados de cada partida.")}</p></div>
      <div className="budget-actions">
        <button className="primary-button" aria-busy={openingEditor} disabled={openingBlocked} onClick={() => void openEditor({ key: group, all: true })}>{openingEditor ? <><BudgetSpinner />{t(language, "Opening…", "Abriendo…")}</> : canEdit ? t(language, "Edit budget", "Editar presupuesto") : t(language, "View budget", "Ver presupuesto")}</button>
        <a className="secondary-button link-button" onClick={() => trackUsageInteraction("workbook.download")} href={mode === "demo" ? `/demo/House_Planner_Demo_${language}.xlsx` : "/api/workbook/file"}>↓ XLSX</a>
        {canEdit && mode === "real" && <button className="secondary-button" aria-busy={draftsLoading} disabled={draftsLoading || openingEditor || googleBusy} aria-expanded={draftsLoading || savedDrafts !== null} onClick={() => void openSavedDrafts()}>{draftsLoading ? <><BudgetSpinner />{t(language, "Loading drafts…", "Cargando borradores…")}</> : t(language, "Saved drafts", "Borradores guardados")}</button>}
        {isOwner && mode === "real" && <button className="secondary-button" aria-busy={versionsLoading} disabled={versionsLoading || openingEditor || googleBusy || Boolean(restoringVersion)} onClick={() => void openVersions()}>{versionsLoading ? <><BudgetSpinner />{t(language, "Loading history…", "Cargando historial…")}</> : t(language, "Version history", "Historial de versiones")}</button>}
        {canViewPurchases && projectId && <a className="secondary-button link-button" href={`${buildWorkspacePath({ projectId, section: "expenses", budgetScope: null })}${mode === "demo" ? "?mode=demo" : ""}`}>{t(language, "All purchases and payments", "Todas las compras y pagos")}</a>}
        {canReplace && <button className="secondary-button" disabled={openingEditor || googleBusy || Boolean(restoringVersion)} onClick={onReplace}>{t(language, "Upload offline XLSX", "Subir XLSX trabajado sin conexión")}</button>}
      </div>
    </div>
    {openingEditor && <div className="budget-action-status" role="status"><BudgetSpinner /><span>{saveState}</span></div>}
    {budgetRefreshing && !openingEditor && !savedBudgetOnly && !googleBusy && <div className="budget-refresh-status" role="status"><BudgetSpinner />{t(language, "Updating budget…", "Actualizando presupuesto…")}</div>}
    {mode === "real" && canEdit && <GoogleSheetsEditing language={language} busy={openingEditor} onWorkingChange={setGoogleBusy} onSynced={refreshAfterGoogle} />}
    {googleSyncWarning}
    {googleSyncProgress}
    {paymentFeedback}
    {googleFeedback}
    {publishNotice && <div className="version-state published-notice" role="status">✓ {publishNotice}</div>}
    {dashboardError && <div className="form-error" role="alert">{dashboardError}</div>}
    {(draftsLoading || savedDrafts) && <section className="budget-version-panel"><h3>{t(language, "Saved drafts", "Borradores guardados")}</h3>{draftsLoading ? <div className="budget-refresh-status" role="status"><BudgetSpinner />{t(language, "Loading saved drafts…", "Cargando borradores guardados…")}</div> : savedDrafts?.length ? <div className="budget-actions">{savedDrafts.map((draft) => <button className="secondary-button" disabled={openingBlocked} key={draft.id} onClick={() => void openAssistantDraft(draft.id, false)}>{draft.scope?.label || t(language, "Budget", "Presupuesto")} · {draft.id.slice(0, 8)}{draft.googleFileId ? " · Google Sheets" : ""}</button>)}</div> : <p>{t(language, "No editable drafts.", "No hay borradores editables.")}</p>}</section>}
    {versionsOpen && <section className="budget-version-panel">
      <div className="section-heading"><div><span>{t(language, "OWNER CONTROLS", "CONTROLES DEL PROPIETARIO")}</span><h3>{t(language, "Workbook version history", "Historial de versiones del libro")}</h3></div><button className="secondary-button" onClick={() => setVersionsOpen(false)}>× {t(language, "Close", "Cerrar")}</button></div>
      <p>{t(language, `Current plan version ${payload.planVersion} · actuals revision ${payload.actualsRevision}`, `Versión actual del plan ${payload.planVersion} · revisión de gastos ${payload.actualsRevision}`)}</p>
      {versionsState && <div className="version-state" role="status">{(versionsLoading || restoringVersion) && <BudgetSpinner />}{versionsState}</div>}
      {!versionsState && versions.length === 0 && <div className="empty-state"><p>{t(language, "No prior workbook versions have been published yet.", "Todavía no se han publicado versiones anteriores del libro.")}</p></div>}
      <div className="budget-version-list">{versions.map((version) => {
        const current = version.planVersion === payload.planVersion && version.actualsRevision === payload.actualsRevision;
        return <article key={version.id}><span><b>{t(language, "Plan", "Plan")} {version.planVersion} · {t(language, "actuals", "gastos")} {version.actualsRevision}</b><small>{version.kind.replaceAll("_", " ")} · {version.createdBy || t(language, "Project owner", "Propietario del proyecto")}{version.createdAt ? ` · ${new Intl.DateTimeFormat(language === "es" ? "es-CR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.createdAt))}` : ""}</small></span>{current ? <em>{t(language, "Current", "Actual")}</em> : <button className="secondary-button" disabled={Boolean(restoringVersion) || versionsLoading || openingEditor || googleBusy} onClick={() => void restoreVersion(version)}>{restoringVersion === version.id ? t(language, "Restoring…", "Restaurando…") : t(language, "Restore", "Restaurar")}</button>}</article>;
      })}</div>
    </section>}
    {payload.unsupported.length > 0 && <div className="warning-banner">{t(language, "Browser editing is disabled to protect unsupported Excel content: ", "La edición web está desactivada para proteger contenido de Excel no compatible: ")}{payload.unsupported.join(", ")}.</div>}
    <div className="budget-metrics">
      <Metric label={t(language, "Objective", "Objetivo")} value={money(payload.objective, language, currency)} />
      <Metric label={t(language, "Quote", "Cotización")} value={money(quoteTotal, language, currency)} />
      <Metric className={payload.excess > 0 ? "danger" : "accent"} label={t(language, "Excess over objective", "Exceso sobre objetivo")} value={money(payload.excess, language, currency)} />
      <Metric label={t(language, "Actual spent", "Gasto real")} value={money(payload.spent, language, currency)} />
      <Metric className={payload.remaining < 0 ? "danger" : "accent"} label={t(language, "Remaining", "Restante")} value={money(payload.remaining, language, currency)} />
      <Metric label={t(language, "Used", "Usado")} value={`${percentage(payload.percentUsed, language)}%`} />
    </div>
    <div className="budget-outside-objective"><span>{t(language, "Outside objective", "Fuera de objetivo")} · <b>{money(payload.outsideObjective?.[currency] || 0, language, currency)}</b>{Boolean(payload.outsideObjective?.[currency === "USD" ? "CRC" : "USD"]) && <> · <b>{money(payload.outsideObjective?.[currency === "USD" ? "CRC" : "USD"] || 0, language, currency === "USD" ? "CRC" : "USD")}</b></>}</span><small>{t(language, "Marked budget lines and additional purchases; separate from the budget objective.", "Partidas marcadas y compras adicionales; separadas del objetivo del presupuesto.")}{Boolean(payload.outsideObjective?.unpricedCount) && ` ${payload.outsideObjective?.unpricedCount} ${t(language, "without amount", "sin monto")}`}</small></div>
    <div className="budget-progress"><i style={{ width: `${Math.min(Math.max(payload.percentUsed, 0), 100)}%` }} /></div>
    <section className="budget-chart-section">
      <div className="budget-chart-heading">
        <div><span className="overline">{t(language, "BUDGET VIEWS", "VISTAS DEL PRESUPUESTO")}</span><h3>{t(language, "Plan and actuals by category", "Presupuesto y gasto por categoría")}</h3><p>{t(language, "Explore categories from the same consolidated budget.", "Explora las categorías del mismo presupuesto consolidado.")}</p></div>
        <div className="segmented">{(["chapter", "type", "subcategory"] as const).map((key) => <button key={key} disabled={openingEditor} aria-pressed={group === key} className={group === key ? "selected" : ""} onClick={() => setGroup(key)}>{t(language, key === "chapter" ? "Chapter" : key === "type" ? "Type" : "Subcategory", key === "chapter" ? "Capítulo" : key === "type" ? "Tipo" : "Subcategoría")}</button>)}</div>
      </div>
      <div className="budget-chart-grid">
        <DonutChart title={t(language, "Planned budget", "Presupuesto planificado")} total={payload.objective} valueKey="objective" items={displayedSummaries} language={language} currency={currency} disabled={openingBlocked} isOpening={categoryOpening} onSelect={(label) => void openEditor({ key: group, label })} />
        <DonutChart title={t(language, "Actual spent", "Gasto real")} total={payload.spent} valueKey="spent" items={displayedSummaries} language={language} currency={currency} disabled={openingBlocked} isOpening={categoryOpening} onSelect={(label) => void openEditor({ key: group, label })} />
      </div>
    </section>
    <section className="budget-lines">
      <div className="section-heading"><div><span>{t(language, "SPREADSHEET LINES", "PARTIDAS DE LA HOJA")}</span><h3>{filtered.length} {t(language, "items", "elementos")}</h3></div><input type="search" aria-label={t(language, "Search budget items", "Buscar partidas")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(language, "Search chapter, supplier, category…", "Buscar capítulo, proveedor, categoría…")} /></div>
      <div className="budget-line-list">{filtered.map((line) => {
        const status = line.excess > 0 ? "over-objective" : "within";
        const displayed = mode === "demo" ? demoDisplayLine(line, language) : line;
        return <div className="budget-line-card" key={line.id}>
          <div className="budget-line-card-heading">
            <button disabled={openingBlocked} aria-busy={categoryOpening(line[group] || "Unassigned")} onClick={() => void openEditor({ key: group, label: line[group] || "Unassigned" })}><b>{displayed.item}</b><small>{displayed.chapter} · {displayed.type} · {displayed.subcategory}</small>{categoryOpening(line[group] || "Unassigned") ? <small className="budget-opening-label"><BudgetSpinner />{t(language, "Opening…", "Abriendo…")}</small> : <small className={status}>{line.outsideObjective ? t(language, "Outside objective", "Fuera de objetivo") : status === "within" ? t(language, "Within objective", "Dentro del objetivo") : `${t(language, "Excess", "Exceso")} ${money(line.excess, language, currency)}`}</small>}</button>
            {renderPaymentHistory?.(line.id, displayed.item, true) || <BudgetPaidAmount amount={line.paid} item={displayed.item} language={language} currency={currency} showLabel />}
          </div>
        </div>;
      })}</div>
    </section>
    {paymentDialog}
    {paymentDetails}
  </div>;
}

function BudgetSpinner() {
  return <span className="budget-spinner" aria-hidden="true" />;
}

function DonutChart({ title, total, items, valueKey, language, currency = "CRC", disabled, isOpening, onSelect }: {
  title: string; total: number; items: Summary[]; valueKey: "objective" | "spent"; language: Language; currency?: Currency; disabled: boolean; isOpening: (label: string) => boolean; onSelect: (label: string) => void;
}) {
  const [tooltip, setTooltip] = useState<Summary | null>(null);
  const visible = items.filter((item) => item[valueKey] > 0);
  const chartTotal = visible.reduce((sum, item) => sum + item[valueKey], 0);
  const percentageContext = valueKey === "spent"
    ? t(language, "of category budget", "del presupuesto de la categoría")
    : t(language, "of the planned total", "del total planificado");
  const displayedPercentage = (item: Summary) => percentage(
    valueKey === "spent"
      ? (item.objective ? item.spent / item.objective * 100 : 0)
      : (chartTotal ? item.objective / chartTotal * 100 : 0),
    language,
  );
  const segments = visible.map((item, index) => ({
    item,
    index,
    fraction: item[valueKey] / chartTotal,
    start: visible.slice(0, index).reduce((sum, previous) => sum + previous[valueKey] / chartTotal, 0),
  }));
  return <article className="budget-chart-card">
    <header><div><span>{title}</span><strong>{money(total, language, currency)}</strong></div><small>{t(language, "View category details", "Ver detalle de categoría")}</small></header>
    {tooltip && <div className="donut-tooltip" role="tooltip"><b>{tooltip.label}</b><span>{money(tooltip[valueKey], language, currency)}</span><small>{displayedPercentage(tooltip)}% {percentageContext} · {tooltip.count} {t(language, tooltip.count === 1 ? "line" : "lines", tooltip.count === 1 ? "partida" : "partidas")}</small></div>}
    {chartTotal > 0 ? <div className="donut-layout">
      <svg className="donut-chart" viewBox="0 0 140 140" role="img" aria-label={title}>
        <circle className="donut-track" cx="70" cy="70" r="54" />
        {segments.map(({ item, index, fraction, start }) => {
          const segment = Math.max(fraction - .006, .002);
          return <circle key={item.label} className="donut-segment" cx="70" cy="70" r="54" pathLength="1" stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeDasharray={`${segment} ${1 - segment}`} strokeDashoffset={-start} tabIndex={disabled ? -1 : 0} role="button" aria-disabled={disabled} aria-busy={isOpening(item.scopeLabel || item.label)} aria-label={`${item.label}: ${money(item[valueKey], language, currency)}`} onMouseEnter={() => setTooltip(item)} onMouseLeave={() => setTooltip(null)} onFocus={() => setTooltip(item)} onBlur={() => setTooltip(null)} onClick={() => { if (!disabled) onSelect(item.scopeLabel || item.label); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disabled) onSelect(item.scopeLabel || item.label); } }}><title>{item.label}: {money(item[valueKey], language, currency)} · {displayedPercentage(item)}% {percentageContext}</title></circle>;
        })}
        <text x="70" y="66" textAnchor="middle" className="donut-center-label">{visible.length}</text>
        <text x="70" y="82" textAnchor="middle" className="donut-center-sub">{t(language, visible.length === 1 ? "category" : "categories", visible.length === 1 ? "categoría" : "categorías")}</text>
      </svg>
      <div className="chart-legend">{visible.map((item, index) => <button key={item.label} disabled={disabled} aria-busy={isOpening(item.scopeLabel || item.label)} onClick={() => onSelect(item.scopeLabel || item.label)}><i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /><span><b>{item.label}</b><small>{money(item[valueKey], language, currency)} · {displayedPercentage(item)}% {percentageContext}</small>{isOpening(item.scopeLabel || item.label) && <small className="budget-opening-label"><BudgetSpinner />{t(language, "Opening…", "Abriendo…")}</small>}</span><em aria-hidden="true">↗</em></button>)}</div>
    </div> : <div className="chart-empty">{t(language, "No actual spending has been entered in the workbook yet.", "Aún no se ha registrado gasto real en el libro.")}</div>}
  </article>;
}

function Metric({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return <div className={className}><span>{label}</span><strong>{value}</strong></div>;
}
