import {
  CLAUDE_MODEL,
  defaultClaudeTextRunner,
} from "./claudeRunner";

export { CLAUDE_MODEL };
export const PROMPT_VERSION = "partner-profile-v1";
export const PROFILE_DRAFT_PROMPT_VERSION = "partner-profile-safe-draft-v1";

export function claudeErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "missing_key") return "De AI-sleutel ontbreekt.";
  if (code === "invalid_key") return "De AI-sleutel is ongeldig.";
  if (code === "invalid_claude_json" || code === "invented_source_url" || code === "invented_profile_fact") return "De AI leverde geen veilig profiel op.";
  if (code === "claude_timeout") return "De AI-analyse duurde te lang.";
  if (code === "claude_api_error") return "De AI-service is tijdelijk niet beschikbaar.";
  if (code.includes("niet worden bereikt")) return "De website kon niet worden bereikt vanaf onze server. Mogelijk blokkeert een beveiliging (firewall) van de website automatische bezoekers.";
  if (code.includes("robots")) return "De website staat deze analyse niet toe (robots.txt).";
  if (code.includes("HTML")) return "De website levert geen bruikbare HTML.";
  if (code.includes("leesbare")) return "De website bevat geen leesbare tekst.";
  if (code.includes("traag")) return "De website reageert te traag.";
  return "De website-analyse is mislukt.";
}

export interface PartnerProfileContent {
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
}

export interface ClaudeRunner {
  (input: string, timeoutMs: number): Promise<string>;
}

export const defaultClaudeRunner = defaultClaudeTextRunner;

export function makeSafePartnerProfileDraftPrompt(
  companyName: string,
  websiteUrl: string,
  existingProfile: PartnerProfileContent,
): string {
  return [
    `Prompt version: ${PROFILE_DRAFT_PROMPT_VERSION}`,
    "Return JSON only, with exactly these snake_case fields:",
    "company_name, company_description, products, services, target_audience, tone_of_voice, writing_style, important_facts, locations, source_urls, missing_information.",
    "Create a safe editable partner-profile draft. Never invent or infer company facts.",
    "The website URL is an identifier only and has not been read. It is not evidence about products, services, audience, locations, history, or brand voice.",
    "Preserve supplied facts. Use null for unknown scalar values and empty arrays for unknown lists.",
    "List the important unknown fields in missing_information using short Dutch descriptions.",
    `Known company name: ${companyName}`,
    `Known website URL: ${websiteUrl}`,
    `Existing employee-entered profile: ${JSON.stringify(existingProfile)}`,
  ].join("\n\n");
}

export function makePartnerProfilePrompt(
  pages: Array<{ url: string; title: string; text: string }>,
): string {
  return [
    `Prompt version: ${PROMPT_VERSION}`,
    "Return JSON only, with exactly these snake_case fields:",
    "company_name, company_description, products, services, target_audience, tone_of_voice, writing_style, important_facts, locations, source_urls, missing_information.",
    "Use only the supplied page text. Never invent facts. Use null for absent scalar data, empty arrays for absent lists, and list absent facts in missing_information.",
    "source_urls may contain only URLs supplied below.",
    ...pages.map((page) => `SOURCE URL: ${page.url}\nTITLE: ${page.title}\nTEXT:\n${page.text}`),
  ].join("\n\n");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseClaudeContent(value: unknown): {
  company_name: string | null;
  company_description: string | null;
  products: string[];
  services: string[];
  target_audience: string[];
  tone_of_voice: string[];
  writing_style: string[];
  important_facts: string[];
  locations: string[];
  source_urls: string[];
  missing_information: string[];
} | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const nullable = (item: unknown) => item === null || typeof item === "string";
  const fields = ["products", "services", "target_audience", "tone_of_voice",
    "writing_style", "important_facts", "locations", "source_urls", "missing_information"];
  if (!nullable(input.company_name) || !nullable(input.company_description) ||
      fields.some((field) => !isStringArray(input[field]))) return null;
  if ((input.source_urls as string[]).some((url) => {
    try { new URL(url); return false; } catch { return true; }
  })) return null;
  return input as never;
}

function parseClaudeJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const json = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(json);
}

function isSubset(values: string[], allowed: string[]): boolean {
  const allowedValues = new Set(allowed.map((value) => value.trim()));
  return values.every((value) => allowedValues.has(value.trim()));
}

export async function generateSafePartnerProfileDraft(
  companyName: string,
  websiteUrl: string,
  existingProfile: PartnerProfileContent,
  runner: ClaudeRunner = defaultClaudeRunner,
  timeoutMs = 30_000,
): Promise<PartnerProfileContent> {
  const raw = await runner(
    makeSafePartnerProfileDraftPrompt(companyName, websiteUrl, existingProfile),
    timeoutMs,
  );
  let decoded: unknown;
  try {
    decoded = parseClaudeJson(raw);
  } catch {
    throw new Error("invalid_claude_json");
  }
  const parsed = parseClaudeContent(decoded);
  if (!parsed) throw new Error("invalid_claude_json");

  const allowedCompanyNames = [companyName, existingProfile.companyName]
    .filter((value): value is string => Boolean(value?.trim()));
  if (
    parsed.company_name !== null &&
    !allowedCompanyNames.includes(parsed.company_name)
  ) {
    throw new Error("invented_profile_fact");
  }
  if (
    parsed.company_description !== null &&
    parsed.company_description !== existingProfile.companyDescription
  ) {
    throw new Error("invented_profile_fact");
  }
  const factualLists = [
    ["products", existingProfile.products],
    ["services", existingProfile.services],
    ["target_audience", existingProfile.targetAudience],
    ["tone_of_voice", existingProfile.toneOfVoice],
    ["writing_style", existingProfile.writingStyle],
    ["important_facts", existingProfile.importantFacts],
    ["locations", existingProfile.locations],
  ] as const;
  if (factualLists.some(([key, allowed]) => !isSubset(parsed[key], allowed))) {
    throw new Error("invented_profile_fact");
  }
  const allowedUrls = new Set([websiteUrl, ...existingProfile.sourceUrls]);
  if (parsed.source_urls.some((url) => !allowedUrls.has(url))) {
    throw new Error("invented_source_url");
  }

  return {
    companyName: parsed.company_name ?? companyName,
    companyDescription: parsed.company_description,
    products: parsed.products,
    services: parsed.services,
    targetAudience: parsed.target_audience,
    toneOfVoice: parsed.tone_of_voice,
    writingStyle: parsed.writing_style,
    importantFacts: parsed.important_facts,
    locations: parsed.locations,
    sourceUrls: parsed.source_urls.length ? parsed.source_urls : [websiteUrl],
    missingInformation: parsed.missing_information,
  };
}

export async function generatePartnerProfile(
  pages: Array<{ url: string; title: string; text: string }>,
  runner: ClaudeRunner = defaultClaudeRunner,
  timeoutMs = 30_000,
): Promise<PartnerProfileContent> {
  const raw = await runner(makePartnerProfilePrompt(pages), timeoutMs);
  let decoded: unknown;
  try {
    decoded = parseClaudeJson(raw);
  } catch {
    throw new Error("invalid_claude_json");
  }
  const parsed = parseClaudeContent(decoded);
  if (!parsed) throw new Error("invalid_claude_json");
  const allowedUrls = new Set(pages.map((page) => page.url));
  if (parsed.source_urls.some((url) => !allowedUrls.has(url))) {
    throw new Error("invented_source_url");
  }
  return {
    companyName: parsed.company_name,
    companyDescription: parsed.company_description,
    products: parsed.products,
    services: parsed.services,
    targetAudience: parsed.target_audience,
    toneOfVoice: parsed.tone_of_voice,
    writingStyle: parsed.writing_style,
    importantFacts: parsed.important_facts,
    locations: parsed.locations,
    sourceUrls: parsed.source_urls,
    missingInformation: parsed.missing_information,
  };
}