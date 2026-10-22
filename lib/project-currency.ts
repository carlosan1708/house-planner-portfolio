import { FieldValue, type DocumentData, type Transaction } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { projectCurrency } from "./currency";
import type { ProjectCurrency } from "./currency";
import { AGENT_PROPOSALS, BUDGET_LINES, CONFIG, EXPENSE_DOCUMENTS, EXPENSE_PAYMENTS, EXPENSES, LEGACY_PROJECT_ID, OVERRIDES, PROJECTS, PURCHASES, QUOTE_ANALYSES, WORKBOOK_DRAFTS, WORKBOOK_VERSIONS, projectConfigDoc, projectStoragePrefix } from "./project";

export const currencyRevision = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

export class ProjectCurrencyChangedError extends Error {
  readonly code = "project_currency_changed";
  readonly status = 409;
  constructor() { super("project_currency_changed"); }
}

/** Recheck after asynchronous preparation and before any financial transaction writes. */
export async function validateProjectCurrency(transaction: Transaction, projectId: string, expectedCurrency: ProjectCurrency, expectedCurrencyRevision?: number) {
  const project = await transaction.get(firestore.collection(PROJECTS).doc(projectId));
  const data = project.data();
  if (!project.exists || projectCurrency(data?.currency) !== expectedCurrency
    || expectedCurrencyRevision !== undefined && currencyRevision(data?.currencyRevision) !== expectedCurrencyRevision) throw new ProjectCurrencyChangedError();
  return projectCurrency(data?.currency);
}

export async function readProjectCurrency(projectId: string) {
  return projectCurrency((await firestore.collection(PROJECTS).doc(projectId).get()).data()?.currency);
}

/** Financial preparation and settings updates serialize through the canonical project document. */
export async function lockProjectCurrency(projectId: string) {
  const ref = firestore.collection(PROJECTS).doc(projectId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("project_not_found");
    const data = snapshot.data()!;
    if (data.currencyLocked !== true) transaction.set(ref, { currencyLocked: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return projectCurrency(data.currency);
  });
}

/** Detect financial setup that requires an explicitly confirmed denomination correction. */
export async function projectCurrencyLocked(projectId: string, data: DocumentData, transaction?: Transaction) {
  // The legacy project has a populated default Storage workbook even without CONFIG or cached lines.
  if (data.currencyLocked === true || projectId === LEGACY_PROJECT_ID) return true;
  const configRef = firestore.collection(CONFIG).doc(projectConfigDoc(projectId));
  const linkedRef = firestore.collection("housePlannerGoogleBudgets").doc(projectId);
  const [config, linked] = transaction ? await transaction.getAll(configRef, linkedRef) : await Promise.all([configRef.get(), linkedRef.get()]);
  const editableStarter = config.exists && config.data()?.currencyEditable === true
    && config.data()?.workbookObjectKey === `${projectStoragePrefix(projectId)}/workbooks/starter.xlsx`;
  if (config.exists && !editableStarter || linked.data()?.fileId || data.linkedSheet) return true;
  const collections = [BUDGET_LINES, EXPENSES, PURCHASES, EXPENSE_DOCUMENTS, EXPENSE_PAYMENTS, WORKBOOK_DRAFTS, WORKBOOK_VERSIONS, AGENT_PROPOSALS, QUOTE_ANALYSES, OVERRIDES];
  const records = await Promise.all(collections.map(async (collection) => {
    const candidateQuery = firestore.collection(collection).where("projectId", "==", projectId);
    // Viewing a pristine starter can materialize its zero-valued budget projection.
    const query = editableStarter && collection === BUDGET_LINES ? candidateQuery : candidateQuery.limit(1);
    const snapshot = await (transaction ? transaction.get(query) : query.get());
    if (editableStarter && collection === BUDGET_LINES) return snapshot.docs.some((document) => {
      const line = document.data();
      return ["objective", "quote", "paid", "excess"].some((field) => Number(line[field] ?? 0) !== 0);
    });
    return !snapshot.empty;
  }));
  return records.some(Boolean);
}
