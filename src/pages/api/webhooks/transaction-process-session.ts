import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { v7 as uuidv7 } from "uuid";
import { saleorApp } from "@/saleor-app";
import {
  TransactionEventTypeEnum,
  TransactionFlowStrategyEnum,
  TransactionProcessSessionDocument,
  TransactionProcessSessionEventFragment,
} from "@/generated/graphql";
import { createLogger } from "@/lib/logger/create-logger";
import { dataSchema, ResponseType } from "@/modules/validation/sync-transaction";
import { getZodErrorMessage } from "@/lib/zod-error";
import { getTransactionActions } from "@/lib/transaction-actions";
import { AppUrlGenerator } from "@/modules/url/app-url-generator";
import { wrapWithLoggerContext } from "@/lib/logger/logger-context";
import { withOtel } from "@/lib/otel/otel-wrapper";
import { loggerContext } from "@/logger-context";

export const transactionProcessSessionWebhook =
  new SaleorSyncWebhook<TransactionProcessSessionEventFragment>({
    name: "Transaction Process Session",
    webhookPath: "api/webhooks/transaction-process-session",
    event: "TRANSACTION_PROCESS_SESSION",
    apl: saleorApp.apl,
    query: TransactionProcessSessionDocument,
  });

export default wrapWithLoggerContext(
  withOtel(
    transactionProcessSessionWebhook.createHandler((req, res, ctx) => {
      const logger = createLogger("transaction-process-session");
      const { payload } = ctx;
      const { actionType, amount } = payload.action;

      logger.debug("Received webhook", { payload });

      const rawEventData = payload.data;
      const dataResult = dataSchema.safeParse(rawEventData);

      if (dataResult.error) {
        logger.warn("Invalid data field received in notification", { error: dataResult.error });

        // Report the payment as still in progress, NOT as failed. This handler is
        // the unmodified app-template stub: `dataSchema` only accepts the
        // template's own test-harness shape, so any real caller lands here. The
        // Paysera flow never calls `transactionProcess` (only the Adyen and
        // Stripe drop-ins do), but declaring a live payment dead because this
        // stub could not parse its payload would be a bad way to find that out.
        // A *_REQUEST result leaves the real callback free to resolve it.
        const errorResponse: ResponseType = {
          pspReference: uuidv7(),
          result:
            actionType === TransactionFlowStrategyEnum.Charge
              ? "CHARGE_REQUEST"
              : "AUTHORIZATION_REQUEST",
          message: getZodErrorMessage(dataResult.error),
          amount,
          actions: [],
          data: {
            exception: true,
          },
        };

        logger.info("Returning error response to Saleor", { response: errorResponse });

        return res.status(200).json(errorResponse);
      }

      const data = dataResult.data;

      logger.info("Parsed data field from notification", { data });

      const urlGenerator = new AppUrlGenerator(ctx.authData);

      const successResponse: ResponseType = {
        pspReference: data.event.includePspReference ? uuidv7() : undefined,
        result: data.event.type,
        message: "Operacija sėkminga",
        actions: getTransactionActions(data.event.type as TransactionEventTypeEnum),
        amount,
        externalUrl: urlGenerator.getTransactionDetailsUrl(payload.transaction.id),
      };

      logger.info("Returning response to Saleor", { response: successResponse });

      return res.status(200).json(successResponse);
    }),
    "/api/webhooks/transaction-process-session"
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
