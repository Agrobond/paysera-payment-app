import { z } from "zod";
import type { PayseraConfig } from "./paysera-types";
import { PayseraConfigError } from "./paysera-errors";

const PAYSERA_CONFIG_KEY = "paysera_config";

/**
 * Zod schema for validating Paysera configuration
 */
export const payseraConfigSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  password: z.string().min(1, "Password is required"),
  testMode: z.boolean().default(true),
});

export type PayseraConfigInput = z.infer<typeof payseraConfigSchema>;

/**
 * Metadata item structure from Saleor GraphQL API
 */
interface MetadataItem {
  key: string;
  value: string;
}

/**
 * Extracts Paysera configuration from Saleor app privateMetadata
 * @throws PayseraConfigError if configuration is missing or invalid
 */
export function getPayseraConfigFromMetadata(
  privateMetadata: MetadataItem[] | null | undefined
): PayseraConfig {
  if (!privateMetadata || privateMetadata.length === 0) {
    throw new PayseraConfigError("No private metadata found");
  }

  const configEntry = privateMetadata.find((item) => item.key === PAYSERA_CONFIG_KEY);

  if (!configEntry) {
    throw new PayseraConfigError("Paysera configuration not found in metadata");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configEntry.value);
  } catch {
    throw new PayseraConfigError("Invalid JSON in Paysera configuration");
  }

  const result = payseraConfigSchema.safeParse(parsed);

  if (!result.success) {
    const errorMessages = result.error.errors.map((e) => e.message).join(", ");
    throw new PayseraConfigError(`Invalid Paysera configuration: ${errorMessages}`);
  }

  return result.data;
}

/**
 * Serializes Paysera configuration for storage in Saleor privateMetadata
 */
export function serializePayseraConfig(config: PayseraConfig): { key: string; value: string } {
  return {
    key: PAYSERA_CONFIG_KEY,
    value: JSON.stringify(config),
  };
}

/**
 * Returns the metadata key used for Paysera configuration
 */
export function getPayseraConfigKey(): string {
  return PAYSERA_CONFIG_KEY;
}

/**
 * Masks the password for safe logging
 */
export function maskPassword(password: string): string {
  if (password.length <= 4) {
    return "****";
  }
  return password.slice(0, 2) + "****" + password.slice(-2);
}
