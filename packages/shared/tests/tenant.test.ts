import { describe, expect, it } from "vitest";
import { toTenantId } from "../src/tenant.js";

describe("toTenantId", () => {
  it("wraps a plain string as a TenantId", () => {
    const id = toTenantId("org_123");
    expect(id).toBe("org_123");
  });
});
