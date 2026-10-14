import type { WebsiteArticle } from "@yellowlime/db";

/**
 * Pure helpers for the topic check: word matching, the Claude prompt and
 * parsing Claude's answer. Kept free of database access so they can be tested
 * on their own.
 */

export const MAX_ARTICLES_FOR_CLAUDE = 150;
const STOP_WORDS = new Set([
  "de", "het", "een", "en", "of", "van", "voor", "met", "op", "in", "te", "naar", "is", "zijn", "je", "jij", "jouw",
  "u", "uw", "wat", "hoe", "welke", "waarom", "wanneer", "bij", "mij", "ik", "we", "wij", "die", "dat", "dit", "deze",
  "om", "aan", "als", "ook", "niet", "wel", "kan", "kun", "moet", "wordt", "worden", "alle", "meer", "zo", "tips",
  "the", "a", "an", "and", "for", "of", "to", "how", "what",
]);

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("en")) return token.slice(0, -2);
  if (token.length > 4 && (token.endsWith("s") || token.endsWith("e"))) return token.slice(0, -1);
  return token;
}

export function topicTokens(value: string): string[] {
  return value
    .toLocaleLowerCase("nl-NL")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

/** Word-overlap score between a topic and an article; used to pick candidates. */
export function lexicalScore(topic: string, article: Pick<WebsiteArticle, "title" | "headings" | "url" | "description">): number {
  const wanted = new Set(topicTokens(topic));
  if (wanted.size === 0) return 0;
  const count = (text: string) => topicTokens(text).filter((token) => wanted.has(token)).length;
  let slug = "";
  try {
    slug = new URL(article.url).pathname.replace(/[-_/]+/g, " ");
  } catch {
    slug = article.url;
  }
  return (
    3 * count(article.title) +
    2 * count(slug) +
    count(article.headings.join(" ")) +
    count(article.description ?? "")
  );
}

export function selectCandidates<T extends Pick<WebsiteArticle, "title" | "headings" | "url" | "description">>(topic: string, articles: T[], limit = MAX_ARTICLES_FOR_CLAUDE): T[] {
  if (articles.length <= limit) return articles;
  return articles
    .map((article, index) => ({ article, index, score: lexicalScore(topic, article) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.article);
}

export function makeTopicCheckPrompt(
  input: { companyName: string; subject: string; contentGoal?: string },
  articles: Array<Pick<WebsiteArticle, "title" | "headings" | "url">>,
): string {
  const list = articles
    .map((article, index) => {
      const headings = article.headings.slice(0, 8).join("; ");
      return `[${index + 1}] ${article.title}${headings ? ` | tussenkoppen: ${headings}` : ""} | ${article.url}`;
    })
    .join("\n");
  return [
    `Je helpt een redacteur van ${input.companyName} om geen artikel te schrijven over een onderwerp dat al op de website staat.`,
    "",
    `Voorgesteld onderwerp: ${input.subject}`,
    input.contentGoal ? `Doel van het artikel: ${input.contentGoal}` : "",
    "",
    "Gepubliceerde artikelen op de website:",
    list,
    "",
    "Beoordeel of het voorgestelde onderwerp al behandeld wordt.",
    "- duplicate: een bestaand artikel beantwoordt in de kern dezelfde vraag voor dezelfde lezer. Een nieuw artikel zou ermee concurreren in Google.",
    "- related: er is gedeeltelijke overlap, maar met een duidelijk andere invalshoek, doelgroep of diepgang is een nieuw artikel zinvol.",
    "- new: geen enkel artikel behandelt dit onderwerp wezenlijk.",
    "Let op synoniemen (bijvoorbeeld 'e-bike' en 'elektrische fiets') en op tussenkoppen: een onderwerp kan al als sectie in een ander artikel staan.",
    "",
    "Geef daarnaast precies 3 alternatieve invalshoeken die passen bij het voorgestelde onderwerp en de partner, maar die door geen enkel bestaand artikel worden behandeld. Formuleer ze als concrete artikelonderwerpen.",
    "",
    "Antwoord uitsluitend met geldige JSON, zonder uitleg eromheen, in dit formaat:",
    '{"verdict":"new|related|duplicate","explanation":"maximaal 2 korte zinnen in eenvoudig Nederlands","matches":[{"id":1,"relation":"duplicate|related","reason":"korte uitleg"}],"alternatives":["...","...","..."]}',
    "Gebruik bij matches alleen nummers uit de lijst, hooguit 5, de sterkste overlap eerst. Laat matches leeg als het onderwerp nieuw is.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export interface ClaudeJudgement {
  verdict: "new" | "related" | "duplicate";
  explanation: string;
  matches: Array<{ index: number; relation: "duplicate" | "related"; reason: string }>;
  alternatives: string[];
}

export function parseTopicJudgement(raw: string, articleCount: number): ClaudeJudgement {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("invalid_topic_json");
  const data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  const verdict = data.verdict;
  if (verdict !== "new" && verdict !== "related" && verdict !== "duplicate") throw new Error("invalid_topic_json");
  const explanation = typeof data.explanation === "string" ? data.explanation.trim().slice(0, 500) : "";
  const matches = (Array.isArray(data.matches) ? data.matches : [])
    .map((match) => match as Record<string, unknown>)
    .filter((match) =>
      Number.isInteger(match.id) && (match.id as number) >= 1 && (match.id as number) <= articleCount &&
      (match.relation === "duplicate" || match.relation === "related"))
    .slice(0, 5)
    .map((match) => ({
      index: (match.id as number) - 1,
      relation: match.relation as "duplicate" | "related",
      reason: typeof match.reason === "string" ? match.reason.trim().slice(0, 300) : "",
    }));
  const alternatives = (Array.isArray(data.alternatives) ? data.alternatives : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().slice(0, 200))
    .slice(0, 3);
  return { verdict, explanation, matches, alternatives };
}

/** How many distinct topic words appear in the article's title, slug or headings. */
export function distinctOverlap(topic: string, article: Pick<WebsiteArticle, "title" | "headings" | "url">): number {
  let slug = "";
  try {
    slug = new URL(article.url).pathname.replace(/[-_/]+/g, " ");
  } catch {
    slug = article.url;
  }
  const present = new Set(topicTokens(`${article.title} ${slug} ${article.headings.join(" ")}`));
  return new Set(topicTokens(topic).filter((token) => present.has(token))).size;
}
