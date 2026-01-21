import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  FetchAppDetailsDocument,
  UpdateAppPrivateMetadataDocument,
} from "@/generated/graphql";
import { createLogger } from "@/lib/logger/create-logger";
import {
  getPayseraConfigFromMetadata,
  maskPassword,
  payseraConfigSchema,
  serializePayseraConfig,
} from "@/modules/paysera";
import { procedureWithGraphqlClient } from "../procedure/procedure-with-graphql-client";
import { router } from "../server";

export const configurationRouter = router({
  /**
   * Fetches the current Paysera configuration
   * Returns null if not configured
   */
  getConfig: procedureWithGraphqlClient.query(async ({ ctx }) => {
    const logger = createLogger("configurationRouter.getConfig");

    const result = await ctx.apiClient.query(FetchAppDetailsDocument, {});

    if (result.error) {
      logger.error("Failed to fetch app details", { error: result.error });
      throw new TRPCError({
        message: "Failed to fetch app configuration",
        code: "INTERNAL_SERVER_ERROR",
        cause: result.error,
      });
    }

    const privateMetadata = result.data?.app?.privateMetadata;

    try {
      const config = getPayseraConfigFromMetadata(privateMetadata);
      logger.info("Retrieved Paysera configuration", {
        projectId: config.projectId,
        testMode: config.testMode,
        passwordMasked: maskPassword(config.password),
      });

      return {
        projectId: config.projectId,
        testMode: config.testMode,
        isConfigured: true,
      };
    } catch {
      logger.info("Paysera configuration not found or invalid");
      return {
        projectId: "",
        testMode: true,
        isConfigured: false,
      };
    }
  }),

  /**
   * Saves the Paysera configuration to app privateMetadata
   */
  saveConfig: procedureWithGraphqlClient
    .input(
      z.object({
        projectId: payseraConfigSchema.shape.projectId,
        password: payseraConfigSchema.shape.password,
        testMode: payseraConfigSchema.shape.testMode,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const logger = createLogger("configurationRouter.saveConfig", {
        projectId: input.projectId,
        testMode: input.testMode,
      });

      // First, get the app ID
      const appResult = await ctx.apiClient.query(FetchAppDetailsDocument, {});

      if (appResult.error) {
        logger.error("Failed to fetch app details", { error: appResult.error });
        throw new TRPCError({
          message: "Failed to fetch app details",
          code: "INTERNAL_SERVER_ERROR",
          cause: appResult.error,
        });
      }

      const appId = appResult.data?.app?.id;

      if (!appId) {
        logger.error("App ID not found");
        throw new TRPCError({
          message: "App ID not found",
          code: "INTERNAL_SERVER_ERROR",
        });
      }

      // Serialize and save the configuration
      const configMetadata = serializePayseraConfig({
        projectId: input.projectId,
        password: input.password,
        testMode: input.testMode,
      });

      const updateResult = await ctx.apiClient.mutation(UpdateAppPrivateMetadataDocument, {
        id: appId,
        input: [configMetadata],
      });

      if (updateResult.error) {
        logger.error("Failed to update private metadata", { error: updateResult.error });
        throw new TRPCError({
          message: "Failed to save configuration",
          code: "INTERNAL_SERVER_ERROR",
          cause: updateResult.error,
        });
      }

      const errors = updateResult.data?.updatePrivateMetadata?.errors;
      if (errors && errors.length > 0) {
        logger.error("Metadata update returned errors", { errors });
        throw new TRPCError({
          message: errors.map((e) => e.message).join(", "),
          code: "INTERNAL_SERVER_ERROR",
        });
      }

      logger.info("Paysera configuration saved successfully");

      return {
        success: true,
      };
    }),
});
