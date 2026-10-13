import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, partnerProfilesTable, partnersTable } from "@yellowlime/db";
import {
  CreatePartnerBody,
  CreatePartnerResponse,
  ListPartnersResponse,
} from "@yellowlime/api-zod";

const router: IRouter = Router();

router.get("/partners", async (_req, res): Promise<void> => {
  const partners = await db
    .select()
    .from(partnersTable)
    .orderBy(asc(partnersTable.companyName));

  const profiles = await db
    .select({ partnerId: partnerProfilesTable.partnerId, status: partnerProfilesTable.profileStatus })
    .from(partnerProfilesTable);
  const statuses = new Map(profiles.map((profile) => [profile.partnerId, profile.status]));
  res.json(ListPartnersResponse.parse(partners.map((partner) => ({
    ...partner,
    profileStatus: statuses.get(partner.id) ?? "Nog niet opgebouwd",
  }))));
});

router.post("/partners", async (req, res): Promise<void> => {
  const parsed = CreatePartnerBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Ongeldige partnergegevens");
    res.status(400).json({ error: "Vul een geldige partnernaam en website-URL in." });
    return;
  }

  const [partner] = await db
    .insert(partnersTable)
    .values({
      companyName: parsed.data.companyName.trim(),
      websiteUrl: parsed.data.websiteUrl,
    })
    .returning();

  res.status(201).json(CreatePartnerResponse.parse({
    ...partner,
    profileStatus: "Nog niet opgebouwd",
  }));
});

export default router;