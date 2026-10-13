import assert from "node:assert/strict";
import test from "node:test";
import {
  articleGenerationErrorMessage,
  articleGenerationPrerequisiteError,
  generateArticle,
  makeArticleGenerationPrompt,
  type ArticleGenerationInput,
} from "./articleGeneration";

const input: ArticleGenerationInput = {
  partnerName: "Tuinmakers",
  approvedPartnerProfile: {
    toneOfVoice: ["praktisch", "warm"],
    writingStyle: ["korte zinnen"],
    products: ["regentonnen"],
    importantFacts: ["Sinds 1998"],
  },
  subject: "Duurzame tuin",
  contentGoal: "Geef lezers praktische inspiratie",
  semrushResearch: {
    selectedMainKeyword: "duurzame tuin ideeën",
    searchVolume: 2400,
    keywordDifficulty: 31.5,
    searchIntent: "I",
    secondaryKeywords: [{ keyword: "groene tuin" }],
    relevantQuestions: [{ question: "Hoe maak ik een duurzame tuin?" }],
    organicCompetitors: [{ domain: "example.nl", url: "https://example.nl/tuin" }],
  },
  yellowlimerName: "Sam",
};

const valid = {
  title: "Duurzame tuin: praktische ideeën",
  introduction: "Met een paar slimme keuzes maak je jouw tuin duurzamer.",
  sections: [{ heading: "Begin met water besparen", heading_level: "H2", content: "Vang regenwater op." }],
  conclusion: "Zo groeit jouw tuin stap voor stap mee.",
  meta_title: "Duurzame tuin ideeën | Tuinmakers",
  meta_description: "Praktische duurzame tuin ideeën voor thuis.",
  primary_keyword: "duurzame tuin ideeën",
  secondary_keywords_used: ["groene tuin"],
  questions_answered: ["Hoe maak ik een duurzame tuin?"],
  full_article: "Duurzame tuin: praktische ideeën\n\nMet een paar slimme keuzes maak je jouw tuin duurzamer.",
};

test("validates and maps a strict article response", async () => {
  const article = await generateArticle(input, async () => JSON.stringify(valid));
  assert.equal(article.primaryKeyword, "duurzame tuin ideeën");
  assert.equal(article.sections[0]?.headingLevel, "H2");
  assert.equal(article.fullArticle.length > 0, true);
});

test("repairs invalid JSON exactly once", async () => {
  let calls = 0;
  const article = await generateArticle(input, async () => {
    calls += 1;
    return calls === 1 ? "not json" : JSON.stringify(valid);
  });
  assert.equal(calls, 2);
  assert.equal(article.title, valid.title);
});

test("fails after exactly two invalid Claude responses", async () => {
  let calls = 0;
  await assert.rejects(
    () => generateArticle(input, async () => {
      calls += 1;
      return "not json";
    }),
    /invalid_article_json/,
  );
  assert.equal(calls, 2);
});

test("rejects an empty article", async () => {
  await assert.rejects(
    () => generateArticle(input, async () => JSON.stringify({ ...valid, full_article: "" })),
    /empty_article/,
  );
});

test("rejects invented secondary keywords and questions", async () => {
  await assert.rejects(
    () => generateArticle(input, async () => JSON.stringify({ ...valid, secondary_keywords_used: ["verzonnen"] })),
    /invented_article_reference/,
  );
  await assert.rejects(
    () => generateArticle(input, async () => JSON.stringify({ ...valid, questions_answered: ["Verzonnen vraag?"] })),
    /invented_article_reference/,
  );
});

test("rejects a wrong primary keyword", async () => {
  await assert.rejects(
    () => generateArticle(input, async () => JSON.stringify({ ...valid, primary_keyword: "andere term" })),
    /wrong_primary_keyword/,
  );
});

test("prompt contains required inputs and does not mutate snapshots", () => {
  const before = JSON.stringify(input);
  const prompt = makeArticleGenerationPrompt(input);
  assert.match(prompt, /Tuinmakers/);
  assert.match(prompt, /praktische inspiratie/);
  assert.match(prompt, /duurzame tuin ideeën/);
  assert.match(prompt, /H2/);
  assert.match(prompt, /Concurrenten.*context/i);
  assert.match(prompt, /kopieer nooit/i);
  assert.match(prompt, /zonder keyword stuffing/i);
  assert.equal(JSON.stringify(input), before);
});

test("blocks generation without an approved partner profile", () => {
  assert.equal(
    articleGenerationPrerequisiteError({
      partnerExists: true,
      partnerProfileStatus: "Wacht op controle",
      approvedPartnerProfile: null,
      reviewerId: 1,
      reviewerActive: true,
      subject: "Onderwerp",
      contentGoal: "Doel",
    }),
    "Keur eerst het partnerprofiel goed.",
  );
});

test("allows generation without completed Semrush research", () => {
  assert.equal(
    articleGenerationPrerequisiteError({
      partnerExists: true,
      partnerProfileStatus: "Goedgekeurd",
      approvedPartnerProfile: { companyName: "Tuinmakers" },
      reviewerId: 1,
      reviewerActive: true,
      subject: "Onderwerp",
      contentGoal: "Doel",
    }),
    null,
  );
});

test("blocks generation without an active reviewer", () => {
  assert.equal(
    articleGenerationPrerequisiteError({
      partnerExists: true,
      partnerProfileStatus: "Goedgekeurd",
      approvedPartnerProfile: { companyName: "Tuinmakers" },
      reviewerId: null,
      reviewerActive: false,
      subject: "Onderwerp",
      contentGoal: "Doel",
    }),
    "Wijs eerst een actieve reviewer toe.",
  );
});

test("uses the briefing subject when Semrush research is unavailable", async () => {
  const fallbackInput: ArticleGenerationInput = {
    ...input,
    semrushResearch: {},
  };
  const article = await generateArticle(
    fallbackInput,
    async () => JSON.stringify({
      ...valid,
      primary_keyword: fallbackInput.subject,
      secondary_keywords_used: [],
      questions_answered: [],
    }),
  );
  assert.equal(article.primaryKeyword, fallbackInput.subject);
});

test("maps a Claude timeout without starting a repair request", async () => {
  let calls = 0;
  const timeout = new Error("claude_timeout");
  await assert.rejects(
    () =>
      generateArticle(input, async () => {
        calls += 1;
        throw timeout;
      }),
    /claude_timeout/,
  );
  assert.equal(calls, 1);
  assert.equal(
    articleGenerationErrorMessage(timeout),
    "De AI-generatie duurde te lang.",
  );
});