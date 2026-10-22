# Reproduce integration checks

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

Run `npm ci`, `npm run docs:check`, `npm run lint`, `npm test`, and
`npm run build -- --webpack`. The CI workflow also runs synthetic browser coverage and six-role
local emulator permissions checks. See [testing](../../docs/development/testing.md) and
[release gates](../../docs/operations/releases.md) for distinct deployed evidence requirements.
