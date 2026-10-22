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
npm run dev
```

Open `http://localhost:3000/?mode=demo&lang=en`. The example configuration uses the synthetic
`demo-house-planner-qa` project, loopback emulator addresses, dummy browser configuration and
`QA_AI_ENABLED=0`. No author-owned production credentials are required. Demo workbooks/files
are fictional; demo mode does not enable the assistant.

The emulator processes are needed for authenticated local QA. Anonymous demo rendering does not
require them. Background calls may report unavailable local emulators until those are started;
they must never be redirected to a live project merely to remove that message.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local application |
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
requirements. Consult [Sheets setup](docs/google-sheets-editing.md) and [release operations](docs/operations/releases.md).

The private operational repository continues to own production deployment. Public scripts use
example identities and fail-closed release policy placeholders; they do not authorize deployment
to the author's installation. Review [snapshot boundaries](docs/portfolio/snapshot.md)
and [release architecture](docs/operations/releases.md) before independently authorized cloud work.

## Spec Kit authoring

The committed kit is pinned to 1.2.0. See [SDD setup and commands](docs/development/sdd.md)
and [contribution rules](CONTRIBUTING.md). Read the installed Next.js guides before changing
framework code, as required by AGENTS.md. Do not bypass type checking to obtain a passing build.
