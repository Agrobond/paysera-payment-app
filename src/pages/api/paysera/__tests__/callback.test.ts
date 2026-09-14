import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionEventTypeEnum, TransactionDetailsViaIdDocument } from "@/generated/graphql";
import { generateSignature, toUrlSafeBase64 } from "@/modules/paysera/paysera-request-builder";
import { PayseraStatus } from "@/modules/paysera/paysera-types";

// vi.mock calls below are hoisted above this import by vitest, so the handler
// picks up the mocked Saleor client and APL.
import handler from "../callback";

const { aplGet, querySpy, mutationSpy } = vi.hoisted(() => ({
  aplGet: vi.fn(),
  querySpy: vi.fn(),
  mutationSpy: vi.fn(),
}));

vi.mock("@/saleor-app", () => ({
  saleorApp: { apl: { get: aplGet } },
}));

vi.mock("@/lib/create-graphql-client", () => ({
  createClient: () => ({
    query: (...args: unknown[]) => querySpy(...args),
    mutation: (...args: unknown[]) => mutationSpy(...args),
  }),
}));

vi.mock("@/lib/logger/create-logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const PASSWORD = "sign_password";
const PROJECT_ID = "12345";
const SALEOR_API_URL = "https://api.example.com/graphql/";
const TRANSACTION_ID = "VHJhbnNhY3Rpb25JdGVtOjEyMw==";

/** Amount currently charged on the transaction, as Saleor would report it. */
let chargedAmount = 0;

/**
 * Builds a genuinely-signed Paysera callback. The handler runs real signature
 * verification, so tests cannot hand it an arbitrary blob.
 */
function buildCallback(overrides: Record<string, string> = {}) {
  const params: Record<string, string> = {
    projectid: PROJECT_ID,
    orderid: "AGB-ORDER-1",
    amount: "8976",
    currency: "EUR",
    status: "1",
    requestid: "req-1",
    test: "0",
    ...overrides,
  };

  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const data = toUrlSafeBase64(query);

  return { data, ss1: generateSignature(data, PASSWORD) };
}

function createRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    redirectedTo: undefined as string | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    send(body: unknown) {
      res.body = body;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    redirect(code: number, url: string) {
      res.statusCode = code;
      res.redirectedTo = url;
      return res;
    },
  };
  return res;
}

async function invokeCallback(overrides: Record<string, string> = {}) {
  const { data, ss1 } = buildCallback(overrides);
  const req = {
    method: "GET",
    headers: { host: "paysera.apps.example.com" },
    query: {
      action: "callback",
      transactionId: TRANSACTION_ID,
      saleorApiUrl: encodeURIComponent(SALEOR_API_URL),
      data,
      ss1,
    },
  };
  const res = createRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler(req as any, res as any);
  return res;
}

/** The variables the handler passed to transactionEventReport. */
function reportedEvent() {
  expect(mutationSpy).toHaveBeenCalledTimes(1);
  return mutationSpy.mock.calls[0][1] as {
    type: TransactionEventTypeEnum;
    pspReference: string;
    amount: number;
    message: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  chargedAmount = 0;

  aplGet.mockResolvedValue({ token: "app-token", saleorApiUrl: SALEOR_API_URL });

  querySpy.mockImplementation((document: unknown) => {
    if (document === TransactionDetailsViaIdDocument) {
      return Promise.resolve({
        data: { transaction: { chargedAmount: { amount: chargedAmount, currency: "EUR" } } },
      });
    }

    return Promise.resolve({
      data: {
        app: {
          privateMetadata: [
            {
              key: "paysera_config",
              value: JSON.stringify({
                projectId: PROJECT_ID,
                password: PASSWORD,
                testMode: false,
              }),
            },
          ],
        },
      },
    });
  });

  mutationSpy.mockResolvedValue({
    data: { transactionEventReport: { alreadyProcessed: false, errors: [] } },
  });
});

