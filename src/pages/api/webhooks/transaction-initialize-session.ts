import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { saleorApp } from "@/saleor-app";
import {
  TransactionFlowStrategyEnum,
  TransactionInitializeSessionDocument,
  TransactionInitializeSessionEventFragment,
} from "@/generated/graphql";
import { v7 as uuidv7 } from "uuid";
import { getTransactionActions } from "@/lib/transaction-actions";
import { createLogger } from "@/lib/logger/create-logger";
import { ResponseType } from "@/modules/validation/sync-transaction";
import { AppUrlGenerator } from "@/modules/url/app-url-generator";
import { wrapWithLoggerContext } from "@/lib/logger/logger-context";
import { withOtel } from "@/lib/otel/otel-wrapper";
import { loggerContext } from "@/logger-context";
import {
  getPayseraConfigFromMetadata,
  PayseraClient,
  PayseraConfigError,
  maskPassword,
} from "@/modules/paysera";

export const transactionInitializeSessionWebhook =
  new SaleorSyncWebhook<TransactionInitializeSessionEventFragment>({
    name: "Transaction Initialize Session",
    webhookPath: "api/webhooks/transaction-initialize-session",
    event: "TRANSACTION_INITIALIZE_SESSION",
    apl: saleorApp.apl,
    query: TransactionInitializeSessionDocument,
  });

function getExternalApiBaseUrl(req: { headers: { host?: string } }): string {
  // Use APP_API_BASE_URL if configured (for Docker/local development)
  if (process.env.APP_API_BASE_URL) {
    return process.env.APP_API_BASE_URL;
  }
  // Fall back to the host header
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${protocol}://${req.headers.host}`;
}

export default wrapWithLoggerContext(
  withOtel(
    transactionInitializeSessionWebhook.createHandler((req, res, ctx) => {
      const logger = createLogger("transaction-initialize-session");
      const { payload } = ctx;
      const { actionType, amount, currency } = payload.action;

      logger.debug("Received webhook", { payload });

      const urlGenerator = new AppUrlGenerator(ctx.authData);
      const pspReference = uuidv7();

      // Get Paysera configuration from app privateMetadata
      let payseraConfig;
      try {
        payseraConfig = getPayseraConfigFromMetadata(payload.recipient?.privateMetadata);
        logger.info("Paysera config loaded", {
          projectId: payseraConfig.projectId,
          testMode: payseraConfig.testMode,
          passwordMasked: maskPassword(payseraConfig.password),
        });
      } catch (error) {
        logger.error("Failed to load Paysera configuration", { error });

        const errorResponse: ResponseType = {
          pspReference,
          result:
            actionType === TransactionFlowStrategyEnum.Charge
              ? "CHARGE_FAILURE"
              : "AUTHORIZATION_FAILURE",
          message:
            error instanceof PayseraConfigError
              ? error.message
              : "Paysera payment gateway is not configured",
          amount,
          actions: [],
          data: {
            error: "CONFIGURATION_ERROR",
          },
        };

        return res.status(200).json(errorResponse);
      }

      // Create Paysera client
      const payseraClient = new PayseraClient(payseraConfig);

      // Build callback URLs
      const baseUrl = getExternalApiBaseUrl(req);
      const transactionId = payload.transaction.id;

      // Extract customer information from sourceObject
      const sourceObject = payload.sourceObject;
      let customerEmail: string | undefined;
      let customerFirstName: string | undefined;
      let customerLastName: string | undefined;
      let language: string | undefined;

      if (sourceObject) {
        if ("email" in sourceObject && sourceObject.email) {
          customerEmail = sourceObject.email;
        } else if ("userEmail" in sourceObject && sourceObject.userEmail) {
          customerEmail = sourceObject.userEmail;
        }

        const billingAddress = sourceObject.billingAddress;
        if (billingAddress) {
          customerFirstName = billingAddress.firstName;
          customerLastName = billingAddress.lastName;
        }

        if ("languageCode" in sourceObject && sourceObject.languageCode) {
          // Convert from enum like EN_US to just "en"
          language = sourceObject.languageCode.toString().split("_")[0].toLowerCase();
        }
      }

      // Create payment request
      const saleorApiUrl = encodeURIComponent(ctx.authData.saleorApiUrl);
      try {
        const paymentRequest = payseraClient.createPaymentRequest({
          transactionId,
          amount,
          currency,
          urls: {
            acceptUrl: `${baseUrl}/api/paysera/callback?action=accept&transactionId=${transactionId}&saleorApiUrl=${saleorApiUrl}`,
            cancelUrl: `${baseUrl}/api/paysera/callback?action=cancel&transactionId=${transactionId}&saleorApiUrl=${saleorApiUrl}`,
            callbackUrl: `${baseUrl}/api/paysera/callback?action=callback&transactionId=${transactionId}&saleorApiUrl=${saleorApiUrl}`,
          },
          customerEmail,
          customerFirstName,
          customerLastName,
          paymentDescription: `Payment for order ${payload.merchantReference || transactionId}`,
          language,
        });

        logger.info("Paysera payment request created", {
          orderId: paymentRequest.orderId,
          transactionId,
          amount,
          currency,
          testMode: payseraConfig.testMode,
        });

        const successResponse: ResponseType = {
          pspReference,
          result: "CHARGE_ACTION_REQUIRED",
          message: "Redirect to Paysera to complete payment",
          actions: getTransactionActions("CHARGE_ACTION_REQUIRED"),
          amount,
          externalUrl: paymentRequest.redirectUrl,
          data: {
            payseraOrderId: paymentRequest.orderId,
          },
        };

        logger.info("Returning response to Saleor", { response: successResponse });

        return res.status(200).json(successResponse);
      } catch (error) {
        logger.error("Failed to create Paysera payment request", { error });

        const errorResponse: ResponseType = {
          pspReference,
          result:
            actionType === TransactionFlowStrategyEnum.Charge
              ? "CHARGE_FAILURE"
              : "AUTHORIZATION_FAILURE",
          message: error instanceof Error ? error.message : "Failed to create payment request",
          amount,
          actions: [],
          data: {
            error: "PAYMENT_REQUEST_ERROR",
          },
        };

        return res.status(200).json(errorResponse);
      }
    }),
    "/api/webhooks/transaction-initialize-session"
  ),
  loggerContext
);

/**
 * Disable body parser for this endpoint, so signature can be verified
 */
export const config = {
  api: {
    bodyParser: false,
  },
};
