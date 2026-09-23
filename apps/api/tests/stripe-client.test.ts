import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStripeClient } from "../src/services/stripe-client.js";
import { StripeApiError } from "../src/services/stripe-client-types.js";

/**
 * M13 Step 5: exercises createStripeClient() with a mocked global fetch --
 * never a live Stripe request. Follows the client's own doc-comment
 * contract (see stripe-client.ts) and the four-way error-handling
 * convention (network failure / non-2xx / invalid JSON / malformed shape)
 * already established by google-calendar-client.ts.
 */
describe("createStripeClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response as Response);
  }

  it("POSTs to /v1/customers", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ id: "cus_123" }) });
    const client = createStripeClient("sk_test_123");

    await client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1");

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.stripe.com/v1/customers");
    expect(init.method).toBe("POST");
  });

  it("constructs HTTP Basic authentication from the secret key with an empty password", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ id: "cus_123" }) });
    const client = createStripeClient("sk_test_123");

    await client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1");

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("sk_test_123:").toString("base64")}`,
    );
  });

  it("sends an application/x-www-form-urlencoded body", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ id: "cus_123" }) });
    const client = createStripeClient("sk_test_123");

    await client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1");

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(typeof init.body).toBe("string");
  });

  it("includes metadata[organizationId] in the request body", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ id: "cus_123" }) });
    const client = createStripeClient("sk_test_123");

    await client.createCustomer({ organizationId: "org-42" }, "create-customer:org-42");

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const params = new URLSearchParams(init.body as string);
    expect(params.get("metadata[organizationId]")).toBe("org-42");
  });

  it("passes the exact Idempotency-Key header through", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ id: "cus_123" }) });
    const client = createStripeClient("sk_test_123");

    await client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1");

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("create-customer:org-1");
  });

  it("accepts a valid { id: string } response", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ id: "cus_valid" }) });
    const client = createStripeClient("sk_test_123");

    const result = await client.createCustomer(
      { organizationId: "org-1" },
      "create-customer:org-1",
    );

    expect(result).toEqual({ id: "cus_valid" });
  });

  it("translates a network error into StripeApiError", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network down"));
    const client = createStripeClient("sk_test_123");

    await expect(
      client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1"),
    ).rejects.toBeInstanceOf(StripeApiError);
  });

  it("translates a non-2xx response into StripeApiError", async () => {
    mockFetchOnce({ ok: false, status: 402, json: async () => ({ error: { message: "nope" } }) });
    const client = createStripeClient("sk_test_123");

    await expect(
      client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1"),
    ).rejects.toBeInstanceOf(StripeApiError);
  });

  it("rejects invalid JSON", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid JSON");
      },
    });
    const client = createStripeClient("sk_test_123");

    await expect(
      client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1"),
    ).rejects.toBeInstanceOf(StripeApiError);
  });

  it("rejects a malformed response shape (missing id)", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ object: "customer" }) });
    const client = createStripeClient("sk_test_123");

    await expect(
      client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1"),
    ).rejects.toBeInstanceOf(StripeApiError);
  });

  it("rejects a malformed response shape (non-string id)", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ id: 12345 }) });
    const client = createStripeClient("sk_test_123");

    await expect(
      client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1"),
    ).rejects.toBeInstanceOf(StripeApiError);
  });

  it("fails closed without calling fetch when the secret key is missing", async () => {
    const client = createStripeClient(undefined);

    await expect(
      client.createCustomer({ organizationId: "org-1" }, "create-customer:org-1"),
    ).rejects.toBeInstanceOf(StripeApiError);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
