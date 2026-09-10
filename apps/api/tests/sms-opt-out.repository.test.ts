import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInMemorySmsOptOutRepository } from "./support/in-memory-organization-repositories.js";

describe("SmsOptOutRepository (in-memory)", () => {
  it("creates an opt-out and isOptedOut reports it for the matching organization and phone", async () => {
    const repo = createInMemorySmsOptOutRepository();
    const organizationId = randomUUID();
    await repo.optOut(organizationId, "+15551234567");
    expect(await repo.isOptedOut(organizationId, "+15551234567")).toBe(true);
  });

  it("isOptedOut returns false for a different organization with the same phone number", async () => {
    const repo = createInMemorySmsOptOutRepository();
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    await repo.optOut(organizationId, "+15551234567");
    expect(await repo.isOptedOut(otherOrganizationId, "+15551234567")).toBe(false);
  });

  it("isOptedOut returns false for a phone number that was never opted out", async () => {
    const repo = createInMemorySmsOptOutRepository();
    expect(await repo.isOptedOut(randomUUID(), "+15551234567")).toBe(false);
  });

  it("a duplicate opt-out is idempotent -- does not create a second row or throw", async () => {
    const repo = createInMemorySmsOptOutRepository();
    const organizationId = randomUUID();
    const first = await repo.optOut(organizationId, "+15551234567");
    const second = await repo.optOut(organizationId, "+15551234567");
    expect(second.id).toBe(first.id);
    expect(await repo.isOptedOut(organizationId, "+15551234567")).toBe(true);
  });

  it("removing an opt-out (optIn) reverses it", async () => {
    const repo = createInMemorySmsOptOutRepository();
    const organizationId = randomUUID();
    await repo.optOut(organizationId, "+15551234567");
    await repo.optIn(organizationId, "+15551234567");
    expect(await repo.isOptedOut(organizationId, "+15551234567")).toBe(false);
  });

  it("removing a nonexistent opt-out is a safe no-op", async () => {
    const repo = createInMemorySmsOptOutRepository();
    const organizationId = randomUUID();
    await expect(repo.optIn(organizationId, "+15551234567")).resolves.toBeUndefined();
    expect(await repo.isOptedOut(organizationId, "+15551234567")).toBe(false);
  });

  it("keeps organizations fully isolated -- opting out for one organization never affects another's independent opt-out state for the same phone number", async () => {
    const repo = createInMemorySmsOptOutRepository();
    const organizationA = randomUUID();
    const organizationB = randomUUID();

    await repo.optOut(organizationA, "+14155552671");
    expect(await repo.isOptedOut(organizationA, "+14155552671")).toBe(true);
    expect(await repo.isOptedOut(organizationB, "+14155552671")).toBe(false);

    await repo.optOut(organizationB, "+14155552671");
    await repo.optIn(organizationA, "+14155552671");
    expect(await repo.isOptedOut(organizationA, "+14155552671")).toBe(false);
    expect(await repo.isOptedOut(organizationB, "+14155552671")).toBe(true);
  });
});
