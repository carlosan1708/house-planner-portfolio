"use client";

import { useState } from "react";
import { projectCurrency, type ProjectCurrency } from "@/lib/currency";
import ModalOverlay from "./ModalOverlay";

export type CurrencyProject = { id: string; name: string; currency?: ProjectCurrency; currencyRevision?: number; currencyLocked?: boolean };

export function CurrencySelect({ value, onChange, disabled, language }: { value: ProjectCurrency; onChange: (value: ProjectCurrency) => void; disabled?: boolean; language: "en" | "es" }) {
  return <label><span>{language === "es" ? "Moneda del proyecto" : "Project currency"}</span><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as ProjectCurrency)}><option value="USD">USD — {language === "es" ? "Dólar estadounidense" : "US dollar"}</option><option value="CRC">CRC — {language === "es" ? "Colón costarricense" : "Costa Rican colón"}</option></select></label>;
}

export default function ProjectCurrencyDialog({ project, language, busy, onSave, onClose }: { project: CurrencyProject; language: "en" | "es"; busy: boolean; onSave: (project: CurrencyProject, currency: ProjectCurrency, confirmDenominationCorrection: boolean) => Promise<boolean>; onClose: () => void }) {
  const [currency, setCurrency] = useState(projectCurrency(project.currency));
  const [confirmed, setConfirmed] = useState(false);
  const changed = currency !== projectCurrency(project.currency);
  const requiresConfirmation = project.currencyLocked && changed;
  const es = language === "es";
  const close = () => { if (!busy) onClose(); };
  return <ModalOverlay className="confirm-modal" role="dialog" aria-modal="true" aria-label={es ? "Configuración del proyecto" : "Project settings"} onMouseDown={close} onEscape={close}>
    <form className="confirm-card project-create-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!changed || requiresConfirmation && !confirmed) return; void onSave(project, currency, Boolean(requiresConfirmation && confirmed)).then((saved) => { if (saved) onClose(); }); }}>
      <span className="overline">{es ? "CONFIGURACIÓN DEL PROYECTO" : "PROJECT SETTINGS"}</span><h3>{project.name}</h3>
      <CurrencySelect value={currency} onChange={(value) => { setCurrency(value); setConfirmed(false); }} language={language} disabled={busy} />
      <p>{es ? "La moneda se aplica al presupuesto, los pagos y las exportaciones de Excel. El idioma se elige por separado. No se convierten importes automáticamente." : "Currency applies to the budget, payments and Excel exports. Language is selected separately. Amounts are never converted automatically."}</p>
      {project.currencyLocked && <p>{es ? "Este proyecto ya tiene trabajo financiero. La corrección conserva todos los números del presupuesto y los pagos y crea una versión nueva. Las compras y los comprobantes conservan sus monedas. Los borradores y propuestas anteriores deben abrirse de nuevo." : "This project already has financial work. A correction keeps every budget and payment number unchanged and creates a new version. Purchases and receipts retain their own currencies. Existing drafts and proposals must be reopened."}</p>}
      {requiresConfirmation && <label className="project-currency-confirmation"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>{es ? `Confirmo corregir la denominación de ${projectCurrency(project.currency)} a ${currency}, manteniendo todos los importes sin conversión.` : `I confirm correcting the denomination from ${projectCurrency(project.currency)} to ${currency}, keeping all amounts without conversion.`}</span></label>}
      <div className="confirm-actions"><button type="button" className="secondary-button" disabled={busy} onClick={close}>{es ? "Cerrar" : "Close"}</button><button type="submit" className="primary-button" disabled={busy || !changed || Boolean(requiresConfirmation && !confirmed)}>{busy ? (es ? "Guardando…" : "Saving…") : (es ? "Guardar moneda" : "Save currency")}</button></div>
    </form>
  </ModalOverlay>;
}
