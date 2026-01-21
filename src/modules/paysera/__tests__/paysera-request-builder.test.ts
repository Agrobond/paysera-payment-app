import { describe, it, expect } from "vitest";
import {
  toUrlSafeBase64,
  fromUrlSafeBase64,
  generateSignature,
  encodeParams,
  buildRequest,
  getPaymentUrl,
  buildPaymentUrl,
} from "../paysera-request-builder";
import type { PayseraRequestParams } from "../paysera-types";

describe("paysera-request-builder", () => {
  describe("toUrlSafeBase64", () => {
    it("should encode string to base64", () => {
      const result = toUrlSafeBase64("hello");
      expect(result).toBe("aGVsbG8=");
    });

    it("should replace / with _ and + with -", () => {
      // A string that produces + and / in base64
      const input = "test>>>test???";
      const result = toUrlSafeBase64(input);

      expect(result).not.toContain("/");
      expect(result).not.toContain("+");
    });

    it("should handle empty string", () => {
      const result = toUrlSafeBase64("");
      expect(result).toBe("");
    });

    it("should handle special characters", () => {
      const result = toUrlSafeBase64("amount=100&currency=EUR");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });

  describe("fromUrlSafeBase64", () => {
    it("should decode URL-safe base64 back to original string", () => {
      const original = "hello world";
      const encoded = toUrlSafeBase64(original);
      const decoded = fromUrlSafeBase64(encoded);
      expect(decoded).toBe(original);
    });

    it("should correctly reverse URL-safe transformations", () => {
      const original = "test>>>test???";
      const encoded = toUrlSafeBase64(original);
      const decoded = fromUrlSafeBase64(encoded);
      expect(decoded).toBe(original);
    });

    it("should handle empty string", () => {
      const result = fromUrlSafeBase64("");
      expect(result).toBe("");
    });
  });

  describe("generateSignature", () => {
    it("should generate MD5 hash of data + password", () => {
      const data = "testdata";
      const password = "secret";
      const result = generateSignature(data, password);

      // MD5 hash should be 32 characters hex
      expect(result).toHaveLength(32);
      expect(result).toMatch(/^[a-f0-9]+$/);
    });

    it("should generate consistent signatures for same input", () => {
      const data = "somedata";
      const password = "password123";

      const result1 = generateSignature(data, password);
      const result2 = generateSignature(data, password);

      expect(result1).toBe(result2);
    });

    it("should generate different signatures for different inputs", () => {
      const password = "password";

      const result1 = generateSignature("data1", password);
      const result2 = generateSignature("data2", password);

      expect(result1).not.toBe(result2);
    });

    it("should generate different signatures for different passwords", () => {
      const data = "samedata";

      const result1 = generateSignature(data, "password1");
      const result2 = generateSignature(data, "password2");

      expect(result1).not.toBe(result2);
    });
  });

  describe("encodeParams", () => {
    it("should encode parameters as URL query string", () => {
      const params: PayseraRequestParams = {
        projectid: "12345",
        orderid: "ORDER-001",
        accepturl: "https://example.com/accept",
        cancelurl: "https://example.com/cancel",
        callbackurl: "https://example.com/callback",
        version: "1.6",
        amount: 1000,
        currency: "EUR",
        test: 1,
      };

      const result = encodeParams(params);

      expect(result).toContain("projectid=12345");
      expect(result).toContain("orderid=ORDER-001");
      expect(result).toContain("amount=1000");
      expect(result).toContain("currency=EUR");
      expect(result).toContain("test=1");
    });

    it("should URL encode special characters", () => {
      const params: PayseraRequestParams = {
        projectid: "123",
        orderid: "order&special=test",
        accepturl: "https://example.com/accept?param=value",
        cancelurl: "https://example.com/cancel",
        callbackurl: "https://example.com/callback",
        version: "1.6",
        amount: 100,
        currency: "EUR",
        test: 0,
      };

      const result = encodeParams(params);

      expect(result).toContain("orderid=order%26special%3Dtest");
    });

    it("should filter out undefined and null values", () => {
      const params: PayseraRequestParams = {
        projectid: "123",
        orderid: "order1",
        accepturl: "https://example.com/accept",
        cancelurl: "https://example.com/cancel",
        callbackurl: "https://example.com/callback",
        version: "1.6",
        amount: 100,
        currency: "EUR",
        test: 1,
        p_email: undefined,
        p_firstname: undefined,
      };

      const result = encodeParams(params);

      expect(result).not.toContain("p_email");
      expect(result).not.toContain("p_firstname");
    });

    it("should filter out empty string values", () => {
      const params: PayseraRequestParams = {
        projectid: "123",
        orderid: "order1",
        accepturl: "https://example.com/accept",
        cancelurl: "https://example.com/cancel",
        callbackurl: "https://example.com/callback",
        version: "1.6",
        amount: 100,
        currency: "EUR",
        test: 1,
        p_email: "",
      };

      const result = encodeParams(params);

      expect(result).not.toContain("p_email=");
    });
  });

  describe("buildRequest", () => {
    it("should return data and sign", () => {
      const params: PayseraRequestParams = {
        projectid: "12345",
        orderid: "ORDER-001",
        accepturl: "https://example.com/accept",
        cancelurl: "https://example.com/cancel",
        callbackurl: "https://example.com/callback",
        version: "1.6",
        amount: 1000,
        currency: "EUR",
        test: 1,
      };

      const result = buildRequest(params, "secret_password");

      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("sign");
      expect(typeof result.data).toBe("string");
      expect(typeof result.sign).toBe("string");
      expect(result.sign).toHaveLength(32); // MD5 hash length
    });

    it("should encode data as URL-safe base64", () => {
      const params: PayseraRequestParams = {
        projectid: "123",
        orderid: "order1",
        accepturl: "https://example.com/accept",
        cancelurl: "https://example.com/cancel",
        callbackurl: "https://example.com/callback",
        version: "1.6",
        amount: 100,
        currency: "EUR",
        test: 0,
      };

      const result = buildRequest(params, "password");

      // URL-safe base64 should not contain / or +
      expect(result.data).not.toContain("/");
      expect(result.data).not.toContain("+");
    });

    it("should generate consistent results for same input", () => {
      const params: PayseraRequestParams = {
        projectid: "123",
        orderid: "order1",
        accepturl: "https://example.com/accept",
        cancelurl: "https://example.com/cancel",
        callbackurl: "https://example.com/callback",
        version: "1.6",
        amount: 100,
        currency: "EUR",
        test: 1,
      };

      const result1 = buildRequest(params, "password");
      const result2 = buildRequest(params, "password");

      expect(result1.data).toBe(result2.data);
      expect(result1.sign).toBe(result2.sign);
    });
  });

  describe("getPaymentUrl", () => {
    it("should construct Paysera payment URL", () => {
      const data = "encoded_data";
      const sign = "signature123";

      const result = getPaymentUrl(data, sign);

      expect(result).toBe("https://www.paysera.com/pay/?data=encoded_data&sign=signature123");
    });
  });

  describe("buildPaymentUrl", () => {
    it("should build complete payment URL", () => {
      const params: PayseraRequestParams = {
        projectid: "12345",
        orderid: "ORDER-001",
        accepturl: "https://example.com/accept",
        cancelurl: "https://example.com/cancel",
        callbackurl: "https://example.com/callback",
        version: "1.6",
        amount: 1000,
        currency: "EUR",
        test: 1,
      };

      const result = buildPaymentUrl(params, "secret");

      expect(result).toContain("https://www.paysera.com/pay/");
      expect(result).toContain("data=");
      expect(result).toContain("sign=");
    });
  });
});
