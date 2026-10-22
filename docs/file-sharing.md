# Temporary file sharing

Project administrators and editors can choose **Share file** on an ordinary document or an
Aesthetics image/plan. Select 1, 3 or 7 days (7 is the default), create the link, then copy it.
The dialog displays the exact expiration time and provides a selectable URL when clipboard
access is unavailable. Anyone holding that URL can download that one file without signing in.
It does not grant access to the project or its other files.

Viewers, public read-link sessions and demo visitors cannot create links. Encrypted documents,
including files under encrypted ancestors, cannot be shared this way even when their vault is
unlocked. Existing section, project and folder permissions apply when creating a link and are
checked again against the creator's current membership when it is opened.

The link expires at the selected time. It also stops working if its creator loses the required
access, the file or its folder is deleted, its ancestry becomes unavailable, or the file moves
into an encrypted folder. Links refer to a specific stored object generation; replacing a file
does not turn an old link into access to the replacement. A recipient can retain a downloaded copy.

## Implementation and operating limits

The authenticated `POST /api/files/share` accepts `{kind, id, expiresInDays}` and returns
`{url, expiresAt, expiresInDays}`. `kind` is `document` or `aesthetic`; the server resolves the
stored source rather than accepting an object path from the browser. The public
`GET /api/files/share?token=…` checks the link and current access before delivering the pinned
file as an attachment with private/no-store caching and active-content protection.

Each link uses a cryptographically random 256-bit token. Only its SHA-256 hash is used as the
Firestore record ID; the raw token is returned to the creator and is not stored in the record.
Share records are server-only. Their expiration is enforced on every request, so scheduled
cleanup is not required to make a link expire. Treat a copied URL as a credential and avoid
putting it in analytics events, application logs or screenshots. There is no link-management
or individual revocation screen in this first version.

These are application capability links, rather than direct Cloud Storage V4 presigned URLs.
Although V4 allows an expiration of up to 7 days, Google's keyless `signBlob` signing keys rotate
and can make a direct URL stop working earlier. Serving the file through the application keeps
multi-day expiration independent of that signing-key rotation and requires no downloaded
service-account key or additional signing IAM grants. The application and its existing
Firestore/Storage access must remain available; downloads consume ordinary application and
storage traffic.

See Google's [signed URL limits](https://docs.cloud.google.com/storage/docs/access-control/signed-urls)
and [signing-key rotation guidance](https://docs.cloud.google.com/storage/docs/authentication/creating-signatures).

## Validation boundaries

Focused route tests cover successful anonymous delivery, expiration, tampering, creator/access
changes, project/folder/vault exclusions and object-generation binding. Component and bounded
Playwright fixtures exercise the real sharing controls with synthetic mocked HTTP responses.
Those checks do not establish deployed delivery or elapsed seven-day availability. Live cloud
QA remains optional and separately authorized under the [QA policy](qa-workflow.md).
