import assert from "node:assert/strict";
import test from "node:test";
import { generateOutline, makeOutlinePrompt, outlineInstructions, validateOutline, type OutlineInput } from "./articleOutline";
import { makeArticleGenerationPrompt } from "./articleGeneration";

const input: OutlineInput = {
  partnerName: "Tuinmakers",
  approvedPartnerProfile: { products: ["regentonnen"] },
  subject: "Duurzame tuin",
  contentGoal: "Praktische inspiratie",
  semrushResearch: {
    selectedMainKeyword: "duurzame tuin ideeën",
    secondaryKeywords: [{ keyword: "groene tuin" }],
    relevantQuestions: [{ question: "Hoe maak ik een duurzame tuin?" }],
  },
};

const proposal = {
  title: "Duurzame tuin ideeën: zo maak je je tuin groener",
  sections: [
    { heading: "Waarom een duurzame tuin?", level: "H2", type: "uitleg", words: 200, angle: "Voordelen", keywords: ["groene tuin", "verzonnen zoekwoord"], questions: ["Hoe maak ik een duurzame tuin?"] },
    { heading: "Regenwater opvangen", level: "H3", type: "stappenplan", words: 5000, angle: "Met regentonnen", keywords: [], questions: [] },
    { heading: "Planten kiezen", level: "H2", type: "onbekend", words: "x", angle: "", keywords: [], questions: [] },
  ],
};

test("the outline prompt keeps the fixed parts out and limits keywords to the research", () => {
  const prompt = makeOutlinePrompt(input);
  assert.match(prompt, /article_outline_v1/);
  assert.match(prompt, /Hoofdzoekwoord: duurzame tuin ideeën/);
  assert.match(prompt, /zet ze niet in de opzet/);
  assert.match(prompt, /"groene tuin"/);
});

test("Claude's outline is cleaned: invented keywords dropped, numbers and types made safe", async () => {
  const outline = await generateOutline(input, async () => "```json\n" + JSON.stringify(proposal) + "\n```");
  assert.deepEqual(outline.sections[0].keywords, ["groene tuin"]);
  assert.deepEqual(outline.sections[0].questions, ["Hoe maak ik een duurzame tuin?"]);
  assert.equal(outline.sections[1].words, 800, "capped");
  assert.equal(outline.sections[2].type, "uitleg", "unknown type falls back");
  assert.equal(outline.sections[2].words, 200, "invalid number falls back");
});

test("an outline without a title or sections is refused, and a broken answer is retried once", async () => {
  assert.throws(() => validateOutline({ title: "", sections: [] }), /invalid_outline/);
  assert.throws(() => validateOutline({ title: "x", sections: [] }), /invalid_outline/);
  let calls = 0;
  const outline = await generateOutline(input, async () => (++calls === 1 ? "geen json" : JSON.stringify(proposal)));
  assert.equal(calls, 2);
  assert.equal(outline.sections.length, 3);
});

test("the approved outline becomes binding instructions in the article prompt", () => {
  const outline = validateOutline(proposal);
  const text = outlineInstructions(outline);
  assert.match(text, /1\. ## Waarom een duurzame tuin\? \(uitleg, ongeveer 200 woorden\)/);
  assert.match(text, /2\. ### Regenwater opvangen/);
  const prompt = makeArticleGenerationPrompt({ ...input, yellowlimerName: "Ali", outline });
  assert.match(prompt, /Goedgekeurde opzet \(bindend/);
  assert.doesNotMatch(makeArticleGenerationPrompt({ ...input, yellowlimerName: "Ali" }), /Goedgekeurde opzet/);
});
