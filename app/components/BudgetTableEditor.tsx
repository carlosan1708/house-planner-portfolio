"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import type { UniverWorkbook } from "@/lib/workbook";
import { addBudgetRow, removeBudgetRow, budgetEditorRows, fillZeroBudgetQuotes, updateBudgetInput } from "@/lib/budget-editor";
import type { UniverEditorHandle } from "./UniverEditor";
import BudgetPaidAmount from "./BudgetPaidAmount";
import "./budget-table-editor.css";

const BudgetTableEditor = forwardRef<UniverEditorHandle, { data: UniverWorkbook; language: "en" | "es"; currency?: "CRC" | "USD"; canEdit: boolean; projectId?: string; purchaseLines?: Array<{ id: string; paid: number }>; paymentTotals?: Record<string, number>; canCreatePurchases?: boolean; onRegisterPayment?: (budgetLineId: string, item: string) => void; renderPaymentHistory?: (lineId: string, item: string) => ReactNode; quoteDefaultsAllowed?: boolean; readOnly?: boolean; demo?: boolean; formatDemoValue?: (value: string, column: number, rowId?: string) => string; onSnapshot: (snapshot: UniverWorkbook) => void }>(function BudgetTableEditor({ data, language, currency = "CRC", canEdit, projectId, purchaseLines = [], paymentTotals, canCreatePurchases = false, onRegisterPayment, renderPaymentHistory, readOnly, quoteDefaultsAllowed = !readOnly, demo = false, formatDemoValue, onSnapshot }, ref) {
  const [snapshot, setSnapshot] = useState(data);
  const current = useRef(data);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const invalid = useRef(new Set<string>());
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [destination, setDestination] = useState(data.sheetOrder[0]);
  const [newItem, setNewItem] = useState("");
  const [newChapter, setNewChapter] = useState("");
  const [newType, setNewType] = useState("");
  const [newSubcategory, setNewSubcategory] = useState("");
  const [removed, setRemoved] = useState<{ sheetId: string; row: number; cells: UniverWorkbook["sheets"][string]["cellData"][number] } | null>(null);
  const es = language === "es";
  const errorCopies = [
    ["Enter a valid amount, zero or greater.", "Introduce un importe válido, igual o mayor que cero."],
    ["Enter chapter and item.", "Completa el capítulo y la partida."],
  ];
  const errorCopy = demo ? errorCopies.find((copy) => copy.includes(error)) : undefined;
  const displayedError = errorCopy ? errorCopy[es ? 1 : 0] : error;
  const heading = canEdit ? (es ? "Editar presupuesto" : "Edit budget") : (es ? "Ver presupuesto" : "View budget");
  const description = !canEdit
    ? (es ? "Puedes buscar y consultar las partidas del presupuesto en modo de solo lectura." : "You can search and review budget items in read-only mode.")
    : demo ? (es ? "Los cambios actualizan este panel de demostración." : "Changes update this demo dashboard.") : es ? "Los cambios se guardan en un borrador. Pulsa Guardar o envía para aplicar los cambios al presupuesto consolidado." : "Changes are saved in a draft. Use Save or submit to apply changes to the consolidated budget.";
  useImperativeHandle(ref, () => ({
    getSnapshot: () => current.current,
    getActiveSheet: () => ({ id: data.sheetOrder[0], name: data.sheets[data.sheetOrder[0]].name }),
    commitPendingEdit: async () => {
      if (invalid.current.size) throw new Error(es ? "Corrige el importe antes de guardar." : "Correct the amount before saving.");
      // Save temporarily disables inputs; persistent draft permissions govern defaults.
      const previous = current.current;
      const next = canEdit && quoteDefaultsAllowed && !demo ? fillZeroBudgetQuotes(previous, projectId) : previous;
      if (next !== previous) {
        current.current = next;
        setSnapshot(next);
        setAmountInputs((inputs) => {
          const updated = { ...inputs };
          for (const { sheetId, row, cells } of budgetEditorRows(next)) {
            if (cells[6]?.v !== previous.sheets[sheetId].cellData[row]?.[6]?.v) delete updated[`${sheetId}:${row}:6`];
          }
          return updated;
        });
        onSnapshot(next);
      }
      return next;
    },
  }));
  const displayedValue = (cells: UniverWorkbook["sheets"][string]["cellData"][number], column: number) => {
    const value = String(cells[column]?.v || "");
    return demo && formatDemoValue ? formatDemoValue(value, column, String(cells[25]?.v || "")) : value;
  };
  const formValue = (value: string, column: number) => demo && formatDemoValue ? formatDemoValue(value, column) : value;
  const rows = budgetEditorRows(snapshot).filter(({ cells }) => [0, 1, 2, 3, 10].some((column) => `${displayedValue(cells, column)} ${String(cells[column]?.v || "")}`.toLowerCase().includes(query.toLowerCase())));
  function change(sheetId: string, row: number, column: number, value: string) {
    const field = `${sheetId}:${row}:${column}`;
    if ([4, 6, 9].includes(column)) setAmountInputs((inputs) => ({ ...inputs, [field]: value }));
    try {
      const next = updateBudgetInput(current.current, sheetId, row, column, value);
      current.current = next; setSnapshot(next); invalid.current.delete(field); if (!invalid.current.size) setError(""); onSnapshot(next);
    } catch { invalid.current.add(field); setError(es ? "Introduce un importe válido, igual o mayor que cero." : "Enter a valid amount, zero or greater."); }
  }
  function apply(next: UniverWorkbook) { current.current = next; setSnapshot(next); onSnapshot(next); }
  function beginAdd() {
    const first = budgetEditorRows(current.current).find((entry) => entry.sheetId === destination);
    setNewChapter(String(first?.cells[0]?.v || "")); setNewType(String(first?.cells[2]?.v || "")); setNewSubcategory(String(first?.cells[3]?.v || "")); setNewItem(""); setAdding(true);
  }
  return <section className="budget-table-editor">
    <div className="section-heading"><div><h3>{heading}</h3><p>{description}{renderPaymentHistory && <> {es ? "En Pagado, pulsa Ver pagos para consultar el historial o agregar un pago con comprobante." : "Under Paid, select View payments to review history or add a payment with a receipt."}</>}</p></div><input aria-label={es ? "Buscar partidas" : "Search budget items"} placeholder={es ? "Buscar partidas…" : "Search items…"} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {!readOnly && <div className="budget-actions"><button className="primary-button" onClick={beginAdd}>{es ? "Agregar partida" : "Add item"}</button></div>}
    {adding && !readOnly && <form className="budget-add-form" onSubmit={(event) => { event.preventDefault(); try { apply(addBudgetRow(current.current, destination, { chapter: newChapter, item: newItem, type: newType, subcategory: newSubcategory }, crypto.randomUUID())); setAdding(false); setQuery(""); } catch { setError(es ? "Completa el capítulo y la partida." : "Enter chapter and item."); } }}>
      <label>{es ? "Categoría de destino" : "Destination category"}<select value={destination} onChange={(event) => { setDestination(event.target.value); const first = budgetEditorRows(current.current).find((entry) => entry.sheetId === event.target.value); setNewChapter(String(first?.cells[0]?.v || "")); setNewType(String(first?.cells[2]?.v || "")); setNewSubcategory(String(first?.cells[3]?.v || "")); }}>{snapshot.sheetOrder.filter((id) => !snapshot.sheets[id].hidden).map((id) => <option value={id} key={id}>{formValue(snapshot.sheets[id].name, -1)}</option>)}</select></label>
      <label>{es ? "Partida" : "Item"}<input required autoFocus value={newItem} onChange={(event) => setNewItem(event.target.value)} /></label>
      <label>{es ? "Capítulo" : "Chapter"}<input required value={formValue(newChapter, 0)} onChange={(event) => setNewChapter(event.target.value)} /></label>
      <label>{es ? "Tipo" : "Type"}<input value={formValue(newType, 2)} onChange={(event) => setNewType(event.target.value)} /></label>
      <label>{es ? "Subcategoría" : "Subcategory"}<input value={formValue(newSubcategory, 3)} onChange={(event) => setNewSubcategory(event.target.value)} /></label>
      <div className="budget-actions"><button className="primary-button" type="submit">{es ? "Crear partida" : "Create item"}</button><button className="secondary-button" type="button" onClick={() => setAdding(false)}>{es ? "Cancelar" : "Cancel"}</button></div>
    </form>}
    {removed && <div role="status" className="budget-actions"><span>{es ? "Partida quitada del borrador. Los recibos se conservan." : "Item removed from draft. Receipts are retained."}</span><button className="secondary-button" disabled={readOnly} onClick={() => { const next = structuredClone(current.current); next.sheets[removed.sheetId].cellData[removed.row] = removed.cells; apply(next); setRemoved(null); }}>{es ? "Deshacer" : "Undo"}</button></div>}
    {error && <p role="alert" className="form-error">{displayedError}</p>}
    <div className="budget-table-scroll" tabIndex={0} role="region" aria-label={es ? "Partidas del presupuesto" : "Budget items"}><table><thead><tr>{(es ? ["Partida / categoría", `Objetivo · ${currency}`, `Cotización · ${currency}`, `Pagado · ${currency}`, "Estado", "Proveedor / nota"] : ["Item / category", `Objective · ${currency}`, `Quote · ${currency}`, `Paid · ${currency}`, "Status", "Supplier / note"]).map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {rows.map(({ sheetId, row, cells }) => <tr key={`${sheetId}-${row}`}><th scope="row"><b>{displayedValue(cells, 1)}</b><small>{displayedValue(cells, 0)} · {displayedValue(cells, 3)}</small><div className="budget-item-actions"><label className="budget-outside-toggle"><input type="checkbox" aria-label={`${displayedValue(cells, 1)} ${es ? "Fuera de objetivo" : "Outside objective"}`} checked={Number(cells[26]?.v) === 1} disabled={readOnly || Boolean(cells[26]?.f)} onChange={(event) => change(sheetId, row, 26, event.target.checked ? "1" : "0")} />{es ? "Fuera de objetivo" : "Outside objective"}</label>{projectId && canCreatePurchases && String(cells[25]?.v || "").startsWith("new:") && <small>{es ? "Guarda y aplica la partida antes de registrar pagos." : "Save and apply the item before recording payments."}</small>}{!readOnly && <button className="budget-remove-row" aria-label={`${es ? "Quitar" : "Remove"} ${displayedValue(cells, 1)}`} onClick={() => { setRemoved({ sheetId, row, cells: structuredClone(cells) }); for (const key of invalid.current) if (key.startsWith(`${sheetId}:${row}:`)) invalid.current.delete(key); if (!invalid.current.size) setError(""); apply(removeBudgetRow(current.current, sheetId, row)); }}>{es ? "Quitar" : "Remove"}</button>}</div></th>
        {[4, 6, 9].map((column) => <td key={column} className={column === 9 ? "budget-paid-cell" : undefined} data-label={column === 4 ? (es ? `Objetivo · ${currency}` : `Objective · ${currency}`) : column === 6 ? (es ? `Cotización · ${currency}` : `Quote · ${currency}`) : (es ? `Pagado · ${currency}` : `Paid · ${currency}`)}>{column === 9 && paymentTotals ? renderPaymentHistory?.(String(cells[25]?.v || ""), displayedValue(cells, 1)) || <BudgetPaidAmount amount={paymentTotals[String(cells[25]?.v || "")] ?? 0} item={displayedValue(cells, 1)} language={language} currency={currency} onRegisterPayment={onRegisterPayment && purchaseLines.some((line) => line.id === String(cells[25]?.v || "")) ? () => onRegisterPayment(String(cells[25].v), displayedValue(cells, 1)) : undefined} unpublished={Boolean(onRegisterPayment) && String(cells[25]?.v || "").startsWith("new:")} /> : <input aria-label={`${displayedValue(cells, 1)} ${column === 4 ? (es ? "Objetivo" : "Objective") : column === 6 ? (es ? "Cotización" : "Quote") : (es ? "Pagado" : "Paid")}`} type="number" min="0" step="any" value={column === 9 && paymentTotals ? String(paymentTotals[String(cells[25]?.v || "").replace(/^new:/, "")] ?? 0) : amountInputs[`${sheetId}:${row}:${column}`] ?? String(Number(cells[column]?.v || 0))} aria-invalid={invalid.current.has(`${sheetId}:${row}:${column}`)} disabled={readOnly || column === 9 && Boolean(paymentTotals) || Boolean(cells[column]?.f)} title={column === 9 && paymentTotals ? (es ? "Calculado a partir del historial de pagos" : "Calculated from payment history") : cells[column]?.f ? (es ? "Fórmula: edita en Google Sheets" : "Formula: edit in Google Sheets") : undefined} onChange={(event) => change(sheetId, row, column, event.target.value)} />}</td>)}
        <td data-label={es ? "Estado" : "Status"}><select aria-label={`${displayedValue(cells, 1)} ${es ? "Estado" : "Status"}`} disabled={readOnly || Boolean(cells[8]?.f)} value={String(cells[8]?.v || "Pendiente")} onChange={(event) => change(sheetId, row, 8, event.target.value)}>{["Pendiente", "En progreso", "Completada"].map((status, index) => <option key={status} value={status}>{es ? status : ["Pending", "In progress", "Completed"][index]}</option>)}</select></td>
        <td className="budget-note-cell" data-label={es ? "Proveedor / nota" : "Supplier / note"}><textarea rows={3} aria-label={`${displayedValue(cells, 1)} ${es ? "Proveedor / nota" : "Supplier / note"}`} placeholder={es ? "Proveedor, contacto, alcance o nota…" : "Supplier, contact, scope, or note…"} disabled={readOnly || Boolean(cells[10]?.f)} value={displayedValue(cells, 10)} onChange={(event) => change(sheetId, row, 10, event.target.value)} /><small>{es ? "Admite varias líneas" : "Multiple lines allowed"}</small></td></tr>)}
    </tbody></table></div>
    {!rows.length && <p>{es ? "No hay partidas que coincidan." : "No matching budget items."}</p>}
  </section>;
});
export default BudgetTableEditor;
