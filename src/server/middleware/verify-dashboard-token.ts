import { TRPCError } from "@trpc/server";
import type { AuthData } from "@saleor/app-sdk/APL";
import type { Permission } from "@saleor/app-sdk/types";
import { verifyJWT } from "@saleor/app-sdk/verify-jwt";

/**
 * Every tRPC route acts with this app's own Saleor token, so the caller has to prove it is a
 * Dashboard session. The saleor-api-url header only says which install to use, and anyone can
 * send it: until 2026-10-01 these routes trusted it alone, so anyone who knew the app's URL could
 * call them (change payment settings, report payment events, create shipments, overwrite slugs).
 *
 * The Dashboard hands the app a short-lived JWT through App Bridge, refreshes it, and the tRPC
 * client sends the current one on every request. verifyJWT checks its signature against Saleor's
 * JWKS, its expiry, and that it was issued for this app. No permission is required beyond that
 * by default: any staff member who can open the app keeps working, outsiders cannot.
 */
export async function verifyDashboardToken(
  token: string | undefined,
  authData: AuthData,
  requiredPermissions: Permission[] = [],
): Promise<void> {
  if (!token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing Dashboard token" });
  }
  try {
    // appId is always present: FileAPL refuses to return a registration without one, so an
    // install that works at all has it.
    await verifyJWT({ appId: authData.appId, token, saleorApiUrl: authData.saleorApiUrl, requiredPermissions });
  } catch (e) {
    // The reason matters when a real staff member is refused: expired, wrong app, permissions.
    console.warn("[auth] Dashboard token rejected:", e instanceof Error ? e.message : e);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Dashboard token verification failed" });
  }
}
