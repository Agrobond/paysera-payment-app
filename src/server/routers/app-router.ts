import { router } from "../server";
import { configurationRouter } from "./configuration.router";
import { transactionReporterRouter } from "./transaction-reporter.router";

export const appRouter = router({
  transactionReporter: transactionReporterRouter,
  configuration: configurationRouter,
});

export type AppRouter = typeof appRouter;
