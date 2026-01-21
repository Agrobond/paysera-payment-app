import { fromUrlSafeBase64, generateSignature } from "./paysera-request-builder";
import { PayseraCallbackDataError, PayseraSignatureError } from "./paysera-errors";
import type { PayseraCallbackData } from "./paysera-types";

/**
 * Raw callback parameters received from Paysera
 */
export interface PayseraRawCallback {
  data: string;
  ss1: string; // MD5 signature
  ss2?: string; // RSA signature (optional)
}

/**
 * Parses URL-encoded query string into key-value pairs
 */
function parseQueryString(queryString: string): Record<string, string> {
  const params: Record<string, string> = {};

  queryString.split("&").forEach((pair) => {
    const [key, value] = pair.split("=");
    if (key) {
      params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : "";
    }
  });

  return params;
}

/**
 * Verifies the callback signature (ss1) using MD5
 */
export function verifySignature(data: string, ss1: string, password: string): boolean {
  const expectedSignature = generateSignature(data, password);
  return expectedSignature.toLowerCase() === ss1.toLowerCase();
}

/**
 * Decodes and parses the callback data
 */
export function decodeCallbackData(data: string): Record<string, string> {
  const decoded = fromUrlSafeBase64(data);
  return parseQueryString(decoded);
}

/**
 * Validates and extracts required callback fields
 */
export function parseCallbackData(rawData: Record<string, string>): PayseraCallbackData {
  const required = ["projectid", "orderid", "amount", "currency", "status", "requestid"];

  for (const field of required) {
    if (!(field in rawData)) {
      throw new PayseraCallbackDataError(`Missing required field: ${field}`);
    }
  }

  const amount = parseInt(rawData.amount, 10);
  if (isNaN(amount)) {
    throw new PayseraCallbackDataError("Invalid amount value");
  }

  const status = parseInt(rawData.status, 10);
  if (isNaN(status)) {
    throw new PayseraCallbackDataError("Invalid status value");
  }

  return {
    projectid: rawData.projectid,
    orderid: rawData.orderid,
    amount,
    currency: rawData.currency,
    status,
    requestid: rawData.requestid,
    paytext: rawData.paytext,
    name: rawData.name,
    surename: rawData.surename,
    payment: rawData.payment,
    country: rawData.country,
    test: rawData.test === "1" ? 1 : rawData.test === "0" ? 0 : undefined,
  };
}

/**
 * Verifies and decodes a Paysera callback
 * @throws PayseraSignatureError if signature verification fails
 * @throws PayseraCallbackDataError if callback data is invalid
 */
export function verifyAndDecodeCallback(
  rawCallback: PayseraRawCallback,
  password: string
): PayseraCallbackData {
  const { data, ss1 } = rawCallback;

  if (!data || !ss1) {
    throw new PayseraCallbackDataError("Missing data or signature in callback");
  }

  if (!verifySignature(data, ss1, password)) {
    throw new PayseraSignatureError();
  }

  const decodedData = decodeCallbackData(data);
  return parseCallbackData(decodedData);
}
