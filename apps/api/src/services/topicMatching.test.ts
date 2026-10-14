import assert from "node:assert/strict";
import test from "node:test";
import { distinctOverlap, lexicalScore, makeTopicCheckPrompt, parseTopicJudgement, selectCandidates, topicTokens } from "./topicMatching";

const article = (title: string, url: string, headings: string[] = []) => ({ title, url, headings, description: null });

test("tokenizes topics without stop words and with light stemming", () => {
  assert.deepEqual(topicTokens("Hoe kies je de juiste e-bikes?"), ["kies", "juist", "bike"]);
});

test("scores word overlap between a topic and an article", () => {
  const onderhoud = article("E-bike onderhoud: 7 tips", "https://a.nl/blog/e-bike-onderhoud", ["Ketting smeren"]);
  const verzekering = article("Fietsverzekering vergelijken", "https://a.nl/blog/fietsverzekering");
  assert.ok(lexicalScore("onderhoud van je e-bike", onderhoud) > lexicalScore("onderhoud van je e-bike", verzekering));
  assert.equal(lexicalScore("", onderhoud), 0);
});

test("keeps all articles when there are few, otherwise the most similar ones", () => {
  const list = Array.from({ length: 5 }, (_, i) => article(`Artikel ${i}`, `https://a.nl/blog/${i}`));
  assert.equal(selectCandidates("accu", list, 10).length, 5);
  const many = [...list, article("Accu vervangen", "https://a.nl/blog/accu")];
  assert.equal(selectCandidates("accu vervangen", many, 2)[0].title, "Accu vervangen");
});

test("numbers the articles in the prompt so Claude can only refer to real ones", () => {
  const prompt = makeTopicCheckPrompt(
    { companyName: "Atlas Fietsen", subject: "E-bike onderhoud", contentGoal: "uitleg" },
    [article("E-bike onderhoud: 7 tips", "https://a.nl/x", ["Ketting"])],
  );
  assert.match(prompt, /\[1\] E-bike onderhoud: 7 tips \| tussenkoppen: Ketting \| https:\/\/a\.nl\/x/);
  assert.match(prompt, /Voorgesteld onderwerp: E-bike onderhoud/);
});

test("parses Claude's judgement and drops invented article numbers", () => {
  const judgement = parseTopicJudgement(
    'Hier is het: {"verdict":"duplicate","explanation":"Bestaat al.","matches":[{"id":1,"relation":"duplicate","reason":"Zelfde vraag"},{"id":9,"relation":"related","reason":"bestaat niet"}],"alternatives":["Winteronderhoud","Kosten per jaar","Accu bewaren","Vierde"]}',
    2,
  );
  assert.equal(judgement.verdict, "duplicate");
  assert.deepEqual(judgement.matches, [{ index: 0, relation: "duplicate", reason: "Zelfde vraag" }]);
  assert.equal(judgement.alternatives.length, 3);
  assert.throws(() => parseTopicJudgement('{"verdict":"misschien"}', 1), /invalid_topic_json/);
  assert.throws(() => parseTopicJudgement("geen json", 1), /invalid_topic_json/);
});

test("counts distinct topic words so one common word is not enough", () => {
  const welke = article("Welke e-bike past bij mij?", "https://a.nl/blog/welke-e-bike-past-bij-mij");
  const onderhoud = article("E-bike onderhoud: 7 tips", "https://a.nl/blog/e-bike-onderhoud");
  assert.equal(distinctOverlap("Onderhoud van je e-bike", welke), 1);
  assert.equal(distinctOverlap("Onderhoud van je e-bike", onderhoud), 2);
});
