import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  AnalyzePartnerWebsiteParams,
  AnalyzePartnerWebsiteResponse,
  ApprovePartnerProfileBody,
  ApprovePartnerProfileParams,
  ApprovePartnerProfileResponse,
  GetPartnerProfileParams,
  GetPartnerProfileResponse,
  GeneratePartnerProfileDraftParams,
  GeneratePartnerProfileDraftResponse,
  RejectPartnerProfileBody,
  RejectPartnerProfileParams,
  RejectPartnerProfileResponse,
  SavePartnerProfileReviewBody,
  SavePartnerProfileReviewParams,
  SavePartnerProfileReviewResponse,
} from "@yellowlime/api-zod";
import {
  db,
  partnerProfilesTable,
  partnersTable,
  yellowlimersTable,
} from "@yellowlime/db";
import { collectWebsite } from "../services/websiteCollection";
import {
  CLAUDE_MODEL,
  claudeErrorMessage,
  generatePartnerProfile,
  generateSafePartnerProfileDraft,
  PROFILE_DRAFT_PROMPT_VERSION,
  PROMPT_VERSION,
} from "../services/claudePartnerProfile";

const router: IRouter = Router();
type ProfileRow = typeof partnerProfilesTable.$inferSelect;
type ProfilePayload = {
  companyName: string | null;
  companyDescription: string | null;
  products: string[];
  services: string[];
  targetAudience: string[];
  toneOfVoice: string[];
  writingStyle: string[];
  importantFacts: string[];
  locations: string[];
  sourceUrls: string[];
  missingInformation: string[];
};

function response(row: ProfileRow) {
  return {
    ...row,
    websitePages: row.websitePages ?? [],
    claudeProfile: row.claudeProfile as ProfilePayload | null,
    reviewProfile: row.reviewProfile as ProfilePayload | null,
    approvedProfile: row.approvedProfile as ProfilePayload | null,
    claudeModelName: CLAUDE_MODEL,
    promptVersion: row.promptVersion || PROMPT_VERSION,
  };
}

function manualReviewProfile(
  companyName: string,
  websiteUrl: string,
  reason: string,
): ProfilePayload {
  return {
    companyName,
    companyDescription: null,
    products: [],
    services: [],
    targetAudience: [],
    toneOfVoice: [],
    writingStyle: [],
    importantFacts: [],
    locations: [],
    sourceUrls: [websiteUrl],
    missingInformation: [
      `${reason} Controleer en vul dit partnerprofiel daarom handmatig aan.`,
    ],
  };
}

function canContinueWithManualProfile(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /robots|publieke HTML|leesbare tekst|reageert te traag/i.test(message);
}

async function findProfile(partnerId: number): Promise<ProfileRow | undefined> {
  const [profile] = await db.select().from(partnerProfilesTable)
    .where(eq(partnerProfilesTable.partnerId, partnerId));
  return profile;
}

async function ensureReviewer(reviewerId: number): Promise<boolean> {
  const [row] = await db.select({ active: yellowlimersTable.active })
    .from(yellowlimersTable).where(eq(yellowlimersTable.id, reviewerId));
  return Boolean(row?.active);
}

async function profileOr404(partnerId: number, res: Response) {
  const profile = await findProfile(partnerId);
  if (!profile) {
    res.status(404).json({ error: "Partnerprofiel niet gevonden." });
    return null;
  }
  return profile;
}

router.get("/partners/:partnerId/profile", async (req, res): Promise<void> => {
  const params = GetPartnerProfileParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  const [partner] = await db.select({ id: partnersTable.id }).from(partnersTable)
    .where(eq(partnersTable.id, params.data.partnerId));
  if (!partner) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  const profile = await findProfile(params.data.partnerId);
  res.json(GetPartnerProfileResponse.parse(profile ? response(profile) : null));
});

