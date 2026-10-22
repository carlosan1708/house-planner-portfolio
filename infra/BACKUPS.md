# House Planner backups

- Firestore: managed daily backups retained for 14 weeks, plus 7-day point-in-time recovery.
- Primary uploads bucket: object versioning and 7-day soft delete.
- Backup uploads bucket: daily Storage Transfer copy, object versioning, and 30-day soft delete.
- Noncurrent object versions are retained for 90 days.

Backups include project subcollections such as `activityEvents` and `activityMetadata`. Protected workbook activity details under each project's `activity-details/` Storage prefix must be restored together with their Firestore events.

Production data is never deleted as part of deployment. Restore operations should first be tested against a separate database or object prefix.
