import { evaluateBudgetsJob } from "../modules/budgets/evaluate.job.js";
import { importJob } from "../modules/imports/import.job.js";
import { cleanupJob } from "../modules/maintenance/cleanup.job.js";
import { invitationEmailJob } from "../modules/households/invitation.job.js";
import { emailJob } from "../modules/notifications/email.job.js";
import { runDueRecurringJob } from "../modules/recurring/run-due.job.js";
import type { JobDefinition } from "./registry.js";
import type { Schedule } from "./worker.js";

/** Every job type the worker knows how to run. */
export const jobDefinitions = (config: {
  appUrl: string;
  encryptionKey: Buffer;
}): JobDefinition[] =>
  [
    importJob,
    evaluateBudgetsJob,
    runDueRecurringJob,
    emailJob(config.appUrl),
    invitationEmailJob(config),
    cleanupJob,
  ] as JobDefinition[];

/** Jobs that run on a timer, not because something happened. */
export const schedules: Schedule[] = [
  { job: "recurring.run-due", everySeconds: 15 * 60 },
  { job: "maintenance.cleanup", everySeconds: 24 * 60 * 60 },
];
