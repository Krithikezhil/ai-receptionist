import { createApp } from "./app.js";
import { assertAuthSecret, assertServiceAuthSecret, env } from "./config/env.js";
import { logger } from "./config/logger.js";

assertAuthSecret();
assertServiceAuthSecret();

const app = createApp();

app.listen(env.port, () => {
  logger.info(`api listening on port ${env.port} (${env.nodeEnv})`);
});
