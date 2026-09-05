"""Centralized, secret-safe logging setup for the voice-agent service (M6).

There is exactly one place in this codebase that configures logging — this
module — and session.py is the only module expected to call get_logger()
and emit log records for session lifecycle events. Routing every log call
through one place makes the never-log rule below something to review once,
not something every future call site has to remember independently (the
same reasoning as apps/api/src/config/logger.ts's pino redaction on the
Node side of this system).

This module does NOT scan, filter, or redact log messages automatically —
it is a plain stdlib logging.Logger factory. The safety guarantee below
comes entirely from discipline at the call site (session.py): only ever
logging the specific safe fields listed, never a raw value that might
contain something on the never-log list. Treat this list as a reviewed
contract for session.py, not an automatic mechanism:

NEVER log:
  * INTERNAL_SERVICE_KEY, X-Organization-Service-Token, or any other
    *_API_KEY / *_SERVICE_KEY / *_TOKEN value.
  * The Authorization or X-Organization-Service-Token HTTP header value.
  * Conversation/transcript content (anything a caller said, or the bot
    said back).
  * Tool call arguments or results (search_knowledge queries/results may
    contain caller-supplied or business-sensitive text).
  * Raw request/response bodies from apps/api or any provider SDK.
  * An exception's raw args/str() when it might embed request/response
    content (e.g. an HTTP client error whose message includes the response
    body) — log the exception's class name and a short, static description
    instead.

Safe to log: a locally-generated session id, organization id and the
organization's own configured business name (both already flow through
non-secret URLs/responses today — the business name is public-facing
content the organization itself set, never caller-supplied, same trust
tier as organization id), provider names, event/reason
(start/end/error/timeout/disconnect), and duration.

Pipecat's own internals log via loguru, independently of this module —
that is the framework's own diagnostic logging, not something this module
configures or is responsible for.
"""

from __future__ import annotations

import logging

_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"

_configured = False


def _configure(level: str) -> None:
    global _configured
    if _configured:
        return
    logging.basicConfig(level=level.upper(), format=_LOG_FORMAT)
    _configured = True


def get_logger(name: str, *, level: str = "info") -> logging.Logger:
    """Returns a stdlib logger for the given module name.

    level only takes effect on the first call in a process (stdlib
    logging.basicConfig is a one-time global setup) — pass
    Settings.log_level from the earliest call site (session.py).
    """
    _configure(level)
    return logging.getLogger(name)
