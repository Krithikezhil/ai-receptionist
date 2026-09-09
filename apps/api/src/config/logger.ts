import pino from "pino";
import { stdSerializers } from "pino-http";
import { env } from "./env.js";

type SerializedHttpRequest = ReturnType<typeof stdSerializers.req>;

const OAUTH_ROUTE_PREFIX = "/oauth";

/**
 * Every route mounted under /oauth (see routes/oauth.routes.ts, currently
 * just GET /oauth/google/callback) is part of the Google OAuth flow, and
 * its query string is by construction always either a signed state token
 * or an authorization code -- never anything safe to log.
 *
 * IMPORTANT: pino-http wraps any custom `serializers.req` function (see
 * wrapRequestSerializer in node_modules/pino-http/logger.js) so that it is
 * called with the ALREADY-SERIALIZED request object -- the output of the
 * standard serializer -- not the raw IncomingMessage. Confirmed
 * empirically against the real installed pino-http@11.0.0/pino@10.3.1:
 * the object this function receives already has exactly
 * {id, method, url, query, params, headers, remoteAddress, remotePort}.
 * This function must NOT call stdSerializers.req() itself -- doing so
 * would re-serialize an already-serialized object and silently corrupt it
 * (remoteAddress/remotePort are dropped, since the pre-serialized object
 * has neither `.info` nor `.socket`).
 *
 * pino's declarative `redact` option can't express this: fast-redact
 * paths are static and apply unconditionally to every log line, with no
 * way to condition one field's redaction on another field's value (e.g.
 * "blank query, but only when url starts with /oauth/"). And unlike a
 * plain redact rule, `url` is a single opaque string that can't be
 * partially redacted -- only fully blanked or left alone -- so a small
 * procedural serializer is what's needed here, not an addition to the
 * redact array.
 *
 * `url` is typed `string` by pino-std-serializers, but its actual
 * implementation can assign `undefined` in an edge case (a request
 * lacking originalUrl/path/url entirely) that the type doesn't reflect --
 * not reachable via genuine Express traffic in this app, but guarded
 * anyway: if the path can't be determined, `query` is blanked regardless,
 * failing toward "assume sensitive" rather than "assume safe."
 *
 * Falls through to the untouched serialized object for every path outside
 * /oauth -- no other route's request logging changes.
 */
export function httpRequestSerializer(serialized: SerializedHttpRequest): SerializedHttpRequest {
  const path =
    typeof serialized.url === "string" ? serialized.url.split("?")[0] : undefined;

  if (path === undefined) {
    return { ...serialized, query: {} };
  }

  if (path === OAUTH_ROUTE_PREFIX || path.startsWith(`${OAUTH_ROUTE_PREFIX}/`)) {
    return { ...serialized, url: path, query: {} };
  }

  return serialized;
}

export const logger = pino({
  level: env.logLevel,
  // req.headers.*: service-to-service/session/dashboard auth material.
  // res.headers.location: the ONLY res.redirect() call anywhere in
  // apps/api/src is calendar-connection.controller.ts's OAuth connect()
  // handler, which redirects to Google with the signed OAuth state in the
  // URL's query string -- confirmed by reading pino-std-serializers'
  // resSerializer (headers = res.getHeaders()) and verified empirically
  // that pino's declarative redact applies cleanly to "res.headers.location"
  // without needing a custom res serializer, redacting only that one
  // header on any response that happens to set it, everywhere else
  // untouched. The corresponding OAuth authorization code/state on the
  // REQUEST side (GET /oauth/google/callback) live in url/query, not a
  // header, and are handled separately by httpRequestSerializer above --
  // wired into pino-http's `serializers.req` option in app.ts.
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    'req.headers["x-organization-service-token"]',
    "res.headers.location",
  ],
});
