import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createRepositories } from "./repositories/index.js";
import { createApiRouter } from "./routes/index.js";
import { createAuthService, type AuthService } from "./services/auth.service.js";

export interface AppDependencies {
  /** Injected in tests to avoid needing a real Postgres connection. */
  authService?: AuthService;
}

export function createApp(deps: AppDependencies = {}): Express {
  const authService = deps.authService ?? createAuthService(createRepositories());

  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use(createApiRouter(authService));

  // Centralized error handler: never leak stack traces or internal error
  // details to clients. Express 5 forwards rejected async handler promises
  // here automatically.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}
