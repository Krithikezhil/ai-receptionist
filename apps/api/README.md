# apps/api

TypeScript API for AI Receptionist (Express 5).

Part of the `ai-receptionist` monorepo — see the [root README](../../README.md) for
prerequisites and full local-development instructions.

## Structure

```
src/
  config/       environment + logger setup
  routes/       Express routers (URL -> controller wiring)
  controllers/  HTTP request/response handling
  services/     business logic, framework-agnostic
  app.ts        Express app factory (used by tests)
  server.ts     process entrypoint (binds a port)
tests/          Vitest + Supertest
```

## Commands (run from repo root)

```bash
npm run dev -w apps/api         # start dev server with reload (http://localhost:4000)
npm run build -w apps/api       # compile to dist/
npm run start -w apps/api       # run compiled server
npm run test -w apps/api        # run tests
npm run lint -w apps/api        # lint
npm run typecheck -w apps/api   # type-check only
```

## Endpoints (M1)

* `GET /health` — liveness check. Does not check database/Redis connectivity
  (neither is wired up yet in M1).

## M1 status

Only the health endpoint exists. No auth, tenant, business, call, or billing routes are
implemented — see [TASKS.md](../../TASKS.md).
