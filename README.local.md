# Run House Planner locally

These instructions are for the author and developers with [written permission](LICENSE).
Install Node.js 22+. If you downloaded the ZIP, extract it and open the extracted
`house-planner-portfolio` folder in VS Code. If you prefer to clone it with Git, run:

```powershell
git clone https://github.com/carlosan1708/house-planner-portfolio.git
cd house-planner-portfolio
```

From the project folder, install dependencies with `npm ci`.

## Anonymous demo

In PowerShell on Windows, run:

```powershell
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run dev -- --hostname 127.0.0.1
```

On macOS or Linux, use `test -f .env.local || cp .env.example .env.local` before running the npm command.
Open the [local demo](http://127.0.0.1:3000/?mode=demo&lang=en). It uses fictional data and runs
without Java, Firebase emulators, an account, or cloud credentials.

## Local workspace with sign-in

Install Java 21 or newer for the Firestore and Storage emulators. Java runs those local services.
Check whether the VS Code terminal can find it with `java -version`. If Java is installed but
PowerShell cannot find it, set `JAVA_HOME` to your installed JDK folder and add its `bin` folder to
the current terminal's PATH. For example, if your JDK is installed at `C:\Tools\jdk-21`:

```powershell
$env:JAVA_HOME = 'C:\Tools\jdk-21'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
java -version
```

Install the Firebase CLI once, then start the workspace:

```powershell
npm install --global firebase-tools@15.13.0
$env:QA_FIREBASE_CLI_PATH = Join-Path (npm root --global) 'firebase-tools/lib/bin/firebase.js'
npm run dev:local
```

On macOS or Linux, set the CLI path with
`export QA_FIREBASE_CLI_PATH="$(npm root --global)/firebase-tools/lib/bin/firebase.js"`
before running `npm run dev:local`. The first start may download emulator binaries.

Open [QA Primary](http://127.0.0.1:3016/projects/qa-primary/overview?lang=en), choose **Open private
workspace**, and sign in with one of the synthetic accounts:

| Role | Email | Demo password |
|---|---|---|
| Administrator | `qa.houseplanner.20260830@example.com` | `CasaDemoAdmin2026` |
| Editor | `qa.houseplanner.editor@example.com` | `CasaDemoEditor2026` |
| Viewer | `qa.houseplanner.reader@example.com` | `CasaDemoLector2026` |

`npm run dev:local` recreates these accounts on each start. The passwords are public fixtures for
the loopback Firebase Auth emulator and are only used by this development command.
To test roles simultaneously, use separate browser profiles so their session cookies are isolated.

The launcher starts Firebase Auth, Firestore and Storage on loopback, seeds the synthetic projects,
and generates a temporary vault recovery key. Keep the terminal open while working. Ctrl+C stops
the stack, and emulator data is discarded. Live AI, Sheets and email use the
[independent installation settings](DEVELOPMENT.md#independently-authorized-installation).