router.post("/partners/:partnerId/profile/analyze", async (req, res): Promise<void> => {
  const params = AnalyzePartnerWebsiteParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  const [partner] = await db.select().from(partnersTable)
    .where(eq(partnersTable.id, params.data.partnerId));
  if (!partner) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  const existing = await findProfile(partner.id);
  const values = {
    partnerId: partner.id,
    websitePages: [],
    websiteText: "",
    claudeProfile: null,
    reviewProfile: null,
    profileStatus: "Wordt opgebouwd" as const,
    claudeModelName: CLAUDE_MODEL,
    promptVersion: PROMPT_VERSION,
    failureMessage: null,
  };
  const pending = existing
    ? (await db.update(partnerProfilesTable).set(values).where(eq(partnerProfilesTable.id, existing.id)).returning())[0]
    : (await db.insert(partnerProfilesTable).values(values).returning())[0];
  res.status(202).json(AnalyzePartnerWebsiteResponse.parse(response(pending)));
  void (async () => {
    try {
      const collection = await collectWebsite(partner.websiteUrl);
      const claude = await generatePartnerProfile(collection.pages);
      await db.update(partnerProfilesTable).set({
        websitePages: collection.pages,
        websiteText: collection.text,
        claudeProfile: claude as unknown as Record<string, unknown>,
        reviewProfile: claude as unknown as Record<string, unknown>,
        profileStatus: "Wacht op controle",
        failureMessage: null,
      }).where(eq(partnerProfilesTable.id, pending.id));
    } catch (error) {
      req.log.error({ code: "partner_profile_analysis_failed", errorType: error instanceof Error ? error.name : typeof error }, "Partnerprofiel-analyse mislukt");
      const safeMessage = claudeErrorMessage(error);
      const manualProfile = canContinueWithManualProfile(error)
        ? manualReviewProfile(partner.companyName, partner.websiteUrl, safeMessage)
        : null;
      await db.update(partnerProfilesTable).set({
        claudeProfile: null,
        reviewProfile: manualProfile,
        profileStatus: manualProfile ? "Wacht op controle" : "Analyse mislukt",
        failureMessage: manualProfile
          ? `${safeMessage} Vul het profiel handmatig aan en keur het daarna goed.`
          : safeMessage,
      }).where(eq(partnerProfilesTable.id, pending.id)).catch((updateError) => {
        req.log.error({ code: "partner_profile_failure_persist_failed", errorType: updateError instanceof Error ? updateError.name : typeof updateError }, "Mislukte analyse kon niet worden opgeslagen");
      });
    }
  })().catch((error) => req.log.error({ code: "partner_profile_background_rejection", errorType: error instanceof Error ? error.name : typeof error }, "Analyse op achtergrond mislukt"));
});

