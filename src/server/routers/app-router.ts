import { router } from "../server";
import { configurationRouter } from "./configuration.router";

export const appRouter = router({
  configuration: configurationRouter,
});

export type AppRouter = typeof appRouter;
