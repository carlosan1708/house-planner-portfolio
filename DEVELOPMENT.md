# Development

These instructions are for the author and developers with prior written [permission](LICENSE)
to build or run the application. Public source inspection and the hosted demo remain available
under that license. This guide separates synthetic local development from an independently
configured installation.
Start with [the README](README.md) for product context and [testing](docs/development/testing.md)
for what each validation level proves.

## Requirements and local demo

Use Node.js 22+, npm and Git. Clone the authorized repository, then run:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000/?mode=demo&lang=en`. On macOS/Linux use
`cp .env.example .env.local`. The example uses the synthetic Firebase project
`demo-house-planner-qa`, loopback addresses, dummy browser configuration and disabled live AI.
The fictional demo uses scripted assistant examples and needs no cloud credentials.

## Local workspace with sign-in

Install Java 21 or newer and put its `bin` directory on your PATH. Install the pinned Firebase CLI
once. The first emulator start may download emulator binaries.

```powershell
npm install --global firebase-tools@15.13.0
$env:QA_FIREBASE_CLI_PATH = Join-Path (npm root --global) 'firebase-tools/lib/bin/firebase.js'
npm run dev:local
```

On macOS/Linux, set the CLI path with
`export QA_FIREBASE_CLI_PATH="$(npm root --global)/firebase-tools/lib/bin/firebase.js"` before
running the same npm command.

Open the local workspace URL printed by the launcher, open the private workspace if prompted, and enter the
synthetic email and the generated password printed in that terminal. The seeded account is an
administrator of **QA Primary**. It can work with the local budget, documents and other project
features. The launcher configures Firebase Authentication, Firestore and Storage on loopback and creates
a temporary vault recovery key. It needs no Firebase login, service-account JSON, or Google ADC.
The workspace runs on port 3016, with emulator ports 4901 through 4906. Keep the terminal open while
using the app. Ctrl+C stops the stack and discards its in-memory data and credentials.

Use the project-specific configuration below for live AI, semantic indexing, email or Sheets.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Anonymous local demo |
| `npm run dev:local` | Signed-in workspace with loopback emulators and synthetic credentials |
| `npm run docs:check` | Offline documentation, references and SDD checks |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit, route, component and synthetic workbook/model tests |
| `npm run build -- --webpack` | Production compile and TypeScript checking |
| `npm run test:e2e` | Anonymous demo and mocked browser regression |
| `npm run qa:local -- --suite=permissions` | Six-user isolation checks using local emulators |
| `node scripts/prepare-demo-house.mjs` | Generate an invented, local-only 3D model |

Generated outputs, `.env.local`, caches and browser reports are ignored. Do not commit credentials,
private documents, browser authentication state or real model geometry.

## Independently authorized installation

Configure your own Firebase/GCP project, authorized domains, bucket and server credentials.
Required server settings include `GOOGLE_CLOUD_PROJECT`, `HOUSE_PLANNER_BUCKET`,
`HOUSE_PLANNER_PUBLIC_URL` and the platform-owner email. Production uses
`HOUSE_PLANNER_ENVIRONMENT=production`; remove all emulator hosts and use the project's browser
Firebase configuration. Use `NEXT_PUBLIC_FIREBASE_*` values for your own application.

The browser Firebase configuration is public application configuration, not an administrator
credential. Server credentials and OAuth secrets must remain outside Git. Prefer workload identity
or Application Default Credentials for authorized development; never commit service-account keys.

Live AI is disabled by default in this snapshot. Enabling `HOUSE_PLANNER_AI_ENABLED=1`
requires an independently authorized installation, its own Vertex AI permissions, a configured
`GEMINI_MODEL`, and reviewed access, rate and spend controls. Model availability and cost must
be checked before live calls. Sheets and email integrations have separate OAuth/runtime
requirements. Enable plan images with `HOUSE_PLANNER_ASSISTANT_IMAGES=1` and configure document
indexing with [the RAG guide](docs/assistant-rag.md). Consult [Sheets setup](docs/google-sheets-editing.md)
and [release operations](docs/operations/releases.md) for their credentials and deployment settings.

The private operational repository continues to own production deployment. Public scripts use
example identities and fail-closed release policy placeholders; they do not authorize deployment
to the author's installation. Review [snapshot boundaries](docs/portfolio/snapshot.md)
and [release architecture](docs/operations/releases.md) before independently authorized cloud work.

## Spec Kit authoring

The committed kit is pinned to 1.2.0. See [SDD setup and commands](docs/development/sdd.md)
and [contribution rules](CONTRIBUTING.md). Read the installed Next.js guides before changing
framework code, as required by AGENTS.md. Do not bypass type checking to obtain a passing build.
