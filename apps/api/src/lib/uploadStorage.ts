import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db, uploadsTable } from "@yellowlime/db";

/** Unfinished upload reservations expire after this many milliseconds. */
const RESERVATION_TTL_MS = 15 * 60 * 1000;
const UPLOAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

export interface StoredObject {
  contentType: string;
  data: Buffer;
}

/** Object paths stored in the database look like `/objects/uploads/<uuid>`. */
export function objectPathFor(uploadId: string): string {
  return `/objects/uploads/${uploadId}`;
}

function uploadIdFromObjectPath(objectPath: string): string | null {
  const match = /^\/objects\/uploads\/([^/]+)$/.exec(objectPath);
  const id = match?.[1];
  return id && UPLOAD_ID_PATTERN.test(id) ? id : null;
}

export function isValidUploadId(value: string): boolean {
  return UPLOAD_ID_PATTERN.test(value);
}

/**
 * Reserve an upload slot. The returned id is used in the upload URL; the file
 * itself is sent afterwards with `completeUpload`.
 */
export async function reserveUpload(
  contentType: string,
  size: number,
): Promise<string> {
  const id = randomUUID();
  await db
    .delete(uploadsTable)
    .where(
      and(
        isNull(uploadsTable.uploadedAt),
        lt(uploadsTable.createdAt, new Date(Date.now() - RESERVATION_TTL_MS)),
      ),
    );
  await db.insert(uploadsTable).values({ id, contentType, size });
  return id;
}

/** Store the file for a reservation. Each reservation can be filled only once. */
export async function completeUpload(
  id: string,
  contentType: string,
  data: Buffer,
): Promise<void> {
  const [reservation] = await db
    .select({
      contentType: uploadsTable.contentType,
      size: uploadsTable.size,
      createdAt: uploadsTable.createdAt,
      uploadedAt: uploadsTable.uploadedAt,
    })
    .from(uploadsTable)
    .where(eq(uploadsTable.id, id));

  if (!reservation || reservation.uploadedAt) {
    throw new ObjectNotFoundError();
  }
  if (Date.now() - reservation.createdAt.getTime() > RESERVATION_TTL_MS) {
    throw new UploadRejectedError("Upload link has expired");
  }
  if (contentType.toLowerCase() !== reservation.contentType.toLowerCase()) {
    throw new UploadRejectedError("Content type does not match the request");
  }
  if (data.length === 0 || data.length > reservation.size) {
    throw new UploadRejectedError("File size does not match the request");
  }

  const updated = await db
    .update(uploadsTable)
    .set({ data, size: data.length, uploadedAt: new Date() })
    .where(and(eq(uploadsTable.id, id), isNull(uploadsTable.uploadedAt)))
    .returning({ id: uploadsTable.id });
  if (updated.length === 0) throw new ObjectNotFoundError();
}

/** Load a finished upload by its object path (`/objects/uploads/<uuid>`). */
export async function getObject(objectPath: string): Promise<StoredObject> {
  const id = uploadIdFromObjectPath(objectPath);
  if (!id) throw new ObjectNotFoundError();
  const [row] = await db
    .select({ contentType: uploadsTable.contentType, data: uploadsTable.data })
    .from(uploadsTable)
    .where(eq(uploadsTable.id, id));
  if (!row?.data) throw new ObjectNotFoundError();
  return { contentType: row.contentType, data: row.data };
}

/** Cheap existence check that does not load the file contents. */
export async function objectExists(objectPath: string): Promise<boolean> {
  const id = uploadIdFromObjectPath(objectPath);
  if (!id) return false;
  const [row] = await db
    .select({ uploadedAt: uploadsTable.uploadedAt })
    .from(uploadsTable)
    .where(eq(uploadsTable.id, id));
  return Boolean(row?.uploadedAt);
}
