import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore, projectBucket } from "./firebase-admin";
import { CONFIG, EXPENSE_PAYMENTS, PROJECTS, WORKBOOK_VERSIONS, projectConfigDoc, projectStoragePrefix } from "./project";
import { PAYMENT_PROJECTION_SHEET, stripPaymentProjectionAgainstBaseline, stripUnifiedPaymentWorkbookProjection } from "./payment-workbook";
import { loadWorkbook, readBudgetLines, setWorkbookCurrency, writeWorkbook } from "./workbook";
import { readProjectCurrency } from "./project-currency";
import { flushPaymentProjection, PaymentLedgerConflict, prepareWorkbookPaymentChange, readPaymentLedgerState } from "./expense-ledger";
import { connectedGoogle, serviceGoogle, createGoogleFolder, createGoogleWorkbook, readStableGoogleWorkbook, googleConfigured, googleFileState, updateGoogleWorkbook } from "./google-sheets";
import { consolidatedWorkbook, needsGoogleRowIdentities } from "./consolidated-workbook";
import { reconcileBudgetMetadata, sameBudgetContent } from "./google-budget-content";

export const googleBudgetRef = (projectId: string) => firestore.collection("housePlannerGoogleBudgets").doc(projectId);
export const googleSyncMessage = (error: unknown) => error instanceof Error && !("response" in error) && !("config" in error) ? error.message : "No se pudo sincronizar con Google. Revisa la conexión e inténtalo de nuevo; los cambios se conservan.";

export class GoogleBudgetSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleBudgetSyncError";
  }
}

async function validateHistoricalPayments(projectId: string, baseline: Buffer, proposed: Buffer) {
  const snapshot = await firestore.collection(EXPENSE_PAYMENTS).where("projectId", "==", projectId).get();
  const [source, imported] = await Promise.all([loadWorkbook(baseline), loadWorkbook(proposed)]);
  const currency = await readProjectCurrency(projectId);
  setWorkbookCurrency(source, currency); setWorkbookCurrency(imported, currency);
  const state = await readPaymentLedgerState(projectId);
  if (state.paymentsModelVersion === 2) stripUnifiedPaymentWorkbookProjection(imported, source, snapshot.docs.map((document) => ({ ...document.data(), id: document.id })), state.paymentLedgerRevision);
  const plan = await prepareWorkbookPaymentChange(projectId, source, imported);
  return { plan, bytes: state.paymentsModelVersion === 2 ? await writeWorkbook(imported) : proposed };
}

async function samePaidObservations(left: Buffer, right: Buffer) {
  const [a, b] = await Promise.all([loadWorkbook(left), loadWorkbook(right)]);
  const values = (workbook: Awaited<ReturnType<typeof loadWorkbook>>) => JSON.stringify(readBudgetLines(workbook).map((line) => [line.id, Math.round(line.paid * 100)]).sort(([one], [two]) => String(one).localeCompare(String(two))));
  return values(a) === values(b);
}

export function syncDirection(localKey: string, syncedKey: string, version: string, syncedVersion: string) {
  const local = localKey !== syncedKey;
  const remote = version !== syncedVersion;
  if (local && remote) throw new Error("Hay cambios en Google y en el proyecto. Descarga ambas versiones antes de conciliarlas; ninguna se sobrescribió.");
  return local ? "push" : remote ? "pull" : "none";
}

// One project-level link and lease, regardless of the category/user/draft.
// Storage versions remain recovery snapshots, not separate files in Drive.
const pendingSyncs = new Map<string, Promise<{ fileId: string; folderId: string } | null>>();
export async function syncGoogleBudget(projectId: string, provisionUid?: string, useGoogle = false, resetQa = false): Promise<{ fileId: string; folderId: string } | null> {
  if (resetQa && !(process.env.HOUSE_PLANNER_QA_PROJECT_IDS || "").split(",").includes(projectId)) throw new Error("qa_reset_forbidden");
  const pending = pendingSyncs.get(projectId);
  if (pending) { await pending.catch(() => undefined); return provisionUid || useGoogle || resetQa ? syncGoogleBudget(projectId, provisionUid, useGoogle, resetQa) : pending; }
  const operation = runGoogleBudgetSync(projectId, provisionUid, useGoogle, resetQa);
  pendingSyncs.set(projectId, operation);
  try { return await operation; } finally { pendingSyncs.delete(projectId); }
}

