<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## CI obligatorio y regresión completa opcional

Decisión del usuario (2026-10-14): el CI obligatorio ejecuta revisión estática/documentación, pruebas unitarias y compilación de la aplicación. Playwright ejecuta cobertura acotada de los flujos afectados cuando corresponda, según el diff real. Estas comprobaciones forman parte del trabajo ordinario autorizado. La regresión completa de navegador y la regresión autenticada con emuladores son opcionales o a pedido del usuario; no deben dispararse automáticamente al abrir un PR, hacer merge o desplegar. El workflow `full-regression.yml` es exclusivamente manual. La nube de QA conserva su autorización independiente por sesión.

## Autorización antes de regresiones completas

Instrucción explícita del usuario (2026-10-14): consultar y obtener autorización antes de ejecutar una regresión completa, incluidas la suite completa de navegador y la regresión autenticada con emuladores. El CI estándar obligatorio no constituye esa regresión completa.

- Explicar el alcance, el entorno, las ejecuciones previstas y el tiempo/coste estimado antes de pedir aprobación. La autorización cubre únicamente las ejecuciones especificadas.
- Consultar también antes de la acción que la active automáticamente: push, apertura o actualización de un PR, merge o deploy, según los disparadores del workflow. Revisar esos disparadores antes de actuar.
- Un pedido general como «haz deploy», «haz merge», «haz pruebas» o «solo pruebas automáticas» no autoriza por sí solo una regresión completa. Si el usuario autoriza expresamente esa ejecución, continuar sin volver a pedir la misma aprobación.
- Esta condición se aplica tanto a local/CI como a cloud y complementa las reglas de aprobación de cloud QA. No deshabilitar workflows ni omitir checks obligatorios para evitar la consulta. Preparar primero el cambio revisable; si publicar requiere disparar la regresión completa, detenerse antes de ese disparador y solicitar la autorización correspondiente.



## Codex manual browser QA

When completing requested features, reported bug fixes, or important UI, permission, persistence, or deployment changes, offer a scoped Codex-led browser pass using [the manual browser QA plan](docs/manual-browser-qa.md). State the affected flow, identities, environment, and estimated time. When that run is already authorized, continue without asking for the same authorization again.

Default to isolated local emulators with synthetic data and live AI disabled. Standard trusted CI is the ordinary release validation for all changes, including server, permission and security changes, with meaningful boundary tests and the existing backup, candidate and exact-source promotion gates.

Cloud QA is always optional. Offer it only when the user requests cloud testing or a specific substantial unresolved question cannot be verified locally; a server change, failed CI or deployment request alone is not a reason to offer it. Before every defined cloud session, explain the reason, exact source/target, scenarios, operations, estimated time and incremental cost, then ask for and obtain the user's explicit approval. General instructions to merge, deploy or test do not authorize cloud QA. The approval covers only that session and its necessary cleanup; do not reuse it for a new session, silently retry or fall back to cloud. A declined offer does not block an otherwise valid CI release.

This rule applies before QA cloud setup, provisioning, source builds/deployments, regression or manual browsing, budget reservations and live AI calls. A command-line flag, workflow dispatch or available budget is not evidence of the user's consent. Follow [QA workflow](docs/qa-workflow.md) and the [005 policy specification](specs/005-optional-cloud-qa/spec.md), retain the existing cost ledger/limits, isolation, source checks, fixture lease and cleanup, and never use production data as a writable fixture.

Manual evidence requires Codex to inspect the rendered UI and exercise normal browser controls. Playwright test results are separate. If the integrated browser-control or bundled Node runtime is unavailable, the plan permits an ordinary Node.js REPL with the installed Playwright library and fresh headless Chromium. Codex must choose each action from observed rendered text/screenshots and retain the same source, isolation, private proxy, budget, lease, credential, and cleanup guards. Record the runtime and setup limitation; a working fallback does not prove the integrated runtime was repaired.

Record the exact source, selected scenarios, expected/observed results, failures, omissions, and cleanup. A manual pass complements automated regression and never replaces standard trusted CI or the exact-source release gate. When the optional cloud release lane is explicitly selected, its complete cloud evidence requirements also remain in force. If neither browser-control option or the required keep-open session is available, report that check as blocked. There is no dedicated manual-session launcher: Codex can prepare the guarded ordinary REPL fallback, while the current `qa:local` command stops its processes after automated tests.

## House Planner project skills

Use the relevant skill in `.agents/skills/` for release (`house-planner-release`), scoped verification (`house-planner-qa`), authorization (`house-planner-access-review`) or mobile/navigation UX (`house-planner-mobile-ux`). Read only the applicable SKILL.md. See [skill selection](docs/development/project-skills.md) and [foundation provenance](.agents/project-skills-provenance.md). Skills do not override the approval rule above or authorize automatic CI triggers.
