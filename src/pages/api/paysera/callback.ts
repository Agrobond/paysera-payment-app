import type { NextApiRequest, NextApiResponse } from "next";
import { saleorApp } from "@/saleor-app";
import { createClient } from "@/lib/create-graphql-client";
import { createLogger } from "@/lib/logger/create-logger";
import {
  TransactionEventReportDocument,
  TransactionActionEnum,
  TransactionEventTypeEnum,
} from "@/generated/graphql";
import { v7 as uuidv7 } from "uuid";
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

function getRedirectUrl(success: boolean): string {
  // Use STOREFRONT_URL env var if set, otherwise default to a relative path
  const storefrontUrl = process.env.STOREFRONT_URL || "";

  if (success) {
    return `${storefrontUrl}/checkout/success`;
  }
  return `${storefrontUrl}/checkout/cancel`;
}

async function handleAcceptRedirect(
  req: NextApiRequest,
  res: NextApiResponse,
  transactionId: string
) {
  logger.info("Payment accepted, redirecting customer", { transactionId });
  res.redirect(302, getRedirectUrl(true));
}

async function handleCancelRedirect(
  req: NextApiRequest,
  res: NextApiResponse,
  transactionId: string
) {
  logger.info("Payment cancelled, redirecting customer", { transactionId });
  res.redirect(302, getRedirectUrl(false));
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
    message = "Payment completed successfully";
  } else if (callbackData.status === PayseraStatus.PENDING) {
    eventType = TransactionEventTypeEnum.ChargeRequest;
    message = "Payment pending";
  } else if (callbackData.status === PayseraStatus.ACCEPTED_NOT_EXECUTED) {
    eventType = TransactionEventTypeEnum.ChargeRequest;
    message = "Payment accepted, waiting for execution";
  } else {
    eventType = TransactionEventTypeEnum.ChargeFailure;
    message = "Payment failed";
  }

  // Report event to Saleor
  const pspReference = uuidv7();
  const amount = callbackData.amount / 100; // Convert from cents

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
