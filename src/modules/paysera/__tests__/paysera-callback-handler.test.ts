import { describe, it, expect } from "vitest";
import {
  verifySignature,
  decodeCallbackData,
  parseCallbackData,
  verifyAndDecodeCallback,
} from "../paysera-callback-handler";
import { toUrlSafeBase64, generateSignature } from "../paysera-request-builder";
import { PayseraSignatureError, PayseraCallbackDataError } from "../paysera-errors";

describe("paysera-callback-handler", () => {
  const password = "test_password";

  // Helper to create valid encoded callback data
  function createEncodedCallbackData(data: Record<string, string>): { data: string; ss1: string } {
    const queryString = Object.entries(data)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    const encodedData = toUrlSafeBase64(queryString);
    const signature = generateSignature(encodedData, password);
    return { data: encodedData, ss1: signature };
  }

  describe("verifySignature", () => {
    it("should return true for valid signature", () => {
      const data = toUrlSafeBase64("test=value");
      const validSignature = generateSignature(data, password);

      const result = verifySignature(data, validSignature, password);

      expect(result).toBe(true);
    });

    it("should return false for invalid signature", () => {
      const data = toUrlSafeBase64("test=value");
      const invalidSignature = "invalid_signature_12345678901234";

      const result = verifySignature(data, invalidSignature, password);

      expect(result).toBe(false);
    });

    it("should be case insensitive for signature comparison", () => {
      const data = toUrlSafeBase64("test=value");
      const validSignature = generateSignature(data, password);

      const result = verifySignature(data, validSignature.toUpperCase(), password);

      expect(result).toBe(true);
    });

    it("should return false for wrong password", () => {
      const data = toUrlSafeBase64("test=value");
      const signatureWithRightPassword = generateSignature(data, password);

      const result = verifySignature(data, signatureWithRightPassword, "wrong_password");

      expect(result).toBe(false);
    });
  });

  describe("decodeCallbackData", () => {
    it("should decode URL-safe base64 and parse query string", () => {
      const originalData = "projectid=123&orderid=order1&amount=100";
      const encodedData = toUrlSafeBase64(originalData);

      const result = decodeCallbackData(encodedData);

      expect(result).toEqual({
        projectid: "123",
        orderid: "order1",
        amount: "100",
      });
    });

    it("should handle URL encoded values", () => {
      const originalData = "projectid=123&paytext=Payment%20for%20order";
      const encodedData = toUrlSafeBase64(originalData);

      const result = decodeCallbackData(encodedData);

      expect(result.paytext).toBe("Payment for order");
    });

    it("should handle empty values", () => {
      const originalData = "projectid=123&empty=";
      const encodedData = toUrlSafeBase64(originalData);

      const result = decodeCallbackData(encodedData);

      expect(result.empty).toBe("");
    });
  });

  describe("parseCallbackData", () => {
    it("should parse valid callback data", () => {
      const rawData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: "1000",
        currency: "EUR",
        status: "1",
        requestid: "req123",
      };

      const result = parseCallbackData(rawData);

      expect(result).toEqual({
        projectid: "12345",
        orderid: "ORDER-001",
        amount: 1000,
        currency: "EUR",
        status: 1,
        requestid: "req123",
        paytext: undefined,
        name: undefined,
        surename: undefined,
        payment: undefined,
        country: undefined,
        test: undefined,
      });
    });

    it("should parse optional fields", () => {
      const rawData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: "1000",
        currency: "EUR",
        status: "1",
        requestid: "req123",
        paytext: "Payment description",
        name: "John",
        surename: "Doe",
        payment: "bank",
        country: "LT",
        test: "1",
      };

      const result = parseCallbackData(rawData);

      expect(result.paytext).toBe("Payment description");
      expect(result.name).toBe("John");
      expect(result.surename).toBe("Doe");
      expect(result.payment).toBe("bank");
      expect(result.country).toBe("LT");
      expect(result.test).toBe(1);
    });

    it("should throw error for missing required field", () => {
      const rawData = {
        projectid: "12345",
        // missing orderid
        amount: "1000",
        currency: "EUR",
        status: "1",
        requestid: "req123",
      };

      expect(() => parseCallbackData(rawData)).toThrow(PayseraCallbackDataError);
      expect(() => parseCallbackData(rawData)).toThrow("Missing required field: orderid");
    });

    it("should throw error for invalid amount", () => {
      const rawData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: "invalid",
        currency: "EUR",
        status: "1",
        requestid: "req123",
      };

      expect(() => parseCallbackData(rawData)).toThrow(PayseraCallbackDataError);
      expect(() => parseCallbackData(rawData)).toThrow("Invalid amount value");
    });

    it("should throw error for invalid status", () => {
      const rawData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: "1000",
        currency: "EUR",
        status: "invalid",
        requestid: "req123",
      };

      expect(() => parseCallbackData(rawData)).toThrow(PayseraCallbackDataError);
      expect(() => parseCallbackData(rawData)).toThrow("Invalid status value");
    });

    it("should parse test=0 correctly", () => {
      const rawData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: "1000",
        currency: "EUR",
        status: "1",
        requestid: "req123",
        test: "0",
      };

      const result = parseCallbackData(rawData);

      expect(result.test).toBe(0);
    });
  });

  describe("verifyAndDecodeCallback", () => {
    it("should verify and decode valid callback", () => {
      const callbackData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: "1000",
        currency: "EUR",
        status: "1",
        requestid: "req123",
      };

      const { data, ss1 } = createEncodedCallbackData(callbackData);

      const result = verifyAndDecodeCallback({ data, ss1 }, password);

      expect(result.projectid).toBe("12345");
      expect(result.orderid).toBe("ORDER-001");
      expect(result.amount).toBe(1000);
      expect(result.status).toBe(1);
    });

    it("should throw PayseraSignatureError for invalid signature", () => {
      const callbackData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: "1000",
        currency: "EUR",
        status: "1",
        requestid: "req123",
      };

      const { data } = createEncodedCallbackData(callbackData);

      expect(() =>
        verifyAndDecodeCallback({ data, ss1: "invalid_signature_1234567890123456" }, password)
      ).toThrow(PayseraSignatureError);
    });

    it("should throw PayseraCallbackDataError for missing data", () => {
      expect(() => verifyAndDecodeCallback({ data: "", ss1: "signature" }, password)).toThrow(
        PayseraCallbackDataError
      );
    });

    it("should throw PayseraCallbackDataError for missing signature", () => {
      expect(() => verifyAndDecodeCallback({ data: "data", ss1: "" }, password)).toThrow(
        PayseraCallbackDataError
      );
    });

    it("should use correct password for verification", () => {
      const callbackData = {
        projectid: "12345",
        orderid: "ORDER-001",
        amount: "1000",
        currency: "EUR",
        status: "1",
        requestid: "req123",
      };

      const { data, ss1 } = createEncodedCallbackData(callbackData);

      // Should fail with wrong password
      expect(() => verifyAndDecodeCallback({ data, ss1 }, "wrong_password")).toThrow(
        PayseraSignatureError
      );

      // Should succeed with correct password
      expect(() => verifyAndDecodeCallback({ data, ss1 }, password)).not.toThrow();
    });
  });
});
