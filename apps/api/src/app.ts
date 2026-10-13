import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind a hosting proxy (Render, Railway, Nginx, ...) this makes req.protocol
// and req.ip reflect the original request.
app.set("trust proxy", true);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// The web app is served from the same origin, so CORS is only needed when the
// frontend is hosted somewhere else. Set CORS_ORIGIN to that origin if so.
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(",").map((o) => o.trim()) }));
}

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve the built web app (apps/web/dist/public) when it is available.
const webDistDir = process.env.WEB_DIST_DIR
  ? path.resolve(process.env.WEB_DIST_DIR)
  : path.resolve(__dirname, "../../web/dist/public");

if (fs.existsSync(path.join(webDistDir, "index.html"))) {
  app.use(
    express.static(webDistDir, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // Client-side routing: every non-API GET request returns the app shell.
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(webDistDir, "index.html"));
  });
} else {
  logger.info({ webDistDir }, "Web build not found; serving the API only");
}

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
