import { FieldValue } from "firebase-admin/firestore";
import sharp from "sharp";
import { commitActivity } from "./activity";
import { aestheticFolderKind } from "./aesthetics";
import { liveAgent } from "./assistant-app-tools";
import { imageFeatureEnabled, readPageAnswer, renderPlanImage, withPlanFile } from "./assistant-image-model";
import { listImagePlans, planMember, resolveImagePlan, type PlanRef } from "./assistant-plan-sources";
import { changeRun, checkRun, checkpoint, claimExecution, ownsConversation, runView, RunConflict, type Run } from "./assistant-run-store";
import type { RunResponse } from "./assistant-run";
import { firestore, projectBucket } from "./firebase-admin";
import { AESTHETIC_FOLDERS, AESTHETIC_IMAGES, PROJECTS, projectStoragePrefix, type MemberRecord } from "./project";
import type { ImageProgress } from "./assistant-run-types";

type Conversation = FirebaseFirestore.DocumentReference;
export type StoredAssistantImage = {
  source: PlanRef; name: string; pages: number[]; references: number[]; model: string; objectKey: string;
};
const label = (language: Run["language"], en: string, es: string) => language === "es" ? es : en;
const imageFolder = (thread: Conversation) => `house-planner/assistant-images/${thread.id}/`;
const imagePreference = (actor: MemberRecord) => firestore.collection(PROJECTS).doc(actor.projectId).collection("assistantPreferences").doc(actor.uid);

const noPlans = (run: Run) => ({ kind: "retry" as const, question: label(run.language,
  "No accessible plan is available. Retry when you have access to a plan.",
  "No hay un plano disponible. Reintentá cuando tengás acceso a un plano.") });

export async function visibleImageRun(actor: MemberRecord, run: Run) {
  if (!planMember(actor)) return null;
  const view = runView(run);
  if (view?.pending?.kind !== "input" || run.image?.plan) return view;
  const available = new Set((await listImagePlans(actor)).filter(plan => plan.version === run.image?.choices[plan.key]).map(plan => plan.key));
  const options = view.pending.options.filter(option => available.has(option.id));
  return { ...view, pending: options.length ? { ...view.pending, options } : noPlans(run) };
}

export async function askForPlan(actor: MemberRecord, thread: Conversation, run: Run) {
  if (!imageFeatureEnabled() || !planMember(actor)) throw new RunConflict("project_access_required");
  const live = await liveAgent(actor);
  const [sources, preference] = await Promise.all([listImagePlans(live), imagePreference(live).get().catch(() => null)]);
  const plans = sources.filter(plan => plan.version);
  if (!plans.length) return null;
  const last = preference?.data()?.lastImagePlan;
  const suggested = plans.find(plan => plan.key === last);
  const ordered = suggested ? [suggested, ...plans.filter(plan => plan !== suggested)] : plans;
  return checkpoint(thread, live, run, {
    status: "input",
    pending: {
      kind: "input", question: label(run.language, "Which plan should I use?", "¿Qué plano querés usar?"),
      options: ordered.map(plan => ({ id: plan.key, label: `${plan.name} · ${plan.location}`.slice(0, 230), ...(plan === suggested ? { suggested: true } : {}) })),
    },
    image: { plan: null, choices: Object.fromEntries(plans.map(plan => [plan.key, plan.version])), pageCount: 0, evidence: [] },
  });
}

let processingImage = false;

export async function respondToImageRun(actor: MemberRecord, thread: Conversation, input: RunResponse) {
  if (input.action === "cancel") return updateImageRun(actor, thread, input);
  if (processingImage) throw new RunConflict("image_capacity");
  processingImage = true;
  try {
    return await updateImageRun(actor, thread, input);
  } finally {
    processingImage = false;
  }
}