async function runGoogleBudgetSync(projectId: string, provisionUid?: string, useGoogle = false, resetQa = false) {
  if (!googleConfigured() || !projectBucket) { await flushPaymentProjection(projectId); return null; }
  const ref = googleBudgetRef(projectId);
  const initial = (await ref.get()).data();
  if (!initial?.fileId && !provisionUid) { await flushPaymentProjection(projectId); return null; }
  const operation = randomUUID();
  await firestore.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (Number(current?.leaseExpires) > Date.now()) throw new Error("La hoja se está sincronizando. Inténtalo de nuevo en unos segundos.");
    tx.set(ref, { lease: operation, leaseExpires: Date.now() + 600_000 }, { merge: true });
  });
  try {
    const link = (await ref.get()).data()!;
    const configRef = firestore.collection(CONFIG).doc(projectConfigDoc(projectId));
    const config = (await configRef.get()).data() || {};
    const currency = await readProjectCurrency(projectId);
    let key = String(config.workbookObjectKey || "");
    if (!key) throw new Error("Abre primero el presupuesto del proyecto.");
    const client = link.authMode === "service_account" ? await serviceGoogle() : await connectedGoogle(projectId, String(link.ownerUid || provisionUid));
    let fileId = String(link.fileId || "");
    if (!fileId) {
      key = (await flushPaymentProjection(projectId)).objectKey || key;
      const project = (await firestore.collection(PROJECTS).doc(projectId).get()).data();
      const name = String(project?.name || projectId);
      const folderId = link.folderId || await createGoogleFolder(client, `House Planner · ${name}`);
      await ref.set({ folderId, ownerUid: provisionUid }, { merge: true });
      const [bytes] = await projectBucket.file(key).download();
      fileId = await createGoogleWorkbook(client, await consolidatedWorkbook(bytes, false, undefined, currency), `Presupuesto consolidado · ${name}`, folderId);
      // Persist the ID immediately, so retries always reuse the same document.
      await ref.set({ fileId, syncedObjectKey: key, syncedBaselineObjectKey: key }, { merge: true });
      const state = await googleFileState(client, fileId);
      await ref.set({ version: state.version, error: null, syncedAt: new Date().toISOString() }, { merge: true });
      return { fileId, folderId };
    }
    let state = await googleFileState(client, fileId);
    if (config.paymentsModelVersion === 2 && config.paymentProjectionPending === true) {
      if (state.version !== link.version) {
        const remote = await readStableGoogleWorkbook(client, fileId);
        const [baseline] = await projectBucket.file(String(link.syncedBaselineObjectKey || link.syncedObjectKey || key)).download();
        const remoteBytes = await consolidatedWorkbook(remote.bytes, true, baseline, currency);
        if (!await samePaidObservations(baseline, remoteBytes))
          throw new PaymentLedgerConflict("Hay pagos nuevos en la aplicación y cambios de importes en Google. Revisá ambas versiones antes de sincronizar; los pagos se conservan.");
        // Only app payments changed locally: preserve Google's quote/plan/format edits,
        // then project the current ledger over its unchanged paid column.
        if (key === link.syncedObjectKey && !resetQa) {
          const [source, proposed] = await Promise.all([loadWorkbook(baseline), loadWorkbook(remoteBytes)]);
          let adoptedLedgerRevision: number | undefined;
          if (!source.getWorksheet(PAYMENT_PROJECTION_SHEET) && proposed.getWorksheet(PAYMENT_PROJECTION_SHEET)) {
            // Older pulls stored the source after stripping Google's reports.
            // Rebuild only its published summary from trusted Storage amounts;
            // these temporary observations never become payment records.
            const trusted = await readPaymentLedgerState(projectId);
            if (trusted.paymentsModelVersion !== 2 || trusted.objectKey !== key || trusted.paymentProjectedLedgerRevision <= 0) throw new PaymentLedgerConflict();
            if (proposed.getWorksheet(PAYMENT_PROJECTION_SHEET)!.getCell("D1").text !== "summary")
              throw new PaymentLedgerConflict("El historial de pagos de Google cambió. Conservá sus hojas de consulta y reintentá.");
            setWorkbookCurrency(source, currency); setWorkbookCurrency(proposed, currency);
            const publishedSummary = readBudgetLines(source).filter((line) => line.paid > 0)
              .map((line) => ({ id: `summary:${line.id}`, budgetLineId: line.id, amount: line.paid, currency }));
            stripUnifiedPaymentWorkbookProjection(proposed, source, publishedSummary, trusted.paymentProjectedLedgerRevision);
            adoptedLedgerRevision = trusted.paymentLedgerRevision;
          } else stripPaymentProjectionAgainstBaseline(proposed, source);
          const plan = await prepareWorkbookPaymentChange(projectId, source, proposed);
          if (adoptedLedgerRevision !== undefined && (plan.paymentsModelVersion !== 2 || plan.revision !== adoptedLedgerRevision)) throw new PaymentLedgerConflict();
          const remoteKey = `${projectStoragePrefix(projectId)}/workbooks/versions/google-baseline-${operation}.xlsx`;
          const mergedKey = `${projectStoragePrefix(projectId)}/workbooks/versions/google-payments-${operation}.xlsx`;
          await projectBucket.file(remoteKey).save(remoteBytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false });
          await projectBucket.file(mergedKey).save(await writeWorkbook(proposed), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false });
          const previousKey = key;
          const planChanged = !await sameBudgetContent(baseline, remoteBytes);
          await firestore.runTransaction(async (tx) => {
            const current = (await tx.get(configRef)).data();
            if (current?.workbookObjectKey !== previousKey) throw new PaymentLedgerConflict();
            await plan.validate(tx);
            const planVersion = Number(current.workbookPlanVersion || 1) + (planChanged ? 1 : 0);
            tx.set(configRef, { workbookObjectKey: mergedKey, workbookPlanVersion: planVersion, workbookUpdatedBy: "Google Sheets", workbookUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
            plan.write(tx);
            tx.set(ref, { version: remote.state.version, syncedObjectKey: remoteKey, syncedBaselineObjectKey: remoteKey }, { merge: true });
          });
          key = mergedKey; link.version = remote.state.version; link.syncedObjectKey = remoteKey; link.syncedBaselineObjectKey = remoteKey;
        }
        state = remote.state;
      }
      key = (await flushPaymentProjection(projectId)).objectKey || key;
    }
    if (!useGoogle && !resetQa && key !== link.syncedObjectKey && state.version !== link.version) {
      const latest = await readStableGoogleWorkbook(client, fileId);
      const [[base], [local]] = await Promise.all([projectBucket.file(String(link.syncedBaselineObjectKey || link.syncedObjectKey)).download(), projectBucket.file(key).download()]);
      const remote = await consolidatedWorkbook(latest.bytes, true, base, currency);
      const merged = await reconcileBudgetMetadata(base, local, remote);
      if (merged) {
        const prepared = await validateHistoricalPayments(projectId, local, merged);
        const previousKey = key;
        const mergedKey = `${projectStoragePrefix(projectId)}/workbooks/versions/reconcile-${operation}.xlsx`;
        await projectBucket.file(mergedKey).save(prepared.bytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false });
        await firestore.runTransaction(async tx => {
          if ((await tx.get(configRef)).data()?.workbookObjectKey !== previousKey) throw new Error("El proyecto cambió durante la sincronización. Ambas versiones se conservaron.");
          await prepared.plan.validate(tx);
          tx.set(configRef, { workbookObjectKey: mergedKey }, { merge: true });
          prepared.plan.write(tx);
          tx.set(ref, { version: latest.state.version }, { merge: true });
        });
        key = mergedKey; state = latest.state; link.version = latest.state.version;
      }
    }
    if (!link.version && !useGoogle && !resetQa) throw new Error("La creación de la hoja quedó incompleta. Revisa su contenido antes de sincronizar.");
    // A guarded QA reset explicitly discards the synthetic budget, including
    // its Google copy. Keep the conditional ETag write even for this reset.
    const direction = resetQa ? "push" : useGoogle ? "pull" : syncDirection(key, String(link.syncedObjectKey), state.version, String(link.version));
    if (direction === "push") {
      const [bytes] = await projectBucket.file(key).download();
      const outgoing = await consolidatedWorkbook(bytes, false, undefined, currency);
      let version: string;
      try { version = await updateGoogleWorkbook(client, fileId, outgoing, state.etag); }
      catch (error) {
        // A conversion can commit despite a transient response; its retry then
        // fails If-Match. Verify the complete result before accepting success.
        if ((error as { response?: { status?: number } })?.response?.status !== 412) throw error;
        const observed = await readStableGoogleWorkbook(client, fileId);
        if (!await sameBudgetContent(outgoing, await consolidatedWorkbook(observed.bytes, true, outgoing, currency))) throw error;
        version = observed.state.version;
      }
      const observed = await readStableGoogleWorkbook(client, fileId);
      const canonical = await consolidatedWorkbook(observed.bytes, true, outgoing, currency);
      if (await sameBudgetContent(outgoing, canonical)) {
        // Keep Google's actual representation as the next merge baseline,
        // including conversion formatting and any concurrent formatting edits.
        const observedKey = `${projectStoragePrefix(projectId)}/workbooks/versions/published-${operation}.xlsx`;
        await projectBucket.file(observedKey).save(canonical, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false });
        await firestore.runTransaction(async tx => {
          if ((await tx.get(configRef)).data()?.workbookObjectKey !== key) throw new Error("El proyecto cambió durante la sincronización. Ambas versiones se conservaron.");
          tx.set(configRef, { workbookObjectKey: observedKey }, { merge: true });
          tx.set(ref, { version: observed.state.version, syncedObjectKey: observedKey, syncedBaselineObjectKey: observedKey }, { merge: true });
        });
      } else await ref.set({ version, syncedObjectKey: key, syncedBaselineObjectKey: key }, { merge: true });
    } else if (direction === "pull") {
      const { bytes: remote, state: readState } = await readStableGoogleWorkbook(client, fileId);
      const [[localBytes], [baselineBytes]] = await Promise.all([projectBucket.file(key).download(), projectBucket.file(String(link.syncedBaselineObjectKey || link.syncedObjectKey || key)).download()]);
      const remoteBytes = await consolidatedWorkbook(remote, true, baselineBytes, currency);
      const prepared = await validateHistoricalPayments(projectId, localBytes, remoteBytes);
      const bytes = prepared.bytes;
      const contentChanged = !await sameBudgetContent(localBytes, bytes);
      const objectKey = `${projectStoragePrefix(projectId)}/workbooks/versions/google-${operation}.xlsx`;
      // Payment validation strips consultation pages from the app's copy. Keep
      // the actual Google representation separately for the next comparison.
      const baselineKey = `${projectStoragePrefix(projectId)}/workbooks/versions/google-baseline-${operation}.xlsx`;
      await projectBucket.file(objectKey).save(bytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false });
      await projectBucket.file(baselineKey).save(remoteBytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable: false });
      // Write row identities back, conditional on the revision just read.
      const version = await needsGoogleRowIdentities(remote) ? await updateGoogleWorkbook(client, fileId, remoteBytes, readState.etag) : readState.version;
      await firestore.runTransaction(async (tx) => {
        const current = (await tx.get(configRef)).data();
        if (current?.workbookObjectKey !== key) throw new Error("El proyecto cambió durante la sincronización. Ambas versiones se conservaron.");
        await prepared.plan.validate(tx);
        const planVersion = Number(current.workbookPlanVersion || 1) + (contentChanged ? 1 : 0);
        tx.set(firestore.collection(WORKBOOK_VERSIONS).doc(), { projectId, kind: "google_sync", planVersion, actualsRevision: Number(current.workbookActualsRevision || 0), objectKey, createdBy: "Google Sheets", createdAt: FieldValue.serverTimestamp() });
        tx.set(configRef, { workbookObjectKey: objectKey, workbookPlanVersion: planVersion, workbookUpdatedAt: FieldValue.serverTimestamp(), workbookUpdatedBy: "Google Sheets" }, { merge: true });
        prepared.plan.write(tx);
        tx.set(ref, { version, syncedObjectKey: objectKey, syncedBaselineObjectKey: baselineKey }, { merge: true });
      });
    }
    await ref.set({ error: null, syncedAt: new Date().toISOString() }, { merge: true });
    return { fileId, folderId: String(link.folderId) };
  } catch (error) {
    if (error && typeof error === "object" && "response" in error) {
      const response = error.response as { status?: number; data?: { error?: { errors?: Array<{ reason?: string }> } } } | undefined;
      console.warn("Google budget sync failed", { projectId, status: response?.status, reason: response?.data?.error?.errors?.[0]?.reason });
    }
    const message = googleSyncMessage(error);
    await ref.set({ error: message }, { merge: true });
    throw new GoogleBudgetSyncError(message);
  } finally {
    await firestore.runTransaction(async (tx) => { if ((await tx.get(ref)).data()?.lease === operation) tx.set(ref, { lease: null, leaseExpires: 0 }, { merge: true }); });
  }
}

export async function syncAfterBudgetCommit(projectId: string) {
  await pendingSyncs.get(projectId)?.catch(() => undefined);
  try { const link = await syncGoogleBudget(projectId); return { googleSynced: Boolean(link) }; }
  catch (error) { return { googleSynced: false, googleSyncError: googleSyncMessage(error) }; }
}
