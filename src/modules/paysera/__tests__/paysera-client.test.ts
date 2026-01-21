import { describe, it, expect } from "vitest";
import { PayseraClient } from "../paysera-client";
import { PayseraConfigError } from "../paysera-errors";
import { PayseraStatus, type PayseraCallbackData } from "../paysera-types";
import { toUrlSafeBase64, generateSignature } from "../paysera-request-builder";

describe("PayseraClient", () => {
  const validConfig = {
    projectId: "12345",
    password: "secret_password",
    testMode: true,
  };

  describe("constructor", () => {
    it("should create client with valid config", () => {
      const client = new PayseraClient(validConfig);
      expect(client).toBeInstanceOf(PayseraClient);
    });

    it("should throw PayseraConfigError for missing projectId", () => {
      expect(
        () =>
          new PayseraClient({
            projectId: "",
            password: "secret",
            testMode: true,
          })
      ).toThrow(PayseraConfigError);
    });

    it("should throw PayseraConfigError for missing password", () => {
      expect(
        () =>
          new PayseraClient({
            projectId: "12345",
            password: "",
            testMode: true,
          })
      ).toThrow(PayseraConfigError);
    });
  });

  describe("createPaymentRequest", () => {
    it("should create payment request with required fields", () => {
      const client = new PayseraClient(validConfig);

      const result = client.createPaymentRequest({
        transactionId: "TX-001",
        amount: 10.5,
        currency: "EUR",
        urls: {
          acceptUrl: "https://example.com/accept",
          cancelUrl: "https://example.com/cancel",
          callbackUrl: "https://example.com/callback",
        },
      });

      expect(result).toHaveProperty("redirectUrl");
      expect(result).toHaveProperty("orderId");
      expect(result.redirectUrl).toContain("https://www.paysera.com/pay/");
    });

    it("should convert amount to cents", () => {
      const client = new PayseraClient(validConfig);

      const result = client.createPaymentRequest({
        transactionId: "TX-001",
        amount: 10.5, // 10.50 EUR
        currency: "EUR",
        urls: {
          acceptUrl: "https://example.com/accept",
          cancelUrl: "https://example.com/cancel",
          callbackUrl: "https://example.com/callback",
        },
      });

      // The URL data param should decode to contain amount=1050 (in cents)
      const url = new URL(result.redirectUrl);
      const data = url.searchParams.get("data");
      expect(data).toBeTruthy();
      // Decode the URL-safe base64 data
      const decoded = Buffer.from(
        data!.replace(/_/g, "/").replace(/-/g, "+"),
        "base64"
      ).toString("utf-8");
      expect(decoded).toContain("amount=1050");
    });

    it("should include test=1 in test mode", () => {
      const client = new PayseraClient({ ...validConfig, testMode: true });

      const result = client.createPaymentRequest({
        transactionId: "TX-001",
        amount: 10,
        currency: "EUR",
        urls: {
          acceptUrl: "https://example.com/accept",
          cancelUrl: "https://example.com/cancel",
          callbackUrl: "https://example.com/callback",
        },
      });

      // The URL data param should decode to contain test=1
      const url = new URL(result.redirectUrl);
      const data = url.searchParams.get("data");
      expect(data).toBeTruthy();
      const decoded = Buffer.from(
        data!.replace(/_/g, "/").replace(/-/g, "+"),
        "base64"
      ).toString("utf-8");
      expect(decoded).toContain("test=1");
    });

    it("should include test=0 in production mode", () => {
      const client = new PayseraClient({ ...validConfig, testMode: false });

      const result = client.createPaymentRequest({
        transactionId: "TX-001",
        amount: 10,
        currency: "EUR",
        urls: {
          acceptUrl: "https://example.com/accept",
          cancelUrl: "https://example.com/cancel",
          callbackUrl: "https://example.com/callback",
        },
      });

      expect(result.redirectUrl).toBeTruthy();
    });

    it("should generate unique order IDs", () => {
      const client = new PayseraClient(validConfig);

      const result1 = client.createPaymentRequest({
        transactionId: "TX-001",
        amount: 10,
        currency: "EUR",
        urls: {
          acceptUrl: "https://example.com/accept",
          cancelUrl: "https://example.com/cancel",
          callbackUrl: "https://example.com/callback",
        },
      });

      const result2 = client.createPaymentRequest({
        transactionId: "TX-001",
        amount: 10,
        currency: "EUR",
        urls: {
          acceptUrl: "https://example.com/accept",
          cancelUrl: "https://example.com/cancel",
          callbackUrl: "https://example.com/callback",
        },
      });

      expect(result1.orderId).not.toBe(result2.orderId);
    });

    it("should include optional customer information", () => {
      const client = new PayseraClient(validConfig);

      const result = client.createPaymentRequest({
        transactionId: "TX-001",
        amount: 10,
        currency: "EUR",
        urls: {
          acceptUrl: "https://example.com/accept",
          cancelUrl: "https://example.com/cancel",
          callbackUrl: "https://example.com/callback",
        },
        customerEmail: "test@example.com",
        customerFirstName: "John",
        customerLastName: "Doe",
        paymentDescription: "Test payment",
        language: "en",
      });

      expect(result.redirectUrl).toBeTruthy();
    });

    it("should limit order ID to 40 characters", () => {
      const client = new PayseraClient(validConfig);

      const result = client.createPaymentRequest({
        transactionId: "very-long-transaction-id-that-exceeds-normal-length",
        amount: 10,
        currency: "EUR",
        urls: {
          acceptUrl: "https://example.com/accept",
          cancelUrl: "https://example.com/cancel",
          callbackUrl: "https://example.com/callback",
        },
      });

      expect(result.orderId.length).toBeLessThanOrEqual(40);
    });
  });

  describe("processCallback", () => {
    it("should verify and decode valid callback", () => {
      const client = new PayseraClient(validConfig);

      // Create valid callback data
      const callbackParams = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: "1000",
        currency: "EUR",
        status: "1",
        requestid: "req123",
      };

      const queryString = Object.entries(callbackParams)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
      const data = toUrlSafeBase64(queryString);
      const ss1 = generateSignature(data, validConfig.password);

      const result = client.processCallback({ data, ss1 });

      expect(result.projectid).toBe("12345");
      expect(result.orderid).toBe("ORDER-001");
      expect(result.amount).toBe(1000);
      expect(result.status).toBe(1);
    });
  });

  describe("isPaymentSuccessful", () => {
    it("should return true for status 1", () => {
      const client = new PayseraClient(validConfig);

      const callbackData: PayseraCallbackData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: 1000,
        currency: "EUR",
        status: PayseraStatus.SUCCESS,
        requestid: "req123",
      };

      expect(client.isPaymentSuccessful(callbackData)).toBe(true);
    });

    it("should return false for status 0", () => {
      const client = new PayseraClient(validConfig);

      const callbackData: PayseraCallbackData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: 1000,
        currency: "EUR",
        status: PayseraStatus.PENDING,
        requestid: "req123",
      };

      expect(client.isPaymentSuccessful(callbackData)).toBe(false);
    });

    it("should return false for other statuses", () => {
      const client = new PayseraClient(validConfig);

      const callbackData: PayseraCallbackData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: 1000,
        currency: "EUR",
        status: PayseraStatus.ACCEPTED_NOT_EXECUTED,
        requestid: "req123",
      };

      expect(client.isPaymentSuccessful(callbackData)).toBe(false);
    });
  });

  describe("isPaymentPending", () => {
    it("should return true for status 0 (PENDING)", () => {
      const client = new PayseraClient(validConfig);

      const callbackData: PayseraCallbackData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: 1000,
        currency: "EUR",
        status: PayseraStatus.PENDING,
        requestid: "req123",
      };

      expect(client.isPaymentPending(callbackData)).toBe(true);
    });

    it("should return true for status 2 (ACCEPTED_NOT_EXECUTED)", () => {
      const client = new PayseraClient(validConfig);

      const callbackData: PayseraCallbackData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: 1000,
        currency: "EUR",
        status: PayseraStatus.ACCEPTED_NOT_EXECUTED,
        requestid: "req123",
      };

      expect(client.isPaymentPending(callbackData)).toBe(true);
    });

    it("should return false for status 1 (SUCCESS)", () => {
      const client = new PayseraClient(validConfig);

      const callbackData: PayseraCallbackData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: 1000,
        currency: "EUR",
        status: PayseraStatus.SUCCESS,
        requestid: "req123",
      };

      expect(client.isPaymentPending(callbackData)).toBe(false);
    });
  });
});
