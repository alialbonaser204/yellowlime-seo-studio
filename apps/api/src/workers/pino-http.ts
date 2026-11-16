/**
 * Stand-in for pino-http on Cloudflare Workers (aliased in wrangler.jsonc):
 * gives every request `req.log` and logs one line when the response is done.
 */
import type { NextFunction, Request, Response } from "express";
import type { WorkerLogger } from "./pino";

let counter = 0;

export default function pinoHttp(options: { logger: WorkerLogger }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = ++counter;
    const log = options.logger.child({ reqId: id });
    const started = Date.now();
    Object.assign(req, { id, log });
    res.on("finish", () => {
      log.info(
        { req: { method: req.method, url: req.originalUrl.split("?")[0] }, res: { statusCode: res.statusCode }, responseTime: Date.now() - started },
        "request completed",
      );
    });
    next();
  };
}
