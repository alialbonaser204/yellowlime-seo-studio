import { Router, type IRouter } from "express";
import { SuggestInternalLinksBody, SuggestInternalLinksParams, SuggestInternalLinksResponse } from "@yellowlime/api-zod";
import { suggestInternalLinks } from "../services/internalLinks";

const router: IRouter = Router();

router.post("/partners/:partnerId/internal-links", async (req, res): Promise<void> => {
  const params = SuggestInternalLinksParams.safeParse(req.params);
  const body = SuggestInternalLinksBody.safeParse(req.body);
  if (!params.success) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  if (!body.success) { res.status(400).json({ error: "Het artikel is te kort of ontbreekt." }); return; }
  try {
    const result = await suggestInternalLinks(params.data.partnerId, body.data);
    if (!result) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
    res.json(SuggestInternalLinksResponse.parse(result));
  } catch (error) {
    req.log.warn({ code: "internal_links_failed", reason: error instanceof Error ? error.message.slice(0, 200) : typeof error }, "Internal links failed");
    res.status(502).json({ error: "De controle op interne links is mislukt. Probeer het later opnieuw." });
  }
});

export default router;
