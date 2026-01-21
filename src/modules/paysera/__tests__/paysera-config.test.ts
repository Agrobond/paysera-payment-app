import { describe, it, expect } from "vitest";
import {
  getPayseraConfigFromMetadata,
  serializePayseraConfig,
  getPayseraConfigKey,
  maskPassword,
  payseraConfigSchema,
} from "../paysera-config";
import { PayseraConfigError } from "../paysera-errors";

describe("paysera-config", () => {
  describe("payseraConfigSchema", () => {
    it("should validate valid config", () => {
      const config = {
        projectId: "12345",
        password: "secret",
        testMode: true,
      };

      const result = payseraConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(config);
      }
    });

    it("should require projectId", () => {
      const config = {
        password: "secret",
        testMode: true,
      };

      const result = payseraConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it("should require non-empty projectId", () => {
      const config = {
        projectId: "",
        password: "secret",
        testMode: true,
      };

      const result = payseraConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it("should require password", () => {
      const config = {
        projectId: "12345",
        testMode: true,
      };

      const result = payseraConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it("should require non-empty password", () => {
      const config = {
        projectId: "12345",
        password: "",
        testMode: true,
      };

      const result = payseraConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it("should default testMode to true", () => {
      const config = {
        projectId: "12345",
        password: "secret",
      };

      const result = payseraConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.testMode).toBe(true);
      }
    });

    it("should accept testMode false", () => {
      const config = {
        projectId: "12345",
        password: "secret",
        testMode: false,
      };

      const result = payseraConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.testMode).toBe(false);
      }
    });
  });

  describe("getPayseraConfigFromMetadata", () => {
    it("should extract config from valid metadata", () => {
      const config = {
        projectId: "12345",
        password: "secret",
        testMode: true,
      };

      const metadata = [{ key: "paysera_config", value: JSON.stringify(config) }];

      const result = getPayseraConfigFromMetadata(metadata);

      expect(result).toEqual(config);
    });

    it("should throw for null metadata", () => {
      expect(() => getPayseraConfigFromMetadata(null)).toThrow(PayseraConfigError);
      expect(() => getPayseraConfigFromMetadata(null)).toThrow("No private metadata found");
    });

    it("should throw for undefined metadata", () => {
      expect(() => getPayseraConfigFromMetadata(undefined)).toThrow(PayseraConfigError);
    });

    it("should throw for empty metadata array", () => {
      expect(() => getPayseraConfigFromMetadata([])).toThrow(PayseraConfigError);
      expect(() => getPayseraConfigFromMetadata([])).toThrow("No private metadata found");
    });

    it("should throw when paysera_config key is missing", () => {
      const metadata = [{ key: "other_key", value: "some value" }];

      expect(() => getPayseraConfigFromMetadata(metadata)).toThrow(PayseraConfigError);
      expect(() => getPayseraConfigFromMetadata(metadata)).toThrow(
        "Paysera configuration not found in metadata"
      );
    });

    it("should throw for invalid JSON", () => {
      const metadata = [{ key: "paysera_config", value: "not valid json" }];

      expect(() => getPayseraConfigFromMetadata(metadata)).toThrow(PayseraConfigError);
      expect(() => getPayseraConfigFromMetadata(metadata)).toThrow(
        "Invalid JSON in Paysera configuration"
      );
    });

    it("should throw for invalid config structure", () => {
      const metadata = [
        {
          key: "paysera_config",
          value: JSON.stringify({ projectId: "", password: "secret" }),
        },
      ];

      expect(() => getPayseraConfigFromMetadata(metadata)).toThrow(PayseraConfigError);
      expect(() => getPayseraConfigFromMetadata(metadata)).toThrow("Invalid Paysera configuration");
    });

    it("should extract config from metadata with multiple keys", () => {
      const config = {
        projectId: "12345",
        password: "secret",
        testMode: false,
      };

      const metadata = [
        { key: "other_key", value: "other value" },
        { key: "paysera_config", value: JSON.stringify(config) },
        { key: "another_key", value: "another value" },
      ];

      const result = getPayseraConfigFromMetadata(metadata);

      expect(result).toEqual(config);
    });
  });

  describe("serializePayseraConfig", () => {
    it("should serialize config to metadata format", () => {
      const config = {
        projectId: "12345",
        password: "secret",
        testMode: true,
      };

      const result = serializePayseraConfig(config);

      expect(result.key).toBe("paysera_config");
      expect(JSON.parse(result.value)).toEqual(config);
    });

    it("should produce JSON that can be deserialized", () => {
      const config = {
        projectId: "12345",
        password: "secret",
        testMode: false,
      };

      const serialized = serializePayseraConfig(config);
      const metadata = [serialized];
      const deserialized = getPayseraConfigFromMetadata(metadata);

      expect(deserialized).toEqual(config);
    });
  });

  describe("getPayseraConfigKey", () => {
    it("should return the metadata key", () => {
      expect(getPayseraConfigKey()).toBe("paysera_config");
    });
  });

  describe("maskPassword", () => {
    it("should mask password keeping first and last 2 characters", () => {
      const result = maskPassword("secret123");

      expect(result).toBe("se****23");
    });

    it("should fully mask short passwords", () => {
      const result = maskPassword("abc");

      expect(result).toBe("****");
    });

    it("should fully mask password of length 4", () => {
      const result = maskPassword("abcd");

      expect(result).toBe("****");
    });

    it("should handle password of length 5", () => {
      const result = maskPassword("abcde");

      expect(result).toBe("ab****de");
    });

    it("should handle empty password", () => {
      const result = maskPassword("");

      expect(result).toBe("****");
    });
  });
});
