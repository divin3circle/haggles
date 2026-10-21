/**
 * Background worker entrypoint (`node dist/worker.js`, `SPEC.md` sections 4.8, 7.2, 8.5, 9.2, and 14.3).
 *
 * Executes periodic facilitator maintenance jobs:
 * 1. Hold-expiry sweep (`releaseExpiredPayments`, every 15s, `SPEC.md` § 4.8)
 * 2. In-flight PayPal payout reconciliation (`reconcileProcessingPayouts`, every 15m, `SPEC.md` § 7.2 step 5)
 * 3. Ledger invariant verification (`verifyLedgerInvariants`, every 1h, `SPEC.md` §§ 8.5, 9.2)
 * 4. Weekly Monday 00:00 UTC scheduled payout sweep (`runScheduledPayoutSweep`, `SPEC.md` § 7.2 step 1)
 */

import pino from "pino";
import { LOGGER_REDACT_PATHS } from "./app.js";
import { loadConfig } from "./config.js";
import type { LedgerInvariantReport } from "./ledger/index.js";
import { FacilitatorService } from "./services/facilitator.js";

/**
 * Result of a single worker tick across all scheduled maintenance jobs.
 */
export interface WorkerTickResult {
  releasedPayments: number;
  reconciledPayouts: number;
  scheduledPayoutsCreated: number;
  invariants: LedgerInvariantReport;
}

/**
 * Runs one deterministic worker cycle against a `FacilitatorService` instance (`SPEC.md` §§ 4.8, 7.2, 8.5).
 *
 * @param facilitator - The facilitator service instance
 * @param options - Options controlling which periodic jobs run in this tick
 * @returns Summary of work performed
 *
 * @example
 * ```ts
 * const res = await runWorkerTick(facilitator, { runWeeklyPayoutSweep: true });
 * ```
 */
export async function runWorkerTick(
  facilitator: FacilitatorService,
  options: {
    now?: Date | undefined;
    runPayoutReconciliation?: boolean | undefined;
    runWeeklyPayoutSweep?: boolean | undefined;
    runInvariantCheck?: boolean | undefined;
  } = {},
): Promise<WorkerTickResult> {
  const now = options.now ?? new Date();
  const releasedPayments = await facilitator.releaseExpiredPayments(now);

  let reconciledPayouts = 0;
  if (options.runPayoutReconciliation ?? true) {
    reconciledPayouts = await facilitator.reconcileProcessingPayouts();
  }

  let scheduledPayoutsCreated = 0;
  const isMondayMidnightUtc =
    now.getUTCDay() === 1 && now.getUTCHours() === 0 && now.getUTCMinutes() === 0;
  if (options.runWeeklyPayoutSweep ?? isMondayMidnightUtc) {
    const payouts = await facilitator.runScheduledPayoutSweep(now);
    scheduledPayoutsCreated = payouts.length;
  }

  const invariants = facilitator.verifyLedgerInvariants();

  return {
    releasedPayments,
    reconciledPayouts,
    scheduledPayoutsCreated,
    invariants,
  };
}

/**
 * Starts the long-running background worker process with `SIGTERM` / `SIGINT` graceful shutdown (`SPEC.md` § 14.3).
 *
 * @example
 * ```ts
 * await startWorker();
 * ```
 */
export async function startWorker(): Promise<void> {
  const config = loadConfig();
  const logger = pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: [...LOGGER_REDACT_PATHS],
      censor: "[REDACTED]",
    },
  });

  const facilitator = await FacilitatorService.create(config);

  logger.info(
    { env: config.HAGGLES_ENV, paypalMode: config.PAYPAL_MODE },
    "Haggles background worker started",
  );

  let tickCount = 0;
  const timer = setInterval(() => {
    tickCount++;
    const runReconcile = tickCount % 60 === 0; // every 15m (60 * 15s)
    const runInvariants = tickCount % 240 === 0; // every 1h (240 * 15s)
    void runWorkerTick(facilitator, {
      runPayoutReconciliation: runReconcile,
      runInvariantCheck: runInvariants,
    })
      .then((res) => {
        if (!res.invariants.ok) {
          logger.error({ invariants: res.invariants }, "CRITICAL: Ledger invariant violation");
        } else if (
          res.releasedPayments > 0 ||
          res.reconciledPayouts > 0 ||
          res.scheduledPayoutsCreated > 0
        ) {
          logger.info(
            {
              releasedPayments: res.releasedPayments,
              reconciledPayouts: res.reconciledPayouts,
              scheduledPayoutsCreated: res.scheduledPayoutsCreated,
            },
            "Worker tick completed",
          );
        }
      })
      .catch((err: unknown) => {
        logger.error({ err }, "Worker tick failed");
      });
  }, 15_000);

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down Haggles background worker");
    clearInterval(timer);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (import.meta.main) {
  startWorker().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
