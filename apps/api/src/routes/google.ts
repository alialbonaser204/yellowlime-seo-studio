import { Router, type IRouter, type Request } from "express";
import {
  GetGoogleStatusResponse,
  GetPartnerSearchConsoleParams,
  GetPartnerSearchConsoleQueryParams,
  GetPartnerSearchConsoleResponse,
} from "@yellowlime/api-zod";
import { logger } from "../lib/logger";
import {
  authorizationUrl,
  completeConnection,
  createState,
  currentConnection,
  disconnect,
  googleConfig,
  safeReturnPath,
  verifyState,
} from "../services/googleAuth";
import { clearSearchConsoleCache, partnerSearchConsole } from "../services/searchConsole";

const router: IRouter = Router();
const STATE_COOKIE = "yl_google_state";

function redirectUri(req: Request): string {
  return googleConfig()?.redirectUri ?? `${req.protocol}://${req.host}/api/google/callback`;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function withResult(path: string, result: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}google=${result}`;
}

router.get("/google/status", async (req, res): Promise<void> => {
  const config = googleConfig();
  const connection = config ? await currentConnection() : null;
  res.set("Cache-Control", "no-store");
  res.json(
    GetGoogleStatusResponse.parse({
      configured: Boolean(config),
      connected: Boolean(connection && !connection.lastError),
      needsReconnect: Boolean(connection?.lastError),
      account: connection?.email ?? null,
      connectedAt: connection?.connectedAt ?? null,
      redirectUri: redirectUri(req),
    }),
  );
});

router.get("/google/connect", (req, res): void => {
  const returnTo = safeReturnPath(req.query.returnTo);
  const config = googleConfig();
  if (!config) {
    res.redirect(withResult(returnTo, "not_configured"));
    return;
  }
  const { state, nonce } = createState(returnTo, config);
  res.cookie(STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: 10 * 60_000,
    path: "/api/google",
  });
  res.redirect(authorizationUrl(config, redirectUri(req), state));
});

router.get("/google/callback", async (req, res): Promise<void> => {
  const config = googleConfig();
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const nonce = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, { path: "/api/google" });
  const verified = config ? verifyState(state, nonce, config) : null;
  if (!config || !verified) {
    res.redirect(withResult("/", "invalid_state"));
    return;
  }
  if (typeof req.query.error === "string" || typeof req.query.code !== "string") {
    res.redirect(withResult(verified.returnTo, "denied"));
    return;
  }
  try {
    await completeConnection(req.query.code, redirectUri(req), config);
    clearSearchConsoleCache();
    logger.info("Google account connected");
    res.redirect(withResult(verified.returnTo, "connected"));
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    logger.warn({ code }, "Google connection failed");
    res.redirect(withResult(verified.returnTo, code === "missing_scope" ? "missing_scope" : "error"));
  }
});

router.post("/google/disconnect", async (_req, res): Promise<void> => {
  await disconnect();
  clearSearchConsoleCache();
  res.status(204).end();
});

router.get("/partners/:partnerId/search-console", async (req, res): Promise<void> => {
  const params = GetPartnerSearchConsoleParams.safeParse(req.params);
  const queryParams = GetPartnerSearchConsoleQueryParams.safeParse(req.query);
  if (!params.success || !queryParams.success) {
    res.status(400).json({ error: "Ongeldige aanvraag." });
    return;
  }
  const days = [28, 90, 180].includes(Number(queryParams.data.days)) ? Number(queryParams.data.days) : 90;
  const overview = await partnerSearchConsole(params.data.partnerId, days, {
    refresh: queryParams.data.refresh === "1" || queryParams.data.refresh === "true",
  });
  if (!overview) {
    res.status(404).json({ error: "Partner niet gevonden." });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(GetPartnerSearchConsoleResponse.parse(overview));
});

export default router;