describe("paysera callback — server notification", () => {
  it("reports a successful payment as CHARGE_SUCCESS", async () => {
    const res = await invokeCallback({ status: String(PayseraStatus.SUCCESS) });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("OK");
    expect(reportedEvent().type).toBe(TransactionEventTypeEnum.ChargeSuccess);
    expect(reportedEvent().amount).toBe(89.76);
  });

  it("reports a pending payment as CHARGE_REQUEST", async () => {
    await invokeCallback({ status: String(PayseraStatus.PENDING) });
    expect(reportedEvent().type).toBe(TransactionEventTypeEnum.ChargeRequest);
  });

  it("reports an accepted-but-unexecuted payment as CHARGE_REQUEST", async () => {
    await invokeCallback({ status: String(PayseraStatus.ACCEPTED_NOT_EXECUTED) });
    expect(reportedEvent().type).toBe(TransactionEventTypeEnum.ChargeRequest);
  });

  // Regression: Paysera follows a paid transaction with a second callback
  // carrying supplementary payer details. It used to fall through to the
  // failure branch and stamp already-paid orders as failed.
  it("reports status 3 (additional info) as INFO, never as a failure", async () => {
    await invokeCallback({ status: String(PayseraStatus.ADDITIONAL_INFO_REQUIRED) });

    const event = reportedEvent();
    expect(event.type).toBe(TransactionEventTypeEnum.Info);
    expect(event.type).not.toBe(TransactionEventTypeEnum.ChargeFailure);
  });

  it("still reports a genuinely unknown status as CHARGE_FAILURE", async () => {
    await invokeCallback({ status: "99" });
    expect(reportedEvent().type).toBe(TransactionEventTypeEnum.ChargeFailure);
  });

  // Regression: a fresh uuid per callback meant Saleor's own `alreadyProcessed`
  // dedupe never fired, so every Paysera retry stacked up as a new event.
  it("derives a stable pspReference so repeat callbacks dedupe", async () => {
    await invokeCallback({ status: String(PayseraStatus.SUCCESS) });
    const first = reportedEvent().pspReference;

    vi.clearAllMocks();
    mutationSpy.mockResolvedValue({
      data: { transactionEventReport: { alreadyProcessed: true, errors: [] } },
    });

    await invokeCallback({ status: String(PayseraStatus.SUCCESS) });

    expect(reportedEvent().pspReference).toBe(first);
    expect(first).toContain("AGB-ORDER-1");
  });

  it("gives distinct statuses distinct pspReferences", async () => {
    await invokeCallback({ status: String(PayseraStatus.SUCCESS) });
    const success = reportedEvent().pspReference;

    vi.clearAllMocks();
    mutationSpy.mockResolvedValue({
      data: { transactionEventReport: { alreadyProcessed: false, errors: [] } },
    });

    await invokeCallback({ status: String(PayseraStatus.PENDING) });

    expect(reportedEvent().pspReference).not.toBe(success);
  });

  // Regression: the money has already arrived; a late failure callback must not
  // move the transaction backwards out of a charged state.
  it("ignores a failure callback once the transaction is charged", async () => {
    chargedAmount = 89.76;

    const res = await invokeCallback({ status: "99" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("OK");
    expect(mutationSpy).not.toHaveBeenCalled();
  });

  it("still reports a failure when nothing has been charged", async () => {
    chargedAmount = 0;

    await invokeCallback({ status: "99" });

    expect(reportedEvent().type).toBe(TransactionEventTypeEnum.ChargeFailure);
  });

  it("rejects a callback whose signature does not match", async () => {
    const { data } = buildCallback();
    const res = createRes();
    const req = {
      method: "GET",
      headers: { host: "paysera.apps.example.com" },
      query: {
        action: "callback",
        transactionId: TRANSACTION_ID,
        saleorApiUrl: encodeURIComponent(SALEOR_API_URL),
        data,
        ss1: "0".repeat(32),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(req as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(mutationSpy).not.toHaveBeenCalled();
  });
});

describe("paysera callback — customer redirect", () => {
  it("names the gateway in the return URL so completion does not rely on sessionStorage", async () => {
    process.env.STOREFRONT_URL = "https://shop.example.com";

    const res = createRes();
    const req = {
      method: "GET",
      headers: { host: "paysera.apps.example.com" },
      query: {
        action: "accept",
        transactionId: TRANSACTION_ID,
        checkoutId: encodeURIComponent("Q2hlY2tvdXQ6YWJj"),
        locale: "lt",
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler(req as any, res as any);

    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toContain("paymentReturn=paysera");
    expect(res.redirectedTo).toContain("checkout=Q2hlY2tvdXQ6YWJj");
  });
});
