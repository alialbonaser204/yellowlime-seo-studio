import { asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateYellowlimerBody,
  CreateYellowlimerResponse,
  ListYellowlimersResponse,
  RemoveYellowlimerParams,
  RemoveYellowlimerResponse,
  UpdateYellowlimerBody,
  UpdateYellowlimerParams,
  UpdateYellowlimerResponse,
} from "@yellowlime/api-zod";
import {
  articleReviewsTable,
  articlesTable,
  briefingsTable,
  db,
  yellowlimersTable,
} from "@yellowlime/db";
import { objectExists } from "../lib/uploadStorage";

const router: IRouter = Router();

router.get("/yellowlimers", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Expires", "0");
  const yellowlimers = await db
    .select()
    .from(yellowlimersTable)
    .orderBy(asc(yellowlimersTable.name));
  const renderableYellowlimers = await Promise.all(
    yellowlimers.map(async (yellowlimer) => {
      if (yellowlimer.avatarType !== "image") return yellowlimer;
      if (await objectExists(yellowlimer.avatarValue)) return yellowlimer;
      return {
        ...yellowlimer,
        avatarType: "icon",
        avatarValue: "UserCircle",
      };
    }),
  );
  res.json(ListYellowlimersResponse.parse(renderableYellowlimers));
});

router.post("/yellowlimers", async (req, res): Promise<void> => {
  const parsed = CreateYellowlimerBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid Yellowlimer");
    res.status(400).json({ error: "Vul alle verplichte velden in." });
    return;
  }

  const [yellowlimer] = await db
    .insert(yellowlimersTable)
    .values({
      name: parsed.data.name.trim(),
      avatarType: parsed.data.avatarType,
      avatarValue: parsed.data.avatarValue.trim(),
    })
    .returning();
  res.status(201).json(CreateYellowlimerResponse.parse(yellowlimer));
});

router.patch("/yellowlimers/:id", async (req, res): Promise<void> => {
  const params = UpdateYellowlimerParams.safeParse(req.params);
  const body = UpdateYellowlimerBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Ongeldige Yellowlimergegevens." });
    return;
  }

  const [yellowlimer] = await db
    .update(yellowlimersTable)
    .set({
      name: body.data.name.trim(),
      avatarType: body.data.avatarType,
      avatarValue: body.data.avatarValue.trim(),
      active: body.data.active,
    })
    .where(eq(yellowlimersTable.id, params.data.id))
    .returning();

  if (!yellowlimer) {
    res.status(404).json({ error: "Yellowlimer niet gevonden." });
    return;
  }
  res.json(UpdateYellowlimerResponse.parse(yellowlimer));
});

router.delete("/yellowlimers/:id", async (req, res): Promise<void> => {
  const params = RemoveYellowlimerParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Yellowlimer niet gevonden." });
    return;
  }

  const [yellowlimer] = await db
    .select()
    .from(yellowlimersTable)
    .where(eq(yellowlimersTable.id, params.data.id));
  if (!yellowlimer) {
    res.status(404).json({ error: "Yellowlimer niet gevonden." });
    return;
  }

  const [briefingReference] = await db
    .select({ id: briefingsTable.id })
    .from(briefingsTable)
    .where(eq(briefingsTable.reviewerId, params.data.id))
    .limit(1);
  const [articleReference] = await db
    .select({ id: articlesTable.id })
    .from(articlesTable)
    .where(eq(articlesTable.yellowlimerId, params.data.id))
    .limit(1);
  const [reviewReference] = await db
    .select({ id: articleReviewsTable.id })
    .from(articleReviewsTable)
    .where(eq(articleReviewsTable.yellowlimerId, params.data.id))
    .limit(1);

  if (briefingReference || articleReference || reviewReference) {
    const [deactivated] = await db
      .update(yellowlimersTable)
      .set({ active: false })
      .where(eq(yellowlimersTable.id, params.data.id))
      .returning({ id: yellowlimersTable.id, active: yellowlimersTable.active });
    res.json(
      RemoveYellowlimerResponse.parse({
        id: deactivated.id,
        deleted: false,
        active: deactivated.active,
      }),
    );
    return;
  }

  await db
    .delete(yellowlimersTable)
    .where(eq(yellowlimersTable.id, params.data.id));
  res.json(RemoveYellowlimerResponse.parse({ id: params.data.id, deleted: true, active: false }));
});

export default router;