/**
 * Paysera configuration stored in Saleor app privateMetadata
 */
export interface PayseraConfig {
  projectId: string;
  password: string;
  testMode: boolean;
}

/**
 * Parameters for building a Paysera payment request
 * @see https://developers.paysera.com/en/checkout/integrations/integration-specification
 */
export interface PayseraRequestParams {
  projectid: string;
  orderid: string;
  accepturl: string;
  cancelurl: string;
  callbackurl: string;
  version: string;
  amount: number; // in cents
  currency: string;
  test: 0 | 1;
  // Optional customer information
  p_firstname?: string;
  p_lastname?: string;
  p_email?: string;
  p_street?: string;
  p_city?: string;
  p_zip?: string;
  p_countrycode?: string;
  // Optional payment settings
  lang?: string;
  payment?: string; // payment method
  paytext?: string; // payment description
}

/**
 * Decoded callback data from Paysera
 */
export interface PayseraCallbackData {
  projectid: string;
  orderid: string;
  amount: number; // in cents
  currency: string;
  status: number; // 0 = pending, 1 = success, 2 = accepted but not yet executed, 3 = additional info required
  requestid: string;
  paytext?: string;
  name?: string;
  surename?: string; // Note: Paysera uses "surename" not "surname"
  payment?: string;
  country?: string;
  test?: 0 | 1;
}

/**
 * URLs required for Paysera payment flow
 */
export interface PayseraCallbackUrls {
  acceptUrl: string;
  cancelUrl: string;
  callbackUrl: string;
}

/**
 * Result of creating a payment request
 */
export interface PayseraPaymentRequest {
  redirectUrl: string;
  orderId: string;
}

/**
 * Paysera payment status codes
 */
export const PayseraStatus = {
  PENDING: 0,
  SUCCESS: 1,
  ACCEPTED_NOT_EXECUTED: 2,
  ADDITIONAL_INFO_REQUIRED: 3,
} as const;

export type PayseraStatusType = (typeof PayseraStatus)[keyof typeof PayseraStatus];
