import assert from "node:assert/strict";
import test from "node:test";
import {
  articleGenerationErrorMessage,
  detectPartnerHabits,
  articleGenerationPrerequisiteError,
  generateArticle,
  makeArticleGenerationPrompt,
  styleSampleFrom,
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
  assert.equal(calls, 3); // draft, repair, editor pass
  assert.equal(article.title, valid.title);
});

test("editor pass result is used, and a broken editor answer keeps the draft", async () => {
  let calls = 0;
  const edited = await generateArticle(input, async () => (++calls === 1 ? JSON.stringify(valid) : JSON.stringify({ ...valid, title: valid.title + " (bewerkt)" })));
  assert.match(edited.title, /bewerkt/);
  calls = 0;
  const kept = await generateArticle(input, async () => (++calls === 1 ? JSON.stringify(valid) : "kapot"));
  assert.equal(kept.title, valid.title);
});

test("prompt has no forced conclusion and includes Search Console data", () => {
  const prompt = makeArticleGenerationPrompt({ ...input, searchConsole: { relatedQueries: [{ query: "tuin aanleggen kosten", clicks: 12, impressions: 300, position: 7.2 }], pages: [{ url: "https://voorbeeld.nl/tuinontwerp", clicks: 40 }], existingPageForKeyword: null } });
  assert.match(prompt, /GEEN afsluitende kop/);
  assert.match(prompt, /tuin aanleggen kosten/);
  assert.match(prompt, /voorbeeld\.nl\/tuinontwerp/);
  assert.match(prompt, /SCHRIJFREGELS VAN DEZE PARTNER/);
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

test("builds the full text from the sections when it is missing", async () => {
  const article = await generateArticle(input, async () => JSON.stringify({ ...valid, full_article: "" }));
  assert.ok(article.fullArticle.length > 0);
});

test("drops invented secondary keywords and questions instead of failing", async () => {
  const a = await generateArticle(input, async () => JSON.stringify({ ...valid, secondary_keywords_used: ["verzonnen"] }));
  assert.deepEqual(a.secondaryKeywordsUsed, []);
  const b = await generateArticle(input, async () => JSON.stringify({ ...valid, questions_answered: ["Verzonnen vraag?"] }));
  assert.deepEqual(b.questionsAnswered, []);
});

test("accepts JSON inside markdown fences and with extra fields", async () => {
  const article = await generateArticle(input, async () => "Hier is het artikel:\n```json\n" + JSON.stringify({ ...valid, extra: 1 }) + "\n```");
  assert.ok(article.title);
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

test("v2 prompt asks for a direct answer, an In het kort block and a FAQ, and passes a style sample", () => {
  const prompt = makeArticleGenerationPrompt({ ...input, styleSample: "Wij helpen je graag met je tuin. Bel ons gerust voor een afspraak bij jou thuis." });
  assert.match(prompt, /article_generation_v3/);
  assert.match(prompt, /direct antwoord/);
  assert.match(prompt, /In het kort/);
  assert.match(prompt, /GEEN vragenblok/); // unknown habits: no FAQ block
  assert.match(prompt, /Bel ons gerust/);
  assert.match(prompt, /geen feiten uit die niet in het goedgekeurde profiel staan/);
  assert.doesNotMatch(makeArticleGenerationPrompt(input), /Voorbeeldtekst van de eigen website/);
});

test("style sample takes whole sentences from the website text and skips menus", () => {
  const text = [
    "Home Over ons Contact",
    "Bij Groen & Co ontwerpen we tuinen die het hele jaar mooi blijven en weinig onderhoud vragen van jou.",
    "Menu",
    "Onze hoveniers werken met inheemse planten, zodat vlinders en bijen zich direct thuis voelen in jouw tuin.",
    "We komen altijd eerst kijken, luisteren naar je wensen en maken daarna een ontwerp dat bij jouw huis past.",
  ].join("\n");
  const sample = styleSampleFrom(text, 1500);
  assert.ok(sample);
  assert.ok(!sample!.includes("Over ons Contact"));
  assert.ok(sample!.includes("inheemse planten"));
  assert.equal(styleSampleFrom("Te kort."), null);
  assert.equal(styleSampleFrom(null), null);
});

test("summary block only when the partner uses one itself", () => {
  assert.deepEqual(detectPartnerHabits(["Welkom bij ons\nIn het kort:\nWe leveren snel."], []).summary, { used: true, label: "In het kort" });
  const h = detectPartnerHabits([""], ["Veelgestelde vragen over e-bikes", "Tot slot"]);
  assert.deepEqual(h.faq, { used: true, label: "Veelgestelde vragen" });
  assert.deepEqual(h.closing, { used: true, label: "Tot slot" });
  assert.equal(detectPartnerHabits([""], ["Onze fietsen"]).faq.used, false);
  assert.deepEqual(detectPartnerHabits([""], ["Samenvatting"]).summary, { used: true, label: "Samenvatting" });
  assert.equal(detectPartnerHabits(["We leggen het in het kort uit in deze lange zin over fietsen en meer dingen die erbij horen."], ["Prijzen"]).summary.used, false);
  const without = makeArticleGenerationPrompt({ ...input, partnerHabits: { summary: { used: false, label: null }, faq: { used: false, label: null }, closing: { used: false, label: null } } });
  assert.match(without, /GEEN samenvattingsblok/);
  assert.match(without, /GEEN vragenblok/);
  assert.match(without, /GEEN afsluitende kop/);
  const withIt = makeArticleGenerationPrompt({ ...input, partnerHabits: { summary: { used: true, label: "Samenvatting" }, faq: { used: true, label: "FAQ" }, closing: { used: false, label: null } } });
  assert.match(withIt, /## FAQ/);
  assert.match(withIt, /> \*\*Samenvatting\*\*/);
});
