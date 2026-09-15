import { describe, expect, it } from "vitest";
import { httpRequestSerializer } from "../src/config/logger.js";

// Derived directly from the production function's own parameter type --
// never redeclared/duplicated, so this can't silently drift out of sync
// with config/logger.ts.
type SerializedHttpRequest = Parameters<typeof httpRequestSerializer>[0];

/**
 * Builds an object shaped exactly like what pino-http actually hands
 * httpRequestSerializer -- confirmed empirically in this session's M10
 * Step 6 File 4 compatibility check: {id, method, url, query, params,
 * headers, remoteAddress, remotePort}, with NO .socket/.info/.originalUrl
 * (those only exist on the raw IncomingMessage, already consumed by
 * pino-http's own wrapping before this function ever runs). `raw` is
 * required by the SerializedRequest type but never read by
 * httpRequestSerializer itself, so a placeholder value is fine here.
 */
function makeSerializedRequest(overrides: Partial<SerializedHttpRequest> = {}): SerializedHttpRequest {
  return {
    id: "1",
    method: "GET",
    url: "/health",
    query: {},
    params: {},
    headers: { host: "localhost" },
    remoteAddress: "127.0.0.1",
    remotePort: 54321,
    raw: {} as SerializedHttpRequest["raw"],
    ...overrides,
  };
}

describe("httpRequestSerializer", () => {
  it("removes the query string from url and blanks query for GET /oauth/google/callback", () => {
    const input = makeSerializedRequest({
      url: "/oauth/google/callback?code=test-code&state=test-state",
      query: { code: "test-code", state: "test-state" },
    });
    const result = httpRequestSerializer(input);
    expect(result.url).toBe("/oauth/google/callback");
    expect(result.query).toEqual({});
  });

  it("removes the query string and blanks query for any other /oauth/* route", () => {
    const input = makeSerializedRequest({
      url: "/oauth/anything?secret=value",
      query: { secret: "value" },
    });
    const result = httpRequestSerializer(input);
    expect(result.url).toBe("/oauth/anything");
    expect(result.query).toEqual({});
  });

  it("treats the bare /oauth path (no trailing segment) the same way", () => {
    const input = makeSerializedRequest({ url: "/oauth?x=1", query: { x: "1" } });
    const result = httpRequestSerializer(input);
    expect(result.url).toBe("/oauth");
    expect(result.query).toEqual({});
  });

  it("leaves a non-OAuth URL's query string and query object completely untouched", () => {
    const input = makeSerializedRequest({ url: "/health?foo=bar", query: { foo: "bar" } });
    const result = httpRequestSerializer(input);
    expect(result).toBe(input);
  });

  it("leaves a non-OAuth URL with no query string untouched", () => {
    const input = makeSerializedRequest({ url: "/health", query: {} });
    const result = httpRequestSerializer(input);
    expect(result).toBe(input);
  });

  it("does not treat a path that merely starts with 'oauth' but isn't under /oauth/ as an OAuth route", () => {
    const input = makeSerializedRequest({
      url: "/oauthsomethingelse?x=1",
      query: { x: "1" },
    });
    const result = httpRequestSerializer(input);
    expect(result).toBe(input);
    expect(result.url).toBe("/oauthsomethingelse?x=1");
    expect(result.query).toEqual({ x: "1" });
  });

  it("blanks query defensively when the serialized url is not a string (fail-closed)", () => {
    // url is typed `string` by pino-std-serializers, but this deliberately
    // violates that type to exercise the runtime guard -- see
    // config/logger.ts's own comment on this edge case.
    const malformed = {
      ...makeSerializedRequest(),
      url: undefined,
    } as unknown as SerializedHttpRequest;

    const result = httpRequestSerializer(malformed);
    expect(result.query).toEqual({});
  });

  it("preserves every other field unchanged for a non-OAuth URL (proves no re-serialization)", () => {
    const input = makeSerializedRequest({
      id: "42",
      method: "POST",
      url: "/organizations/org-1/knowledge",
      query: {},
      params: { organizationId: "org-1" },
      headers: { host: "localhost", "user-agent": "vitest" },
      remoteAddress: "203.0.113.5",
      remotePort: 443,
    });
    const result = httpRequestSerializer(input);
    // Reference equality: the non-OAuth, valid-url branch returns the
    // exact same object, not a copy -- the strongest possible proof that
    // nothing was re-derived (a real double-serialization would have
    // dropped remoteAddress/remotePort, since the input has no
    // .socket/.info for stdSerializers.req to read them from).
    expect(result).toBe(input);
  });

  it("preserves method, headers, remoteAddress, remotePort, id, and params when the URL is under /oauth/", () => {
    const input = makeSerializedRequest({
      id: "7",
      method: "GET",
      url: "/oauth/google/callback?code=abc&state=xyz",
      query: { code: "abc", state: "xyz" },
      params: {},
      headers: { host: "localhost", "user-agent": "vitest" },
      remoteAddress: "198.51.100.9",
      remotePort: 8080,
    });
    const result = httpRequestSerializer(input);
    expect(result.id).toBe(input.id);
    expect(result.method).toBe(input.method);
    expect(result.headers).toEqual(input.headers);
    expect(result.remoteAddress).toBe(input.remoteAddress);
    expect(result.remotePort).toBe(input.remotePort);
    expect(result.params).toEqual(input.params);
    // Only these two fields are expected to differ:
    expect(result.url).toBe("/oauth/google/callback");
    expect(result.query).toEqual({});
  });
});
