import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";
import { v7 as uuidv7 } from "uuid";
import { saleorApp } from "@/saleor-app";
import {
  TransactionFlowStrategyEnum,
  TransactionProcessSessionDocument,
  TransactionProcessSessionEventFragment,
} from "@/generated/graphql";
import { createLogger } from "@/lib/logger/create-logger";
import { ResponseType } from "@/modules/validation/sync-transaction";
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

      // SECURITY — never derive the payment result from `payload.data`.
      //
      // Saleor's `transactionProcess` mutation is public: it has no permission
      // requirement and no checkout-ownership check (confirmed in Saleor core,
      // transaction_process.py), so anyone can call it and it hands this webhook
      // the caller's own `data`. The previous version parsed `data.event.type`
      // and echoed it straight back as the transaction result, so a request like
      //   transactionProcess(id, data: { event: { type: "CHARGE_SUCCESS" } })
      // made us tell Saleor the order was paid — for the full amount, with no
      // money moved. That is a free-order hole.
      //
      // Paysera's genuine outcome never arrives through this webhook. Payment is
      // confirmed only by the signed `/api/paysera/callback`, which verifies the
      // `ss1` signature before reporting CHARGE_SUCCESS/FAILURE. The storefront
      // only ever drives `transactionProcess` for the Adyen/Stripe drop-ins,
      // never for Paysera. So this handler must stay non-terminal: it always
      // answers "still in progress" and leaves the signed callback to resolve
      // the charge. A *_REQUEST result cannot complete a checkout on its own
      // (it moves the pending amount, not the charged amount).
      const urlGenerator = new AppUrlGenerator(ctx.authData);

      const response: ResponseType = {
        pspReference: uuidv7(),
        result:
          actionType === TransactionFlowStrategyEnum.Charge
            ? "CHARGE_REQUEST"
            : "AUTHORIZATION_REQUEST",
        message: "Mokėjimas apdorojamas Paysera sistemoje",
        amount,
        actions: [],
        externalUrl: urlGenerator.getTransactionDetailsUrl(payload.transaction.id),
      };

      logger.info(
        "Paysera process-session: returning in-progress; the signed callback resolves the charge",
        { transactionId: payload.transaction.id },
      );

      return res.status(200).json(response);
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
