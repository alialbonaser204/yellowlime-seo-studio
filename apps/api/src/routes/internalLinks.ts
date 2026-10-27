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
    const code = error instanceof Error ? error.message : "";
    req.log.warn({ code: "internal_links_failed", reason: code.slice(0, 200) }, "Internal links failed");
    res.status(502).json({
      error:
        code === "missing_key" ? "De AI-sleutel ontbreekt."
        : code === "invalid_key" ? "De AI-sleutel is ongeldig."
        : code === "invalid_claude_json" ? "Yellowlime AI Agent gaf een onleesbaar antwoord. Probeer het nog een keer."
        : code === "claude_timeout" ? "Yellowlime AI Agent had te veel tijd nodig. Probeer het nog een keer."
        : "Er konden geen interne links worden voorgesteld. Probeer het later opnieuw.",
    });
  }
});

export default router;
