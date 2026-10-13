import express, { Router, type IRouter, type Request, type Response } from "express";
import {
  GetStorageObjectParams,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@yellowlime/api-zod";
import {
  ObjectNotFoundError,
  UploadRejectedError,
  completeUpload,
  getObject,
  isValidUploadId,
  objectPathFor,
  reserveUpload,
} from "../lib/uploadStorage";

const router: IRouter = Router();
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * POST /storage/uploads/request-url
 *
 * The client sends JSON metadata (name, size, contentType), receives an upload
 * URL and then PUTs the file to that URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;
    if (size > MAX_AVATAR_SIZE) {
      res.status(400).json({ error: "Images may not exceed 2 MB" });
      return;
    }
    if (!ALLOWED_AVATAR_TYPES.has(contentType.toLowerCase())) {
      res.status(400).json({ error: "Only JPEG, PNG, and WebP images are allowed" });
      return;
    }

    const uploadId = await reserveUpload(contentType.toLowerCase(), size);
    const uploadURL = `${req.protocol}://${req.host}/api/storage/uploads/${uploadId}`;

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath: objectPathFor(uploadId),
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * PUT /storage/uploads/:id
 *
 * Receives the raw file for a previously requested upload URL.
 */
router.put(
  "/storage/uploads/:id",
  express.raw({ type: () => true, limit: MAX_AVATAR_SIZE }),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isValidUploadId(id) || !Buffer.isBuffer(req.body)) {
      res.status(404).json({ error: "Upload not found" });
      return;
    }
    try {
      await completeUpload(id, String(req.headers["content-type"] ?? ""), req.body);
      res.status(200).end();
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Upload not found" });
        return;
      }
      if (error instanceof UploadRejectedError) {
        res.status(400).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Error storing upload");
      res.status(500).json({ error: "Failed to store upload" });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serves uploaded files.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const rawPath = req.params.path;
    const normalizedPath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
    const parsedParams = GetStorageObjectParams.safeParse({ objectPath: normalizedPath });
    if (!parsedParams.success) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const object = await getObject(`/objects/${parsedParams.data.objectPath}`);
    res.setHeader("Content-Type", object.contentType);
    res.setHeader("Content-Length", String(object.data.length));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(object.data);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
