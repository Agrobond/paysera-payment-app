import { v7 as uuidv7 } from "uuid";
import { buildPaymentUrl } from "./paysera-request-builder";
import { verifyAndDecodeCallback, type PayseraRawCallback } from "./paysera-callback-handler";
import { PayseraConfigError } from "./paysera-errors";
import {
  PayseraStatus,
  type PayseraCallbackData,
  type PayseraCallbackUrls,
  type PayseraConfig,
  type PayseraPaymentRequest,
  type PayseraRequestParams,
} from "./paysera-types";

const PAYSERA_API_VERSION = "1.6";

export interface CreatePaymentOptions {
  transactionId: string;
  amount: number; // in the base currency unit (e.g., EUR)
  currency: string;
  urls: PayseraCallbackUrls;
  customerEmail?: string;
  customerFirstName?: string;
  customerLastName?: string;
  paymentDescription?: string;
  language?: string;
}

export class PayseraClient {
  private config: PayseraConfig;

  constructor(config: PayseraConfig) {
    if (!config.projectId || !config.password) {
      throw new PayseraConfigError("Project ID and password are required");
    }
    this.config = config;
  }

  /**
   * Converts amount from base currency unit to cents
   * For example: 10.50 EUR -> 1050 cents
   */
  private toMinorUnits(amount: number): number {
    return Math.round(amount * 100);
  }

  /**
   * Generates a unique order ID for Paysera
   * Uses the transaction ID as prefix for traceability
   */
  private generateOrderId(transactionId: string): string {
    // Paysera orderid has a max length of 40 characters
    // Use a shorter format: first 8 chars of transaction ID + UUID suffix
    const shortTxId = transactionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
    const shortUuid = uuidv7().replace(/-/g, "").slice(0, 24);
    return `${shortTxId}${shortUuid}`.slice(0, 40);
  }

  /**
   * Creates a payment request and returns the redirect URL
   */
  createPaymentRequest(options: CreatePaymentOptions): PayseraPaymentRequest {
    const orderId = this.generateOrderId(options.transactionId);

    const params: PayseraRequestParams = {
      projectid: this.config.projectId,
      orderid: orderId,
      accepturl: options.urls.acceptUrl,
      cancelurl: options.urls.cancelUrl,
      callbackurl: options.urls.callbackUrl,
      version: PAYSERA_API_VERSION,
      amount: this.toMinorUnits(options.amount),
      currency: options.currency,
      test: this.config.testMode ? 1 : 0,
    };

    // Add optional customer information
    if (options.customerEmail) {
      params.p_email = options.customerEmail;
    }
    if (options.customerFirstName) {
      params.p_firstname = options.customerFirstName;
    }
    if (options.customerLastName) {
      params.p_lastname = options.customerLastName;
    }
    if (options.paymentDescription) {
      params.paytext = options.paymentDescription;
    }
    if (options.language) {
      params.lang = options.language;
    }

    const redirectUrl = buildPaymentUrl(params, this.config.password);

    return {
      redirectUrl,
      orderId,
    };
  }

  /**
   * Processes and verifies a callback from Paysera
   */
  processCallback(rawCallback: PayseraRawCallback): PayseraCallbackData {
    return verifyAndDecodeCallback(rawCallback, this.config.password);
  }

  /**
   * Checks if a callback indicates successful payment
   */
  isPaymentSuccessful(callbackData: PayseraCallbackData): boolean {
    return callbackData.status === PayseraStatus.SUCCESS;
  }

  /**
   * Checks if a callback indicates the payment is still pending
   */
  isPaymentPending(callbackData: PayseraCallbackData): boolean {
    return (
      callbackData.status === PayseraStatus.PENDING ||
      callbackData.status === PayseraStatus.ACCEPTED_NOT_EXECUTED
    );
  }
}
