import { createHash } from "crypto";
import type { PayseraRequestParams } from "./paysera-types";

const PAYSERA_PAYMENT_URL = "https://www.paysera.com/pay/";

/**
 * Encodes a string to URL-safe Base64
 * Replaces: / -> _ and + -> -
 */
export function toUrlSafeBase64(str: string): string {
  return Buffer.from(str, "utf-8").toString("base64").replace(/\//g, "_").replace(/\+/g, "-");
}

/**
 * Decodes URL-safe Base64 back to original string
 */
export function fromUrlSafeBase64(str: string): string {
  const standardBase64 = str.replace(/_/g, "/").replace(/-/g, "+");
  return Buffer.from(standardBase64, "base64").toString("utf-8");
}

/**
 * Generates MD5 signature for Paysera request/callback verification
 */
export function generateSignature(data: string, password: string): string {
  return createHash("md5")
    .update(data + password)
    .digest("hex");
}

/**
 * Encodes request parameters to URL query string format
 */
export function encodeParams(params: PayseraRequestParams): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

  return entries.join("&");
}

/**
 * Builds the encoded data and signature for a Paysera payment request
 */
export function buildRequest(
  params: PayseraRequestParams,
  password: string
): { data: string; sign: string } {
  const encodedParams = encodeParams(params);
  const data = toUrlSafeBase64(encodedParams);
  const sign = generateSignature(data, password);

  return { data, sign };
}

/**
 * Generates the full Paysera payment URL
 */
export function getPaymentUrl(data: string, sign: string): string {
  return `${PAYSERA_PAYMENT_URL}?data=${data}&sign=${sign}`;
}

/**
 * Builds complete payment request and returns the redirect URL
 */
export function buildPaymentUrl(params: PayseraRequestParams, password: string): string {
  const { data, sign } = buildRequest(params, password);
  return getPaymentUrl(data, sign);
}
