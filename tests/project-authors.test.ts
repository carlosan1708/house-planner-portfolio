import { describe, expect, it, vi } from "vitest";
import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";

const mock = vi.hoisted(() => ({ memberships: [] as Record<string, unknown>[], queries: [] as unknown[][] }));
vi.mock("@/lib/firebase-admin", () => ({ firestore: {
  collection: (collection: string) => ({ where: (field: string, operator: string, projectId: string) => {
    mock.queries.push([collection, field, operator, projectId]);
    return { get: async () => ({ docs: mock.memberships.filter((item) => item.projectId === projectId).map((item) => ({ data: () => item })) }) };
  } }),
} }));

import { activityHashForPayload, activityIntegrity, serializeActivity } from "@/lib/activity";
import { DEACTIVATED_USER_NAME, loadProjectAuthorDisplay, projectAuthorDisplay } from "@/lib/project-authors";
import { MEMBERSHIPS } from "@/lib/project";

const before = "2026-10-01T12:00:00.000Z";
const cutoff = "2026-10-08T12:00:00.000Z";
const after = "2026-10-09T12:00:00.000Z";
const membership = { projectId: "p1", uid: "removed-user", removed: true, removedEmail: "former@example.com", removedAt: Timestamp.fromDate(new Date(cutoff)) };

describe("removed project authors", () => {
  it("aliases removed authors by UID and all normalized historical emails", () => {
    const authors = projectAuthorDisplay([{ ...membership, removedEmails: ["old@example.com", "FORMER@example.com"] }]);
    expect(authors.display("Former name", before, membership.uid, "changed@example.com")).toBe(DEACTIVATED_USER_NAME);
    expect(authors.display(" FORMER@EXAMPLE.COM ", before)).toBe(DEACTIVATED_USER_NAME);
    expect(authors.display("old@example.com", before)).toBe(DEACTIVATED_USER_NAME);
    expect(authors.display("Current person", before, "another-user", "current@example.com")).toBe("Current person");
  });

  it("retains old aliases after readmission while showing new contributions normally", () => {
    const authors = projectAuthorDisplay([{ ...membership, removed: false }]);
    expect(authors.display("former@example.com", before)).toBe(DEACTIVATED_USER_NAME);
    expect(authors.display("Former name", cutoff, membership.uid)).toBe(DEACTIVATED_USER_NAME);
    expect(authors.display("Former name", after, membership.uid)).toBe("Former name");
    expect(authors.display("former@example.com", Timestamp.fromDate(new Date(after)))).toBe("former@example.com");
    expect(authors.display("former@example.com", undefined)).toBe(DEACTIVATED_USER_NAME);
  });

  it("does not expose operations completed while a membership remains removed", () => {
    const authors = projectAuthorDisplay([membership]);
    expect(authors.display("former@example.com", after)).toBe(DEACTIVATED_USER_NAME);
    expect(projectAuthorDisplay([{ ...membership, removedAt: undefined }]).display("former@example.com", before)).toBe(DEACTIVATED_USER_NAME);
  });

  it("redacts each author using its own date without changing content or stored records", () => {
    const authors = projectAuthorDisplay([{ ...membership, removed: false }]);
    const record = { createdBy: "former@example.com", createdAt: before, updatedBy: "former@example.com", updatedAt: after,
      title: "former@example.com", content: "Text written by Former name", owner: "Former name", assignee: "former@example.com" };
    expect(authors.redact(record)).toEqual({ ...record, createdBy: DEACTIVATED_USER_NAME });
    expect(record.createdBy).toBe("former@example.com");
    const approval = { requested_by: "former@example.com", created_at: before, reviewed_by: "former@example.com", reviewed_at: after };
    expect(authors.redact(approval)).toEqual({ ...approval, requested_by: DEACTIVATED_USER_NAME });
  });

  it("loads author history only for the selected project", async () => {
    mock.memberships = [membership, { projectId: "p2", uid: "active", removed: false }];
    mock.queries.length = 0;
    const authors = await loadProjectAuthorDisplay("p2");
    expect(mock.queries).toEqual([[MEMBERSHIPS, "projectId", "==", "p2"]]);
    expect(authors.display("former@example.com", before)).toBe("former@example.com");
  });

  it("aliases signed activity after verifying its original payload", () => {
    const payload = { schemaVersion: 1, projectId: "p1", sequence: 1, previousHash: "", category: "document", action: "document.uploaded", source: "user",
      actorUid: membership.uid, actorName: "Former name", actorEmail: membership.removedEmail, actorRole: "editor",
      target: { type: "document", id: "d1", label: "Plan.pdf", section: "documents", exists: true }, summaryParams: {}, changes: [], changeCount: 0,
      occurredAt: before, visibility: { requiredTabs: ["documents"], folderTopLevelId: null, folderTopLevelIds: [], allowUnfiledRequired: false, adminOnly: false }, detailsObjectKey: null };
    const record = { ...payload, integrityHash: activityHashForPayload(payload) };
    const snapshot = { id: "event-1", data: () => record } as unknown as DocumentSnapshot;
    const serialized = serializeActivity(snapshot, projectAuthorDisplay([membership]));
    expect(serialized.actor).toMatchObject({ uid: membership.uid, name: DEACTIVATED_USER_NAME });
    expect(serialized.integrity).toBe("verified");
    expect(record.actorName).toBe("Former name");
    expect(activityIntegrity(record)).toBe("verified");
    expect(serializeActivity(snapshot, projectAuthorDisplay([])).actor.name).toBe("Former name");
    const accessPayload = { ...payload, category: "access", action: "access.member_access_changed",
      actorUid: "owner", actorName: "Owner", actorEmail: "owner@example.com",
      target: { type: "member", id: membership.uid, label: "Former name", section: "overview", exists: true } };
    const accessRecord = { ...accessPayload, integrityHash: activityHashForPayload(accessPayload) };
    const accessSnapshot = { id: "access-1", data: () => accessRecord } as unknown as DocumentSnapshot;
    const accessEvent = serializeActivity(accessSnapshot, projectAuthorDisplay([membership]));
    expect(accessEvent.actor.name).toBe("Owner");
    expect(accessEvent.target.label).toBe(DEACTIVATED_USER_NAME);
    expect(accessEvent.integrity).toBe("verified");
    expect(accessRecord.target.label).toBe("Former name");
  });
});
