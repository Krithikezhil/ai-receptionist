# services/voice-agent

Python voice service for AI Receptionist. Independently deployable from `apps/api` and `apps/web`.

Part of the `ai-receptionist` monorepo — see the [root README](../../README.md) for
prerequisites and full local-development instructions.

## Python version

Managed by [uv](https://docs.astral.sh/uv/), pinned to **Python 3.12** (`.python-version`,
`requires-python = ">=3.12,<3.13"` in `pyproject.toml`) — independent of whatever Python
version is installed system-wide. `uv sync` downloads and manages this project's Python 3.12
interpreter itself; it does not touch system Python.

We chose 3.12 over the system's 3.14 because 3.12 is the current recommended baseline for the
scientific/AI Python ecosystem (voice/ML libraries this service will depend on from M4 onward,
including Pipecat, typically publish and test against 3.10–3.12 first); pinning now avoids a
version migration later once real dependencies are added.

## Structure

```
src/voice_agent/
  config.py       environment settings
  routes/         FastAPI routers
  services/       business logic, framework-agnostic
  main.py         FastAPI app factory + entrypoint
tests/            pytest
```

## Commands (run from this directory)

```bash
uv sync                  # install dependencies into .venv (Python 3.12)
uv run voice-agent       # start the server (http://localhost:8000)
uv run pytest            # run tests
uv run ruff check .      # lint
uv run ruff format .     # format
uv run mypy src          # type-check
```

## Endpoints (M1)

* `GET /health` — liveness check. Does not check any external dependency (no database,
  no telephony provider, no Pipecat) — none are wired up yet.

## M1 status

Only the health endpoint exists. **Pipecat is not installed or integrated in M1** — voice
conversation, STT, TTS, and telephony arrive in M4/M5. See [TASKS.md](../../TASKS.md).
