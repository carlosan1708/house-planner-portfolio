# Application analytics

The platform owner has a global usage dashboard. Project administrator privileges do not grant access to this panel or its API. Data starts with the first recorded event; there is no historical reconstruction from activity logs.

## Definitions and filters

- A visitor is one browser cookie, including after sign-in. Clearing cookies or using another browser creates another visitor. A user is one authenticated Firebase UID. These metrics overlap and must not be added together.
- A global visit begins with meaningful activity and ends after 30 minutes without it. Navigation, project changes and sign-in retain the browser session. Each project additionally counts its first entry during that session. Global visits are not calculated by adding project visits.
- The dashboard counts visits started in its date range. A visit that crosses midnight remains counted on its start day while subsequent activity appears on the new day. Project visits are attributed to the day of first entry to that project.
- Dates use `America/Costa_Rica`. Default range is the last 30 calendar days; the supported window contains today and the preceding 89 days. Custom ranges are inclusive and must remain inside that window.
- Active time is an approximation based on visible, focused use with recent interaction. The client reports at most 60 seconds per heartbeat; the server caps credit against elapsed browser time across tabs. Hidden or zero-time heartbeats do not extend sessions.
- Owner activity is excluded unless `includeOwner=true`. Once a browser is associated with the owner by authenticated usage, its anonymous rows are also excluded. Other authenticated accounts sharing that browser remain visible. Configured QA accounts/projects, the fixed QA identities and headless QA user agents are excluded on the server.

## Interfaces

`POST /api/usage/events` accepts same-origin JSON, at most 16 KiB and 20 events. The batch carries `expectedEmail` (lowercase email or null), and events carry an ID, kind (`view`, `active`, `interaction`), context (`access`, `demo`, `project`), section and optional project/active-time/action. An identity change rejects the whole stale batch with 409. The server derives identity, authorization, owner/QA flags, session and timestamps; requested projects must match the approved active membership and section permissions.

Project clients can report explicit document opens/downloads and workbook downloads. Successful business mutations are recorded by authorized server routes through `recordUsageAction`, which never throws into those routes and waits at most 1.5 seconds. Failed or timed-out tracking emits a generic diagnostic code without private data. Demo interactions use a bounded allowlist. Events contain no document contents, names, URLs, query strings, assistant prompts or keystrokes. Deduplication and all session/summary updates commit in one Firestore transaction. Per-browser limits are 30 batches and 120 new client events per minute, stored durably rather than in process memory. Server actions bypass the client rate limit.

`GET /api/admin/analytics` accepts `from`, `to`, `context`, `projectId`, `includeOwner` and returns metadata, totals, daily series, section/project comparisons and identified users. `projectId` implies project context. Project options come from the project registry independently of the current range/filter. All responses use `Cache-Control: private, no-store, max-age=0`.

## Storage and retention

Collections are `housePlannerAnalyticsBrowsers`, `housePlannerAnalyticsSessions`, `housePlannerAnalyticsScopeSessions`, `housePlannerAnalyticsEvents`, `housePlannerAnalyticsDays` and `housePlannerAnalyticsMetadata`. Each known day contains paginated `usageRows` summaries keyed by browser, UID and scope. Each row carries both identities and one set of counters, avoiding duplicated metrics. Global and context rows are selected separately. Unique counts use a union of browser keys or UIDs across the selected summaries, not a sum of daily unique counts. The dashboard never scans raw events and does not silently truncate pages.

Metadata retains the activation date permanently. Events, sessions, scope markers, browser state and day summaries have a 90-day expiry. A daily OIDC-authenticated cleanup deletes expired records in batches of 400, including all child rows before deleting expired day parents. Expiration is enforced in dashboard range validation even before that job runs. No composite indexes or client Firestore access are required.

After the implementation is reviewed and deployed, run `scripts/configure-analytics-gcp.ps1` to create or update the daily 03:00 Costa Rica cleanup job. It reuses the scheduler account and authentication already configured for notifications, with a 270-second deadline below the service's 300-second request timeout and three retries with 60–300-second backoff. The OIDC audience must match `HOUSE_PLANNER_PUBLIC_URL`, so configure the final job against the canonical production URL. The script does not deploy application code. Analytics records are included by the existing full Firestore backup and are excluded from project QA reset collections. Verify the candidate owner page, non-owner 403, guest/demo/project events, identity change, duplicate batches, active-time cap and cleanup before production promotion.
