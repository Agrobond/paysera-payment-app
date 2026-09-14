import type { NextApiRequest, NextApiResponse } from "next";
import { saleorApp } from "@/saleor-app";
import { createClient } from "@/lib/create-graphql-client";
import { createLogger } from "@/lib/logger/create-logger";
import {
  TransactionEventReportDocument,
  TransactionDetailsViaIdDocument,
  TransactionActionEnum,
  TransactionEventTypeEnum,
} from "@/generated/graphql";
import {
  getPayseraConfigFromMetadata,
  PayseraClient,
  PayseraSignatureError,
  PayseraCallbackDataError,
  PayseraStatus,
} from "@/modules/paysera";
import { FetchAppDetailsDocument } from "@/generated/graphql";

const logger = createLogger("paysera-callback");

type CallbackAction = "accept" | "cancel" | "callback";

function getStorefrontBase(): string {
  return (process.env.STOREFRONT_URL || "").replace(/\/$/, "");
}

async function handleAcceptRedirect(
  req: NextApiRequest,
  res: NextApiResponse,
  transactionId: string
) {
  const { checkoutId, locale } = req.query;
  const checkoutIdStr = Array.isArray(checkoutId) ? checkoutId[0] : checkoutId;
  const localeStr = (Array.isArray(locale) ? locale[0] : locale) || "lt";
  const storefrontBase = getStorefrontBase();

  logger.info("Payment accepted, redirecting customer to storefront", {
    transactionId,
    checkoutId: checkoutIdStr,
    locale: localeStr,
  });

  // Redirect back to the storefront checkout page with a `paymentReturn=paysera`
  // marker. The storefront detects this param and calls checkoutComplete using
  // the user's own auth context (which resolves email for logged-in users).
  //
  // The marker names the gateway rather than being a bare `1`, because the
  // storefront used to pair it with a sessionStorage flag to tell gateways
  // apart. sessionStorage is per-tab, and mobile banking apps routinely return
  // the customer in a fresh tab or webview -- the flag was missing, the
  // completion silently skipped, and the order was never created.
  if (checkoutIdStr) {
    const decodedCheckoutId = decodeURIComponent(checkoutIdStr);
    return res.redirect(
      302,
      `${storefrontBase}/${localeStr}/checkout?checkout=${encodeURIComponent(decodedCheckoutId)}&paymentReturn=paysera`
    );
  }

  return res.redirect(302, storefrontBase || "/");
}

async function handleCancelRedirect(
  req: NextApiRequest,
  res: NextApiResponse,
  transactionId: string
) {
  const { checkoutId, locale } = req.query;
  const checkoutIdStr = Array.isArray(checkoutId) ? checkoutId[0] : checkoutId;
  const localeStr = (Array.isArray(locale) ? locale[0] : locale) || "lt";
  const storefrontBase = getStorefrontBase();

  logger.info("Payment cancelled, redirecting customer", { transactionId, checkoutId: checkoutIdStr });

  if (checkoutIdStr) {
    const decodedCheckoutId = decodeURIComponent(checkoutIdStr);
    return res.redirect(302, `${storefrontBase}/${localeStr}/checkout?checkout=${encodeURIComponent(decodedCheckoutId)}`);
  }

  return res.redirect(302, storefrontBase || "/");
}

