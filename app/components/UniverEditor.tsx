"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { UniverWorkbook } from "@/lib/workbook";
import { BUDGET_PROGRESS_APPEARANCE, normalizeBudgetProgressStatus, type BudgetProgressStatus } from "@/lib/budget-progress";
import UiEn from "@univerjs/ui/locale/en-US"; import UiEs from "@univerjs/ui/locale/es-ES";
import SheetsEn from "@univerjs/sheets/locale/en-US"; import SheetsEs from "@univerjs/sheets/locale/es-ES";
import SheetsUiEn from "@univerjs/sheets-ui/locale/en-US"; import SheetsUiEs from "@univerjs/sheets-ui/locale/es-ES";
import FormulaEn from "@univerjs/sheets-formula/locale/en-US"; import FormulaEs from "@univerjs/sheets-formula/locale/es-ES";
import FormulaUiEn from "@univerjs/sheets-formula-ui/locale/en-US"; import FormulaUiEs from "@univerjs/sheets-formula-ui/locale/es-ES";
import NumfmtUiEn from "@univerjs/sheets-numfmt-ui/locale/en-US"; import NumfmtUiEs from "@univerjs/sheets-numfmt-ui/locale/es-ES";
import ValidationEn from "@univerjs/sheets-data-validation-ui/locale/en-US"; import ValidationEs from "@univerjs/sheets-data-validation-ui/locale/es-ES";
import ConditionalEn from "@univerjs/sheets-conditional-formatting-ui/locale/en-US"; import ConditionalEs from "@univerjs/sheets-conditional-formatting-ui/locale/es-ES";
import FilterEn from "@univerjs/sheets-filter-ui/locale/en-US"; import FilterEs from "@univerjs/sheets-filter-ui/locale/es-ES";
import TableEn from "@univerjs/sheets-table-ui/locale/en-US"; import TableEs from "@univerjs/sheets-table-ui/locale/es-ES";
import FindEn from "@univerjs/find-replace/locale/en-US"; import FindEs from "@univerjs/find-replace/locale/es-ES";
import CommentEn from "@univerjs/thread-comment-ui/locale/en-US"; import CommentEs from "@univerjs/thread-comment-ui/locale/es-ES";
import SheetCommentEn from "@univerjs/sheets-thread-comment-ui/locale/en-US"; import SheetCommentEs from "@univerjs/sheets-thread-comment-ui/locale/es-ES";
import "@univerjs/design/lib/index.css"; import "@univerjs/ui/lib/index.css"; import "@univerjs/docs-ui/lib/index.css"; import "@univerjs/sheets-ui/lib/index.css"; import "@univerjs/sheets-formula-ui/lib/index.css"; import "@univerjs/sheets-numfmt-ui/lib/index.css";
import "@univerjs/sheets-data-validation-ui/lib/index.css"; import "@univerjs/sheets-conditional-formatting-ui/lib/index.css"; import "@univerjs/sheets-filter-ui/lib/index.css"; import "@univerjs/sheets-table-ui/lib/index.css"; import "@univerjs/find-replace/lib/index.css"; import "@univerjs/thread-comment-ui/lib/index.css"; import "@univerjs/sheets-thread-comment-ui/lib/index.css";

export type UniverActiveSheet = { id: string; name: string };
export type UniverEditorHandle = {
  getSnapshot: () => UniverWorkbook | null;
  commitPendingEdit: () => Promise<UniverWorkbook | null>;
  getActiveSheet: () => UniverActiveSheet | null;
};

