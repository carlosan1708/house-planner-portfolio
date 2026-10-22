/** Privileged one-time import; uses the same validation, transaction and Activity path as the API.
 * node --env-file=.env scripts/import-house-distribution.mjs --project=ID --model=PATH --source=DOCUMENT_ID --revision=0
 * Uses ADC by default. DISTRIBUTION_IMPORT_TOKEN optionally supplies a short-lived operator token.
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const options = Object.fromEntries(process.argv.slice(2).map(arg => { const at = arg.indexOf("="); if (!arg.startsWith("--") || at < 0) throw new Error("Use --key=value arguments"); return [arg.slice(2, at), arg.slice(at + 1)]; }));
if (!options.project || !options.model || !options.source || !/^\d+$/.test(options.revision || "")) throw new Error("Required: --project, --model, --source and --revision");
const outfile = fileURLToPath(new URL("./house-distribution-import.bundle.cjs", import.meta.url));
await build({ stdin: { contents: `
import {readFile} from 'node:fs/promises';
import {OAuth2Client} from 'google-auth-library';
import {firestore} from './lib/firebase-admin';
import {importDistribution} from './lib/house-distribution-store';
import {modelSources} from './lib/house-distribution';
import {normalizePermissions, normalizeFolderAccess, membershipId, PROJECTS, MEMBERSHIPS, USERS} from './lib/project';
export async function activate(options) {
  if(process.env.DISTRIBUTION_IMPORT_TOKEN){const client=new OAuth2Client();client.setCredentials({access_token:process.env.DISTRIBUTION_IMPORT_TOKEN});firestore.settings({authClient:client});}
  const project=await firestore.collection(PROJECTS).doc(options.project).get();
  if(!project.exists || project.data().kind==='personal')throw new Error('Choose an existing shared project');
  const uid=project.data().ownerUid;
  if(!uid)throw new Error('Project owner missing');
  const [membership,identity]=await Promise.all([firestore.collection(MEMBERSHIPS).doc(membershipId(options.project,uid)).get(),firestore.collection(USERS).doc(uid).get()]);
  if(!membership.exists||membership.data().role!=='admin'||membership.data().status!=='approved'||!identity.exists)throw new Error('Approved project owner required');
  const model=JSON.parse(await readFile(options.model,'utf8'));
  model.sourceDocumentIds=model.sourceDocumentIds.map(id=>id==='blueprint'?options.source:id);
  for(const s of modelSources(model))if(s.documentId==='blueprint')s.documentId=options.source;
  const actor={uid,projectId:options.project,projectName:project.data().name,isPersonal:false,email:identity.data().email,name:identity.data().name||'Owner',role:'admin',status:'approved',permissions:normalizePermissions(membership.data().permissions),folderAccess:normalizeFolderAccess(membership.data().folderAccess)};
  const result=await importDistribution(actor,model,Number(options.revision));
  console.log(JSON.stringify({project:actor.projectName,model:result.model.name,revision:result.revision,status:'ready',rooms:result.model.rooms.length,fixtures:result.model.fixtures.length}));
}
`, resolveDir: process.cwd(), sourcefile: "distribution-import.ts", loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", outfile });
await createRequire(import.meta.url)(outfile).activate(options);
