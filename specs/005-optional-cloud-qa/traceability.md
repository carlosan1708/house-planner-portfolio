# Optional Cloud QA Traceability

> Historical private-development record. Its commit IDs are metadata only; the original commit objects and review evidence are retained privately and are not part of this public snapshot. See [snapshot provenance](../../docs/portfolio/snapshot.md).

This is a new specification-first policy amendment, separate from004 application development.
Real prior stages: specification/constitution `a5b4724cb42799707ede23a9b758696ad3e2e3dc`, plan `cd5a4fe98f31686b1eca0e3ee8b0165db6bb61b1`,
tasks/analysis `96619122fdacea5d42d9aa7519412025c4eda468`. Implementation commit `0cae5fb9fd650e6febb7e8fb4b4ac656e50885a0` broadens the full-CI lane and defaults production validation to CI. Local checks pass; final CI/deployment are external source-specific receipt steps, not invented outcomes.

| Requirement | Tasks | Evidence |
| --- | --- | --- |
| FR-001 | T003, T006, T008 | Specification/design and implementation commits; measured local checks in validation |
| FR-002 | T003, T008, T009, T010, T011, T012 | Specification/design and implementation commits; measured local checks in validation |
| FR-003 | T003, T008 | Specification/design and implementation commits; measured local checks in validation |
| FR-004 | T004, T006, T009 | Specification/design and implementation commits; measured local checks in validation |
| FR-005 | T001, T005, T008, T010 | Specification/design and implementation commits; measured local checks in validation |
| FR-006 | T001, T005, T008 | Specification/design and implementation commits; measured local checks in validation |
| FR-007 | T002, T004, T005, T006, T008, T009, T010, T011, T012 | Specification/design and implementation commits; measured local checks in validation |
| FR-008 | T001, T007, T008 | Specification/design and implementation commits; measured local checks in validation |

[Structured mapping](traceability.json) links actual commit objects, local design and tracked tests.
[Validation](validation.md) names measured checks and unfinished source-specific obligations.

Active approval/release guides commit `1dd153735ac7370c462884e2829e2f2c3e560682` records the required human decision rule; command flags are not treated as consent.

The observed first finalCI readiness gap and pre-editT010 record are commit`99bc9d6`. Test repair`c4f1be49d8a1b80d003d76f808c513f7a37d5a7c` and its real8+cleanup rerun support FR-002/FR-005/FR-007; they do not remove or retry product permission assertions. See [retest](validation.md#authenticated-workspace-readiness-retest).

## Integrated Delivery Stages

| Stage | Genuine commit | Evidence/status |
| --- | --- | --- |
| Concurrent-main finding and T011 | `935fb26b8a3dffcf4e5ca4f26a9f7b174f181620` | Main advanced after successful preintegration CI; stop recorded before integration. |
| Preserve both reviewed product changes | `38f16eba5779fb79183b7b9702fca2878f32112e` | Integrates mainPR48 without discarding featured documents or the optional-cloud policy. |
| Native-touch finding and T012 | `aef824d1e4e153c2679af4abc64dc067ce0ff8db` | Records231 passes/1failure and separate zero-case emulator-lock attempt before the test edit. |
| Native-scroll completion readiness | `42a000ad41b7e5f961935a0092de5297eec66454` | Uses real scrollend completion before the next tap; focused 11 and routine232 pass without retries/relaxed assertions. |
| Evidence index distinction | `468a5df855db2fc64ce9532471130d5a8af6edc5` | Accepted004 application checkpoint distinguished from integrated delivery; exact source for successful physical8-plus-cleanup rerun. |

FR-002/FR-007 map T011/T012 to [native touch tests](../../e2e/mobile-experience.spec.ts), [physical permissions](../../e2e/qa-permissions.spec.ts) and [integrated measured acceptance](validation.md#integrated-local-acceptance-before-final-freeze). Units 116 files/1,174 tests, complete lint/build, focused 11, routine232 and physical8-plus-cleanup are local evidence with their actual source/scope. Earlier failed CI and successful preintegration CI remain independent checkpoints. T008/T009 retain final exact-source CI and production release as external receipt obligations; no old run, current documentation commit or local result supplies future CI/deployment evidence.
