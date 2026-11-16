import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, partnerProfilesTable, partnersTable } from "@yellowlime/db";
import {
  CreatePartnerBody,
  CreatePartnerResponse,
  ListPartnersResponse,
  RemovePartnerParams,
  RemovePartnerResponse,
  UpdatePartnerBody,
  UpdatePartnerParams,
  UpdatePartnerResponse,
} from "@yellowlime/api-zod";
import { removePartner } from "../services/partnerRemoval";
import { objectExists } from "../lib/uploadStorage";

const UPLOAD_PATH = /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** undefined = leave as is, null = remove, string = a finished upload; false = invalid. */
async function checkLogo(value: string | null | undefined): Promise<string | null | undefined | false> {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;
  const path = value.trim();
  if (!UPLOAD_PATH.test(path) || !(await objectExists(path))) return false;
  return path;
}

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

  const logoPath = await checkLogo(parsed.data.logoPath);
  if (logoPath === false) {
    res.status(400).json({ error: "De profielfoto kon niet worden gevonden. Upload hem opnieuw." });
    return;
  }

  const [partner] = await db
    .insert(partnersTable)
    .values({
      companyName: parsed.data.companyName.trim(),
      websiteUrl: parsed.data.websiteUrl,
      logoPath: logoPath ?? null,
    })
    .returning();

  res.status(201).json(CreatePartnerResponse.parse({
    ...partner,
    profileStatus: "Nog niet opgebouwd",
  }));
});

router.put("/partners/:partnerId", async (req, res): Promise<void> => {
  const params = UpdatePartnerParams.safeParse(req.params);
  const body = UpdatePartnerBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Vul een geldige partnernaam en website-URL in." });
    return;
  }
  const logoPath = await checkLogo(body.data.logoPath);
  if (logoPath === false) {
    res.status(400).json({ error: "De profielfoto kon niet worden gevonden. Upload hem opnieuw." });
    return;
  }
  const [partner] = await db
    .update(partnersTable)
    .set({
      companyName: body.data.companyName.trim(),
      websiteUrl: body.data.websiteUrl,
      ...(logoPath === undefined ? {} : { logoPath }),
    })
    .where(eq(partnersTable.id, params.data.partnerId))
    .returning();
  if (!partner) {
    res.status(404).json({ error: "Partner niet gevonden." });
    return;
  }
  const [profile] = await db
    .select({ status: partnerProfilesTable.profileStatus })
    .from(partnerProfilesTable)
    .where(eq(partnerProfilesTable.partnerId, partner.id));
  res.json(UpdatePartnerResponse.parse({ ...partner, profileStatus: profile?.status ?? "Nog niet opgebouwd" }));
});

router.delete("/partners/:partnerId", async (req, res): Promise<void> => {
  const params = RemovePartnerParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Partner niet gevonden." });
    return;
  }
  const result = await removePartner(params.data.partnerId);
  if (!result) {
    res.status(404).json({ error: "Partner niet gevonden." });
    return;
  }
  req.log.info({ partnerId: result.id, removed: result.removed }, "Partner deleted");
  res.json(RemovePartnerResponse.parse(result));
});

export default router;