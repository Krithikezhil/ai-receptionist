import type { ServiceHealth } from "@ai-receptionist/shared";

export interface HealthStatus extends ServiceHealth {
  service: "api";
  uptimeSeconds: number;
}

/**
 * M1 health check is intentionally shallow: no DB/Redis connectivity checks
 * yet, since those data stores are not wired up in this milestone.
 */
export function getHealthStatus(): HealthStatus {
  return {
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };
}
