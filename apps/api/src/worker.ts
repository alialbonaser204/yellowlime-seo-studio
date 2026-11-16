/**
 * Entry point on Cloudflare Workers. The same Express app as on a Node server
 * (src/index.ts) handles every /api request; the web app itself is served by
 * Workers static assets (see wrangler.jsonc).
 *
 * Two things differ from a Node server, and both are handled here per request:
 * - the database connection: Workers do not allow sharing a connection
 *   between requests, so each request opens its own (via Hyperdrive when the
 *   HYPERDRIVE binding exists, otherwise DATABASE_URL);
 * - background work (an article being written, a website scan, ...): a Worker
 *   stops when its response is finished, so the response is only finished
 *   after that work is done. The browser simply waits a little longer.
 */
// Must come first: other modules read process.env while they load.
import "./workers/env";
import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import express, { type Response } from "express";
import { createDatabaseScope, runWithDatabaseScope } from "@yellowlime/db";
import app from "./app";
import { collectBackgroundTasks, waitForBackgroundTasks, type BackgroundTasks } from "./lib/background";
import { logger } from "./lib/logger";

const PORT = 8080;


function connectionString(): string {
  const bindings = env as unknown as { HYPERDRIVE?: { connectionString: string }; DATABASE_URL?: string };
  const url = bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set as a secret of this Worker (Settings > Variables and Secrets), and there is no HYPERDRIVE binding.");
  return url;
}

const root = express();
root.set("trust proxy", true);
root.disable("x-powered-by");

root.use((req, res, next) => {
  // Workers are only reachable over HTTPS (except during local development);
  // this makes req.protocol right for the Google sign-in redirect.
  if (!req.headers["x-forwarded-proto"] && !/^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host ?? "")) {
    req.headers["x-forwarded-proto"] = "https";
  }
  const scope = createDatabaseScope(connectionString);
  const background: BackgroundTasks = { tasks: [] };
  const end = res.end.bind(res) as (...args: unknown[]) => Response;
  let ended = false;
  res.end = ((...args: unknown[]) => {
    if (ended) return res;
    ended = true;
    // Background work is started right after res.json(...) in the same tick,
    // so look for it on the next turn of the event loop.
    setTimeout(() => {
      waitForBackgroundTasks(background)
        .catch((error: unknown) => logger.error({ err: error }, "Background work failed"))
        .finally(() => {
          end(...args);
          void scope.close();
        });
    }, 0);
    return res;
  }) as Response["end"];
  runWithDatabaseScope(scope, () => collectBackgroundTasks(background, () => next()));
});

root.use(app);
root.listen(PORT);

export default httpServerHandler({ port: PORT });