async function handleServerCallback(
  req: NextApiRequest,
  res: NextApiResponse,
  transactionId: string,
  saleorApiUrl: string
) {
  logger.info("Processing Paysera server callback", { transactionId, saleorApiUrl });

  // Get auth data from APL
  const authData = await saleorApp.apl.get(saleorApiUrl);

  if (!authData) {
    logger.error("No auth data found for Saleor API URL", { saleorApiUrl });
    return res.status(400).send("Invalid Saleor API URL");
  }

  // Create GraphQL client
  const client = createClient(saleorApiUrl, async () =>
    Promise.resolve({ token: authData.token })
  );

  // Fetch app details to get Paysera config
  const appResult = await client.query(FetchAppDetailsDocument, {});

  if (appResult.error || !appResult.data?.app) {
    logger.error("Failed to fetch app details", { error: appResult.error });
    return res.status(500).send("Failed to fetch app configuration");
  }

  // Get Paysera config
  let payseraConfig;
  try {
    payseraConfig = getPayseraConfigFromMetadata(appResult.data.app.privateMetadata);
  } catch (error) {
    logger.error("Failed to load Paysera configuration", { error });
    return res.status(500).send("Paysera not configured");
  }

  // Create Paysera client and process callback
  const payseraClient = new PayseraClient(payseraConfig);

  // Extract Paysera callback data from request
  const { data, ss1 } = req.query as { data?: string; ss1?: string };

  if (!data || !ss1) {
    logger.error("Missing data or ss1 in callback", { query: req.query });
    return res.status(400).send("Missing callback data");
  }

  let callbackData;
  try {
    callbackData = payseraClient.processCallback({
      data: Array.isArray(data) ? data[0] : data,
      ss1: Array.isArray(ss1) ? ss1[0] : ss1,
    });
  } catch (error) {
    if (error instanceof PayseraSignatureError) {
      logger.error("Invalid Paysera callback signature", { error });
      return res.status(400).send("Invalid signature");
    }
    if (error instanceof PayseraCallbackDataError) {
      logger.error("Invalid Paysera callback data", { error });
      return res.status(400).send("Invalid callback data");
    }
    throw error;
  }

  logger.info("Paysera callback data decoded", {
    orderId: callbackData.orderid,
    status: callbackData.status,
    amount: callbackData.amount,
    currency: callbackData.currency,
    test: callbackData.test,
  });

  // Determine event type based on payment status
  let eventType: TransactionEventTypeEnum;
  let message: string;

  if (payseraClient.isPaymentSuccessful(callbackData)) {
    eventType = TransactionEventTypeEnum.ChargeSuccess;
    message = "Mokėjimas sėkmingai atliktas";
  } else if (callbackData.status === PayseraStatus.PENDING) {
    eventType = TransactionEventTypeEnum.ChargeRequest;
    message = "Mokėjimas laukia patvirtinimo";
  } else if (callbackData.status === PayseraStatus.ACCEPTED_NOT_EXECUTED) {
    eventType = TransactionEventTypeEnum.ChargeRequest;
    message = "Mokėjimas priimtas, laukiama įvykdymo";
  } else if (callbackData.status === PayseraStatus.ADDITIONAL_INFO_REQUIRED) {
    // Paysera follows a successful payment with a second callback carrying
    // supplementary payer details, 15-90s later. It is purely informational.
    // Without this branch it fell through to the failure case below and stamped
    // already-paid transactions as failed -- including orders 12224 and 12225.
    eventType = TransactionEventTypeEnum.Info;
    message = "Paysera pateikė papildomą mokėjimo informaciją";
  } else {
    eventType = TransactionEventTypeEnum.ChargeFailure;
    message = "Mokėjimas nepavyko";
  }

  // Derived from the callback rather than random, so Paysera's own retries of a
  // notification dedupe through `alreadyProcessed` instead of stacking up as
  // fresh events. Distinct statuses still produce distinct events.
  const pspReference = `${callbackData.orderid}:${callbackData.status}`;
  const amount = callbackData.amount / 100; // Convert from cents

  // A late or out-of-order callback must never move a transaction backwards out
  // of a charged state -- the money has already arrived.
  if (eventType === TransactionEventTypeEnum.ChargeFailure) {
    const current = await client.query(TransactionDetailsViaIdDocument, { id: transactionId });
    const alreadyCharged = current.data?.transaction?.chargedAmount?.amount ?? 0;

    if (alreadyCharged > 0) {
      logger.warn("Ignoring failure callback for an already-charged transaction", {
        transactionId,
        alreadyCharged,
        status: callbackData.status,
      });
      return res.status(200).send("OK");
    }
  }

  const availableActions: TransactionActionEnum[] =
    eventType === TransactionEventTypeEnum.ChargeSuccess
      ? [TransactionActionEnum.Refund]
      : [];

  const reportResult = await client.mutation(TransactionEventReportDocument, {
    id: transactionId,
    amount,
    type: eventType,
    pspReference,
    message,
    availableActions,
  });

  if (reportResult.error) {
    logger.error("Failed to report transaction event to Saleor", {
      error: reportResult.error,
      transactionId,
    });
    return res.status(500).send("Failed to report event");
  }

  const reportErrors = reportResult.data?.transactionEventReport?.errors;
  if (reportErrors && reportErrors.length > 0) {
    logger.error("Transaction event report returned errors", {
      errors: reportErrors,
      transactionId,
    });
    // Still return OK to Paysera - we don't want them to retry
  }

  const alreadyProcessed = reportResult.data?.transactionEventReport?.alreadyProcessed;
  if (alreadyProcessed) {
    logger.info("Transaction event was already processed", { transactionId, pspReference });
  } else {
    logger.info("Transaction event reported successfully", {
      transactionId,
      pspReference,
      eventType,
    });
  }

  // Paysera expects "OK" response
  return res.status(200).send("OK");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { action, transactionId, saleorApiUrl } = req.query;

  const actionStr = Array.isArray(action) ? action[0] : action;
  const transactionIdStr = Array.isArray(transactionId) ? transactionId[0] : transactionId;
  const saleorApiUrlStr = Array.isArray(saleorApiUrl)
    ? decodeURIComponent(saleorApiUrl[0])
    : saleorApiUrl
      ? decodeURIComponent(saleorApiUrl)
      : undefined;

  logger.info("Paysera callback received", {
    action: actionStr,
    transactionId: transactionIdStr,
    saleorApiUrl: saleorApiUrlStr,
    method: req.method,
  });

  if (!transactionIdStr) {
    logger.error("Missing transactionId in callback");
    return res.status(400).send("Missing transactionId");
  }

  switch (actionStr as CallbackAction) {
    case "accept":
      return handleAcceptRedirect(req, res, transactionIdStr);

    case "cancel":
      return handleCancelRedirect(req, res, transactionIdStr);

    case "callback":
      if (!saleorApiUrlStr) {
        logger.error("Missing saleorApiUrl in server callback");
        return res.status(400).send("Missing saleorApiUrl");
      }
      return handleServerCallback(req, res, transactionIdStr, saleorApiUrlStr);

    default:
      logger.error("Unknown callback action", { action: actionStr });
      return res.status(400).send("Unknown action");
  }
}
