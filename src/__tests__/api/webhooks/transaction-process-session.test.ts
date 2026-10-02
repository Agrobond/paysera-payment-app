import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";

import { TransactionFlowStrategyEnum } from "@/generated/graphql";

// Strip the webhook signature wrapper and the observability wrappers so we can
// call the bare handler with a fabricated context. createHandler normally
// verifies Saleor's signature; here it just returns the inner function.
vi.mock("@saleor/app-sdk/handlers/next", () => ({
  SaleorSyncWebhook: class {
    constructor(_opts: unknown) {}
    createHandler(fn: unknown) {
      return fn;
    }
  },
}));
vi.mock("@/lib/otel/otel-wrapper", () => ({ withOtel: (h: unknown) => h }));
vi.mock("@/lib/logger/logger-context", () => ({
  wrapWithLoggerContext: (h: unknown) => h,
  LoggerContext: class {},
}));
vi.mock("@/logger-context", () => ({ loggerContext: {} }));
vi.mock("@/lib/logger/create-logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/saleor-app", () => ({ saleorApp: { apl: {} } }));

import handler from "@/pages/api/webhooks/transaction-process-session";

function createRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function invoke(actionType: TransactionFlowStrategyEnum, data: unknown) {
  const res = createRes();
  const ctx = {
    authData: { appId: "QXBwOjE=", saleorApiUrl: "https://api.example.com/graphql/", token: "t" },
    payload: {
      action: { actionType, amount: 500 },
      transaction: { id: "VHJhbnNhY3Rpb25JdGVtOjE=" },
      data,
    },
  };
  (handler as unknown as (req: NextApiRequest, res: NextApiResponse, ctx: unknown) => unknown)(
    { method: "POST", headers: {} } as unknown as NextApiRequest,
    res as unknown as NextApiResponse,
    ctx,
  );
  return res.body as { result: string; amount: number };
}

describe("paysera transaction-process-session — never trusts caller data", () => {
  // The whole point of the fix: transactionProcess is a public Saleor mutation,
  // so the `data` here is attacker-controlled. Reflecting it back as the result
  // let anyone mark a transaction charged for free.
  it("returns CHARGE_REQUEST even when the caller asks for CHARGE_SUCCESS", () => {
    const body = invoke(TransactionFlowStrategyEnum.Charge, {
      event: { type: "CHARGE_SUCCESS", includePspReference: true },
    });

    expect(body.result).toBe("CHARGE_REQUEST");
    expect(body.result).not.toBe("CHARGE_SUCCESS");
  });

  it("returns AUTHORIZATION_REQUEST for an authorization flow, ignoring the caller's type", () => {
    const body = invoke(TransactionFlowStrategyEnum.Authorization, {
      event: { type: "AUTHORIZATION_SUCCESS" },
    });

    expect(body.result).toBe("AUTHORIZATION_REQUEST");
  });

  it("does not return success even for an empty / junk data payload", () => {
    for (const data of [null, {}, { event: {} }, "CHARGE_SUCCESS", 42]) {
      const body = invoke(TransactionFlowStrategyEnum.Charge, data);
      expect(body.result).toBe("CHARGE_REQUEST");
    }
  });
});
