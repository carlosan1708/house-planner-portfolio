# Documentation

Start with the [project README](../README.md). This is a curated public snapshot; source inspection
is permitted, while building or reusing the application requires [written permission](../LICENSE).
See [snapshot provenance](portfolio/snapshot.md) for history and deployment boundaries. Choose the path that matches your goal.

| Goal | Read |
|---|---|
| Evaluate the product | [Synthetic demo](https://house-planner-prod-173941028457.us-central1.run.app/?mode=demo&lang=en), [profile card draft](portfolio/profile-card.md) |
| Understand the engineering | [System](architecture/system.md), [AI assistant](architecture/assistant.md), [workbooks](architecture/workbooks.md), [security](architecture/security.md), [3D models](architecture/distribution.md) |
| Develop and validate locally | [Setup](../DEVELOPMENT.md), [testing](development/testing.md), [contributing](../CONTRIBUTING.md) |
| Inspect SDD | [Method and kit](development/sdd.md), [preparation archive](../specs/001-portfolio/spec.md), [operational delivery](../specs/002-portfolio-release/spec.md), [traceability](../specs/002-portfolio-release/traceability.md), [reconstructed cases](development/cases/README.md) |
| Operate an authorized installation | [Releases](operations/releases.md), [history migration](operations/history-migration.md), [unified payments](operations/payment-ledger.md), [backups](../infra/BACKUPS.md) |
| Review additional features | [Document search](document-search.md), [temporary file sharing](file-sharing.md), [Google Sheets](google-sheets-editing.md), [encrypted folders](encrypted-folders.md), [analytics](app-analytics.md), [member removal](project-member-removal.md) |
| Review QA policy | [QA workflow](qa-workflow.md), [manual browser evidence](manual-browser-qa.md), [author-approved optional cloud policy](../specs/005-optional-cloud-qa/spec.md) |
| Check publication preparation | [Snapshot](portfolio/snapshot.md), [sanitation](portfolio/sanitation.md), [current validation](portfolio/validation.md), [license](../LICENSE), [notices](../THIRD_PARTY_NOTICES.md) |

Design cases describe current implementation and its limits. The portfolio feature folder records
separate specification-first deliveries: curated preparation, additive operational integration, and
the [bilingual demo correction](../specs/003-demo-localization/spec.md) with its own
[traceability](../specs/003-demo-localization/traceability.md) and [validation](../specs/003-demo-localization/validation.md).
The [featured-document delivery](../specs/004-featured-documents/spec.md) adds manually curated Documents entry points with independently enforced section/folder grants. Its [traceability](../specs/004-featured-documents/traceability.md) and [validation](../specs/004-featured-documents/validation.md) separate deterministic/mocked browser checks, physical local-emulator evidence and the accepted application checkpoint from the separately pending integrated delivery.
The [005 policy amendment](../specs/005-optional-cloud-qa/spec.md) makes cloud QA optional for
every change, with explicit per-session user approval. Standard trusted CI remains the default;
operational guides retain authorized infrastructure, backup and exact-source release gates.

- [House Planner project skills](development/project-skills.md)

The current [009 CI policy](../specs/009-standard-ci/spec.md) requires static review, unit tests, build and applicable bounded Playwright; full regression is optional and manually requested.
