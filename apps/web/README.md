# apps/web

Next.js (App Router) + TypeScript + Tailwind CSS frontend for AI Receptionist.

This app is part of the `ai-receptionist` monorepo. See the [root README](../../README.md)
for prerequisites and full local-development instructions.

## Commands (run from repo root)

```bash
npm run dev -w apps/web      # start dev server (http://localhost:3000)
npm run build -w apps/web    # production build
npm run lint -w apps/web     # lint
```

## M1 status

This app currently contains only the default bootstrap landing page. No product features
(auth, dashboard, booking, billing, etc.) are implemented yet — see [TASKS.md](../../TASKS.md).