async function updateImageRun(actor: MemberRecord, thread: Conversation, input: RunResponse) {
  const live = await liveAgent(actor);
  if (!planMember(live) || (!imageFeatureEnabled() && input.action !== "cancel")) throw new RunConflict("project_access_required");
  const claimed = await changeRun(thread, live, current => {
    const run = checkRun(current, input);
    const image = run.image;
    if (!image || run.status === "complete") throw new RunConflict("run_changed");
    if (input.action === "cancel") return { ...run, status: "complete", pending: null, image: null };
    const progress = { stage: "reading" as const };
    if (input.action === "retry" && (run.status === "retry" || (!image.plan && run.status === "input") || (run.status === "executing" && run.leaseUntil < Date.now())))
      return { ...claimExecution(run), image: { ...image, progress } };
    if (input.action !== "answer" || run.status !== "input" || !input.answer) throw new RunConflict("invalid_answer");
    if (!image.plan) {
      const version = Object.hasOwn(image.choices, input.answer) && image.choices[input.answer];
      if (!version) throw new RunConflict("invalid_answer");
      return { ...claimExecution(run), image: { ...image, plan: { key: input.answer, version }, choices: {}, progress } };
    }
    const pages = readPageAnswer(input.answer, image.pageCount);
    if (!pages.length) throw new RunConflict("invalid_answer");
    return { ...claimExecution(run), image: { ...image, evidence: pages.map(page => ({ page, detail: "" })), progress } };
  });
  if (!claimed.image || claimed.status !== "executing") return;
  if (!claimed.image.plan) {
    if (!await askForPlan(live, thread, claimed)) await checkpoint(thread, live, claimed, { status: "retry", pending: noPlans(claimed) });
    return;
  }
  const source = claimed.image.plan;
  async function verifySource() {
    if (!await resolveImagePlan(await liveAgent(live), source!.key, source!.version)) throw new RunConflict("source_changed");
  }
  let working = claimed;
  let written: string | null = null;
  async function report(progress: ImageProgress, imageFields: Partial<NonNullable<Run["image"]>> = {}) {
    working = await checkpoint(thread, live, working, { image: { ...working.image!, ...imageFields, progress } });
  }
  try {
    const plan = await resolveImagePlan(live, source.key, source.version);
    if (!plan) throw new RunConflict("source_changed");
    const preference = imagePreference(live);
    const choice = { lastImagePlan: source.key, updatedAt: FieldValue.serverTimestamp() };
    if (input.action === "answer" && input.answer === source.key) {
      await preference.set(choice, { merge: true }).catch(() => console.warn("Could not save assistant plan preference"));
    } else if (input.action === "retry") {
      // Recover a choice made before preferences were introduced without replacing a newer one.
      await preference.create(choice).catch(() => undefined);
    }
    await withPlanFile(plan, async file => {
      const prior = working.image!.evidence;
      const evidence = prior.length > 14 && prior.every(sheet => !sheet.detail)
        ? await file.select(working.goal, prior.map(sheet => sheet.page))
        : prior.length ? prior : await file.select(working.goal);
      if (!evidence.length) {
        await checkpoint(thread, live, working, {
          status: "input", image: { ...working.image!, pageCount: file.pageCount },
          pending: { kind: "input", question: label(working.language,
            `Which PDF pages should I use? Enter page numbers from 1 to ${file.pageCount}.`,
            `¿Cuáles páginas del PDF querés usar? Ingresá números de página del 1 al ${file.pageCount}.`), options: [] },
        });
        return;
      }
      if (!await resolveImagePlan(await liveAgent(live), source.key, source.version)) throw new RunConflict("source_changed");
      await report({ stage: "generating" }, { evidence, pageCount: file.pageCount });
      const result = await renderPlanImage(working.goal, evidence, file.render, verifySource);
      await report({ stage: "saving" });
      const current = await liveAgent(live);
      if (!await resolveImagePlan(current, source.key, source.version)) throw new RunConflict("source_changed");
      if (!projectBucket) throw new Error("image_storage_unavailable");
      const objectKey = `${imageFolder(thread)}${working.id}-${working.revision}.jpg`;
      await projectBucket.file(objectKey).save(result.bytes, { contentType: "image/jpeg", resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
      written = objectKey;
      const assistantImage: StoredAssistantImage = {
        source, name: plan.name, pages: evidence.map(sheet => sheet.page).sort((a, b) => a - b), references: result.references, model: result.model, objectKey,
      };
      const text = label(working.language, "Conceptual visualization", "Visualización conceptual");
      await changeRun(thread, current, state => ({ ...checkRun(state, working), image: null, pending: null, status: "complete" }), tx => {
        tx.create(thread.collection("messages").doc(working.id), { role: "assistant", text, language: working.language, assistantImage, createdAt: FieldValue.serverTimestamp() });
        tx.update(thread, { lastMessage: text, lastMessageRole: "assistant", updatedAt: FieldValue.serverTimestamp() });
      });
      written = null;
    }, verifySource, (current, total) => report({ stage: "analyzing", current, total }));
  } catch (error) {
    if (written) await projectBucket?.file(written).delete({ ignoreNotFound: true }).catch(() => undefined);
    if (error instanceof RunConflict && error.message !== "source_changed") throw error;
    if (error instanceof RunConflict) {
      if (!await askForPlan(live, thread, working)) await checkpoint(thread, live, working, {
        status: "retry", pending: noPlans(working), image: { plan: null, choices: {}, pageCount: 0, evidence: [] },
      });
      return;
    }
    const limit = error instanceof Error && error.message === "plan_limit";
    if (limit && await askForPlan(live, thread, working)) return;
    await checkpoint(thread, live, working, { status: "retry", pending: { kind: "retry",
      question: label(working.language, "The visualization could not be generated. You can retry with the same plan.", "No se pudo generar la visualización. Podés reintentar con el mismo plano.") } });
  }
}

export async function readAssistantImage(actor: MemberRecord, thread: Conversation, id: string) {
  if (!projectBucket || !planMember(actor) || !/^[\w-]{1,150}$/.test(id)) return null;
  const [owner, message] = await Promise.all([thread.get(), thread.collection("messages").doc(id).get()]);
  const image = message.data()?.assistantImage as StoredAssistantImage | undefined;
  if (!ownsConversation(owner.data(), actor) || !image || typeof image.objectKey !== "string" ||
    !image.objectKey.startsWith(imageFolder(thread)) || !await resolveImagePlan(actor, image.source.key, image.source.version)) return null;
  return image;
}

export async function cleanAssistantImages(thread: Conversation) {
  await projectBucket?.deleteFiles({ prefix: imageFolder(thread) });
}

export async function saveAssistantImage(actor: MemberRecord, thread: Conversation, id: string, folderId: string) {
  if (!projectBucket || actor.role === "viewer" || (actor.role !== "admin" && !actor.permissions.aesthetics))
    throw new RunConflict("aesthetics_editor_access_required");
  const image = await readAssistantImage(actor, thread, id);
  if (!image) throw new RunConflict("image_unavailable");
  const folder = firestore.collection(AESTHETIC_FOLDERS).doc(folderId);
  const galleryId = `assistant-${id}`;
  const ref = firestore.collection(AESTHETIC_IMAGES).doc(galleryId);
  function validFolder(data: FirebaseFirestore.DocumentData | undefined) {
    return data && data.projectId === actor.projectId && !data.deletedAt && aestheticFolderKind(data.kind, data.name) === "images";
  }
  if (!validFolder((await folder.get()).data())) throw new RunConflict("image_folder_unavailable");
  const existing = (await ref.get()).data();
  if (existing) {
    if (existing.projectId !== actor.projectId || existing.deletedAt) throw new RunConflict("image_unavailable");
    return ref.id;
  }
  const [bytes] = await projectBucket.file(image.objectKey).download();
  const thumbnail = await sharp(bytes).resize(560, 420, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  const dimensions = await sharp(bytes).metadata();
  const prefix = `${projectStoragePrefix(actor.projectId)}/aesthetics`;
  const objectKey = `${prefix}/${galleryId}.jpg`;
  const thumbnailObjectKey = `${prefix}/thumbnails/${galleryId}.webp`;
  const files = [{ key: objectKey, data: bytes, type: "image/jpeg" }, { key: thumbnailObjectKey, data: thumbnail, type: "image/webp" }];
  await Promise.all(files.map(async ({ key, data, type }) => {
    await projectBucket!.file(key).save(data, { contentType: type, resumable: false, preconditionOpts: { ifGenerationMatch: 0 } })
      .catch(error => { if (Number(error?.code) !== 412) throw error; });
  }));
  const current = await liveAgent(actor);
  if (current.role === "viewer" || (current.role !== "admin" && !current.permissions.aesthetics) ||
    !await readAssistantImage(current, thread, id)) throw new RunConflict("image_unavailable");
  const fileName = "House Planner render.jpg";
  await commitActivity(current, {
    category: "aesthetic", action: "aesthetic.image_uploaded",
    target: { type: "aesthetic_image", id: ref.id, label: fileName, section: "aesthetics" },
    changes: [{ field: "folder", before: null, after: folderId, format: "text" }],
  }, tx => {
    tx.create(ref, { projectId: current.projectId, folderId, fileName, caption: "", notes: "", classification: "unclassified",
      assistantPlanSource: image.source, objectKey, thumbnailObjectKey, contentType: "image/jpeg", size: bytes.length,
      width: dimensions.width, height: dimensions.height, uploadedBy: current.email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  }, async tx => {
    const [destination, saved, owner] = await Promise.all([tx.get(folder), tx.get(ref), tx.get(thread)]);
    if (saved.exists) throw new RunConflict("image_already_saved");
    if (!validFolder(destination.data()) || !ownsConversation(owner.data(), current)) throw new RunConflict("image_unavailable");
  }).catch(error => {
    if (!(error instanceof RunConflict) || error.message !== "image_already_saved") throw error;
  });
  return ref.id;
}