const UniverEditor = forwardRef<UniverEditorHandle, { data: UniverWorkbook; language: "en" | "es"; readOnly?: boolean; initialActiveSheet?: UniverActiveSheet | null; onSnapshot?: (snapshot: UniverWorkbook) => void }>(function UniverEditor({ data, language, readOnly, initialActiveSheet, onSnapshot }, ref) {
  const container = useRef<HTMLDivElement>(null); const snapshotCallback = useRef(onSnapshot);
  const initialActiveSheetId = initialActiveSheet?.id;
  const initialActiveSheetName = initialActiveSheet?.name;
  const snapshotGetter = useRef<(() => UniverWorkbook) | null>(null);
  const commitPendingEdit = useRef<(() => Promise<UniverWorkbook>) | null>(null);
  const activeSheetGetter = useRef<(() => UniverActiveSheet) | null>(null);
  useEffect(() => { snapshotCallback.current = onSnapshot; }, [onSnapshot]);
  useImperativeHandle(ref, () => ({
    getSnapshot: () => snapshotGetter.current?.() || null,
    commitPendingEdit: async () => commitPendingEdit.current ? commitPendingEdit.current() : null,
    getActiveSheet: () => activeSheetGetter.current?.() || null,
  }), []);
  useEffect(() => {
    if (!container.current) return;
    let disposed = false; let timer: ReturnType<typeof setInterval> | undefined; let statusStyleTimer: ReturnType<typeof setInterval> | undefined; let destroy: (() => void) | undefined; let lastSerialized = "";
    void (async () => {
      const [core, coreFacade, themes, render, formula, ui, docs, docsUi, sheets, sheetsUi, sheetsFormula, sheetsFormulaUi, numfmt, numfmtUi, validation, validationUi, conditional, conditionalUi, filter, filterUi, table, tableUi, find, sheetsFind, comments, commentsUi, sheetComments, sheetCommentsUi] = await Promise.all([
        import("@univerjs/core"), import("@univerjs/core/facade"), import("@univerjs/themes"), import("@univerjs/engine-render"), import("@univerjs/engine-formula"), import("@univerjs/ui"), import("@univerjs/docs"), import("@univerjs/docs-ui"), import("@univerjs/sheets"), import("@univerjs/sheets-ui"), import("@univerjs/sheets-formula"), import("@univerjs/sheets-formula-ui"), import("@univerjs/sheets-numfmt"), import("@univerjs/sheets-numfmt-ui"), import("@univerjs/sheets-data-validation"), import("@univerjs/sheets-data-validation-ui"), import("@univerjs/sheets-conditional-formatting"), import("@univerjs/sheets-conditional-formatting-ui"), import("@univerjs/sheets-filter"), import("@univerjs/sheets-filter-ui"), import("@univerjs/sheets-table"), import("@univerjs/sheets-table-ui"), import("@univerjs/find-replace"), import("@univerjs/sheets-find-replace"), import("@univerjs/thread-comment"), import("@univerjs/thread-comment-ui"), import("@univerjs/sheets-thread-comment"), import("@univerjs/sheets-thread-comment-ui"), import("@univerjs/sheets-data-validation/facade"),
      ]);
      if (disposed || !container.current) return;
      const isSpanish = language === "es"; const locale = isSpanish ? core.LocaleType.ES_ES : core.LocaleType.EN_US;
      const locales = isSpanish ? core.mergeLocales(UiEs, SheetsEs, SheetsUiEs, FormulaEs, FormulaUiEs, NumfmtUiEs, ValidationEs, ConditionalEs, FilterEs, TableEs, FindEs, CommentEs, SheetCommentEs) : core.mergeLocales(UiEn, SheetsEn, SheetsUiEn, FormulaEn, FormulaUiEn, NumfmtUiEn, ValidationEn, ConditionalEn, FilterEn, TableEn, FindEn, CommentEn, SheetCommentEn);
      const univer = new core.Univer({ theme: themes.defaultTheme, locale, locales: { [locale]: locales }, logLevel: core.LogLevel.ERROR });
      univer.registerPlugin(render.UniverRenderEnginePlugin); univer.registerPlugin(formula.UniverFormulaEnginePlugin); univer.registerPlugin(ui.UniverUIPlugin, { container: container.current }); univer.registerPlugin(docs.UniverDocsPlugin); univer.registerPlugin(docsUi.UniverDocsUIPlugin); univer.registerPlugin(sheets.UniverSheetsPlugin); univer.registerPlugin(sheetsUi.UniverSheetsUIPlugin, { menu: readOnly ? { "sheet.command.insert-row": { hidden: true } } : undefined }); univer.registerPlugin(sheetsFormula.UniverSheetsFormulaPlugin); univer.registerPlugin(sheetsFormulaUi.UniverSheetsFormulaUIPlugin); univer.registerPlugin(numfmt.UniverSheetsNumfmtPlugin); univer.registerPlugin(numfmtUi.UniverSheetsNumfmtUIPlugin);
      univer.registerPlugin(validation.UniverSheetsDataValidationPlugin); univer.registerPlugin(validationUi.UniverSheetsDataValidationUIPlugin); univer.registerPlugin(conditional.UniverSheetsConditionalFormattingPlugin); univer.registerPlugin(conditionalUi.UniverSheetsConditionalFormattingUIPlugin); univer.registerPlugin(filter.UniverSheetsFilterPlugin); univer.registerPlugin(filterUi.UniverSheetsFilterUIPlugin); univer.registerPlugin(table.UniverSheetsTablePlugin); univer.registerPlugin(tableUi.UniverSheetsTableUIPlugin); univer.registerPlugin(find.UniverFindReplacePlugin); univer.registerPlugin(sheetsFind.UniverSheetsFindReplacePlugin); univer.registerPlugin(comments.UniverThreadCommentPlugin); univer.registerPlugin(commentsUi.UniverThreadCommentUIPlugin); univer.registerPlugin(sheetComments.UniverSheetsThreadCommentPlugin); univer.registerPlugin(sheetCommentsUi.UniverSheetsThreadCommentUIPlugin);
      const unit = univer.createUnit(core.UniverInstanceType.UNIVER_SHEET, data) as unknown as {
        getSnapshot(): UniverWorkbook;
        getUnitId(): string;
        getActiveSheet(): { getSheetId(): string; getName(): string };
        getSheetBySheetId(id: string): { getSheetId(): string } | null;
        getSheetBySheetName(name: string): { getSheetId(): string } | null;
      };
      const univerAPI = coreFacade.FUniver.newAPI(univer);
      const preferredSheet = initialActiveSheetId && initialActiveSheetName
        ? unit.getSheetBySheetName(initialActiveSheetName) || unit.getSheetBySheetId(initialActiveSheetId)
        : null;
      if (preferredSheet) {
        await univerAPI.executeCommand(sheets.SetWorksheetActiveOperation.id, {
          unitId: unit.getUnitId(),
          subUnitId: preferredSheet.getSheetId(),
        });
      }
      if (!readOnly) {
        type ValidationBuilder = {
          requireValueInList(values: string[], multiple?: boolean, showDropdown?: boolean): ValidationBuilder;
          setOptions(options: { allowBlank: boolean; showErrorMessage: boolean; error: string }): ValidationBuilder;
          build(): unknown;
        };
        type RangeApi = {
          setDataValidation(rule: unknown): unknown;
          setBackgroundColor(color: string): RangeApi;
          setFontColor(color: string | null): RangeApi;
          setFontWeight(weight: "bold" | "normal" | null): RangeApi;
          setValue(value: string): RangeApi;
        };
        type WorksheetApi = {
          getSheetName(): string;
          getRange(a1: string): RangeApi;
        };
        type ValidationApi = {
          getActiveWorkbook(): { getSheets(): WorksheetApi[] };
          newDataValidation(): ValidationBuilder;
        };
        const validationApi = univerAPI as unknown as ValidationApi;
        const statusRule = validationApi.newDataValidation()
          .requireValueInList(["Pendiente", "En progreso", "Completada"], false, true)
          .setOptions({ allowBlank: false, showErrorMessage: true, error: isSpanish ? "Seleccioná un estado de la lista." : "Select a status from the list." })
          .build();
        const worksheets = validationApi.getActiveWorkbook().getSheets();
        for (const worksheet of worksheets) {
          const sheetSnapshot = Object.values(data.sheets).find((sheet) => sheet.name === worksheet.getSheetName());
          const header = String(sheetSnapshot?.cellData?.[2]?.[8]?.v || "").trim().toLowerCase();
          if (!sheetSnapshot || !["estado", "status"].includes(header)) continue;
          const lineRows = Object.entries(sheetSnapshot.cellData).flatMap(([rowIndex, cells]) => {
            const chapter = String(cells[0]?.v || "").trim(); const item = String(cells[1]?.v || "").trim();
            return Number(rowIndex) >= 3 && chapter && item && !/^total/i.test(chapter) ? [Number(rowIndex) + 1] : [];
          });
          if (!lineRows.length) continue;
          const firstRow = Math.min(...lineRows); const lastRow = Math.max(...lineRows);
          worksheet.getRange(`I${firstRow}:I${lastRow}`).setDataValidation(statusRule);
        }
        const displayedStatuses = new Map<string, BudgetProgressStatus>();
        const displayedCounts = new Map<string, string>();
        const synchronizeProgressFormatting = () => {
          const snapshot = unit.getSnapshot();
          for (const worksheet of worksheets) {
            const sheet = Object.values(snapshot.sheets).find((candidate) => candidate.name === worksheet.getSheetName());
            const header = String(sheet?.cellData?.[2]?.[8]?.v || "").trim().toLowerCase();
            if (!sheet || !["estado", "status"].includes(header)) continue;
            const counts: Record<BudgetProgressStatus, number> = { Completada: 0, "En progreso": 0, Pendiente: 0 };
            for (const [rowIndexText, cells] of Object.entries(sheet.cellData)) {
              const rowIndex = Number(rowIndexText); const chapter = String(cells[0]?.v || "").trim(); const item = String(cells[1]?.v || "").trim();
              if (rowIndex < 3 || !chapter || !item || /^total/i.test(chapter)) continue;
              const status = normalizeBudgetProgressStatus(cells[8]?.v); counts[status] += 1;
              const key = `${sheet.id}:${rowIndex}`;
              if (displayedStatuses.get(key) === status) continue;
              displayedStatuses.set(key, status);
              const appearance = BUDGET_PROGRESS_APPEARANCE[status]; const row = rowIndex + 1;
              worksheet.getRange(`A${row}:R${row}`).setBackgroundColor(appearance.row).setFontColor(appearance.text).setFontWeight("normal");
              worksheet.getRange(`I${row}`).setBackgroundColor(appearance.cell).setFontColor(appearance.text).setFontWeight("bold");
            }
            const countKey = `${counts.Completada}:${counts["En progreso"]}:${counts.Pendiente}`;
            if (displayedCounts.get(sheet.id) === countKey) continue;
            displayedCounts.set(sheet.id, countKey);
            worksheet.getRange("I2").setValue(isSpanish ? `✓ ${counts.Completada} ${counts.Completada === 1 ? "completada" : "completadas"}` : `✓ ${counts.Completada} completed`);
            worksheet.getRange("K2").setValue(isSpanish ? `◐ ${counts["En progreso"]} en progreso` : `◐ ${counts["En progreso"]} in progress`);
            worksheet.getRange("M2").setValue(isSpanish ? `○ ${counts.Pendiente} ${counts.Pendiente === 1 ? "pendiente" : "pendientes"}` : `○ ${counts.Pendiente} pending`);
          }
        };
        synchronizeProgressFormatting();
        statusStyleTimer = setInterval(synchronizeProgressFormatting, 200);
      }
      snapshotGetter.current = () => unit.getSnapshot();
      activeSheetGetter.current = () => {
        const sheet = unit.getActiveSheet();
        return { id: sheet.getSheetId(), name: sheet.getName() };
      };
      lastSerialized = JSON.stringify(unit.getSnapshot());
      commitPendingEdit.current = async () => {
        await univerAPI.executeCommand(sheetsUi.SetCellEditVisibleOperation.id, {
          visible: false,
          eventType: render.DeviceInputEventType.PointerDown,
          unitId: unit.getUnitId(),
        });
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        const snapshot = unit.getSnapshot();
        lastSerialized = JSON.stringify(snapshot);
        return snapshot;
      };
      timer = setInterval(() => { if (readOnly || !snapshotCallback.current) return; const snapshot = unit.getSnapshot(); const serialized = JSON.stringify(snapshot); if (serialized !== lastSerialized) { lastSerialized = serialized; snapshotCallback.current(snapshot); } }, 2500);
      destroy = () => univer.dispose();
    })();
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      if (statusStyleTimer) clearInterval(statusStyleTimer);
      if (!readOnly && snapshotGetter.current && snapshotCallback.current) {
        const snapshot = snapshotGetter.current();
        const serialized = JSON.stringify(snapshot);
        if (serialized !== lastSerialized) snapshotCallback.current(snapshot);
      }
      snapshotGetter.current = null;
      commitPendingEdit.current = null;
      activeSheetGetter.current = null;
      const dispose = destroy;
      if (dispose) window.setTimeout(dispose, 0);
    };
  }, [data, language, readOnly, initialActiveSheetId, initialActiveSheetName]);
  return <div className="univer-host" ref={container} />;
});

export default UniverEditor;
