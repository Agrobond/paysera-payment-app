/**
 * Base error class for all Paysera-related errors
 */
export class PayseraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayseraError";
  }
}

/**
 * Error thrown when callback signature verification fails
 */
export class PayseraSignatureError extends PayseraError {
  constructor(message = "Invalid callback signature") {
    super(message);
    this.name = "PayseraSignatureError";
  }
}

/**
 * Error thrown when Paysera configuration is missing or invalid
 */
export class PayseraConfigError extends PayseraError {
  constructor(message = "Invalid or missing Paysera configuration") {
    super(message);
    this.name = "PayseraConfigError";
  }
}

/**
 * Error thrown when callback data is malformed or missing required fields
 */
export class PayseraCallbackDataError extends PayseraError {
  constructor(message = "Invalid callback data") {
    super(message);
    this.name = "PayseraCallbackDataError";
  }
}