router.post("/partners/:partnerId/profile/generate-draft", async (req, res): Promise<void> => {
  const params = GeneratePartnerProfileDraftParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  const [partner] = await db.select().from(partnersTable)
    .where(eq(partnersTable.id, params.data.partnerId));
  if (!partner) { res.status(404).json({ error: "Partner niet gevonden." }); return; }

  const existing = await findProfile(partner.id);
  const sourceProfile = (
    existing?.reviewProfile ??
    existing?.approvedProfile ??
    manualReviewProfile(partner.companyName, partner.websiteUrl, "De website is niet gebruikt voor dit AI-concept.")
  ) as ProfilePayload;
  const values = {
    partnerId: partner.id,
    websitePages: existing?.websitePages ?? [],
    websiteText: existing?.websiteText ?? "",
    claudeProfile: existing?.claudeProfile ?? null,
    reviewProfile: sourceProfile as unknown as Record<string, unknown>,
    profileStatus: "Wordt opgebouwd" as const,
    claudeModelName: CLAUDE_MODEL,
    promptVersion: PROFILE_DRAFT_PROMPT_VERSION,
    failureMessage: null,
  };
  const pending = existing
    ? (await db.update(partnerProfilesTable).set(values).where(eq(partnerProfilesTable.id, existing.id)).returning())[0]
    : (await db.insert(partnerProfilesTable).values(values).returning())[0];
  res.status(202).json(GeneratePartnerProfileDraftResponse.parse(response(pending)));

  void (async () => {
    try {
      const draft = await generateSafePartnerProfileDraft(
        partner.companyName,
        partner.websiteUrl,
        sourceProfile,
      );
      await db.update(partnerProfilesTable).set({
        claudeProfile: draft as unknown as Record<string, unknown>,
        reviewProfile: draft as unknown as Record<string, unknown>,
        profileStatus: "Wacht op controle",
        promptVersion: PROFILE_DRAFT_PROMPT_VERSION,
        failureMessage: null,
      }).where(eq(partnerProfilesTable.id, pending.id));
    } catch (error) {
      req.log.error(
        { code: "partner_profile_draft_failed", errorType: error instanceof Error ? error.name : typeof error },
        "AI-concept voor partnerprofiel mislukt",
      );
      await db.update(partnerProfilesTable).set({
        reviewProfile: sourceProfile as unknown as Record<string, unknown>,
        profileStatus: "Wacht op controle",
        failureMessage: `${claudeErrorMessage(error)} De bestaande reviewgegevens zijn behouden.`,
      }).where(eq(partnerProfilesTable.id, pending.id));
    }
  })().catch((error) => req.log.error(
    { code: "partner_profile_draft_background_rejection", errorType: error instanceof Error ? error.name : typeof error },
    "AI-concept op achtergrond mislukt",
  ));
});

router.put("/partners/:partnerId/profile", async (req, res): Promise<void> => {
  const params = SavePartnerProfileReviewParams.safeParse(req.params);
  const body = SavePartnerProfileReviewBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Ongeldig partnerprofiel." }); return; }
  const profile = await profileOr404(params.data.partnerId, res);
  if (!profile) return;
  if (!(await ensureReviewer(body.data.reviewerId))) { res.status(400).json({ error: "De Yellowlimer bestaat niet of is niet actief." }); return; }
  const [saved] = await db.update(partnerProfilesTable).set({ reviewProfile: body.data.profile })
    .where(eq(partnerProfilesTable.id, profile.id)).returning();
  res.json(SavePartnerProfileReviewResponse.parse(response(saved)));
});

router.post("/partners/:partnerId/profile/approve", async (req, res): Promise<void> => {
  const params = ApprovePartnerProfileParams.safeParse(req.params);
  const body = ApprovePartnerProfileBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Ongeldig partnerprofiel." }); return; }
  const profile = await profileOr404(params.data.partnerId, res);
  if (!profile) return;
  if (!(await ensureReviewer(body.data.reviewerId))) { res.status(400).json({ error: "De Yellowlimer bestaat niet of is niet actief." }); return; }
  const [saved] = await db.update(partnerProfilesTable).set({
    reviewProfile: body.data.profile,
    approvedProfile: body.data.profile,
    profileStatus: "Goedgekeurd",
    approvedByYellowlimerId: body.data.reviewerId,
    approvedAt: new Date(),
    failureMessage: null,
  }).where(eq(partnerProfilesTable.id, profile.id)).returning();
  res.json(ApprovePartnerProfileResponse.parse(response(saved)));
});

router.post("/partners/:partnerId/profile/reject", async (req, res): Promise<void> => {
  const params = RejectPartnerProfileParams.safeParse(req.params);
  const body = RejectPartnerProfileBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Ongeldig partnerprofiel." }); return; }
  const profile = await profileOr404(params.data.partnerId, res);
  if (!profile) return;
  if (!(await ensureReviewer(body.data.reviewerId))) { res.status(400).json({ error: "De Yellowlimer bestaat niet of is niet actief." }); return; }
  const [saved] = await db.update(partnerProfilesTable).set({
    reviewProfile: body.data.profile,
    profileStatus: "Afgekeurd",
  }).where(eq(partnerProfilesTable.id, profile.id)).returning();
  res.json(RejectPartnerProfileResponse.parse(response(saved)));
});

export default router;