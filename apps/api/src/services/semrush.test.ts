import assert from "node:assert/strict";
import test from "node:test";
import {
  createDirectSemrushTransport,
  normalizeSemrushApiKey,
  parseSemrushCsv,
  runSemrushResearch,
  selectMainKeyword,
  SemrushServiceError,
  type SemrushTransport,
} from "./semrush";

const response = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain" } });

test("normalizes common secure-secret input formats", () => {
  assert.equal(normalizeSemrushApiKey(" key=test-secret "), "test-secret");
  assert.equal(normalizeSemrushApiKey('"test-secret"'), "test-secret");
  assert.equal(
    normalizeSemrushApiKey("https://api.semrush.com/?key=test-secret"),
    "test-secret",
  );
  assert.equal(normalizeSemrushApiKey("test-\u200Bsecret\n"), "test-secret");
});

test("adds the server-side secret to a direct Semrush request", async () => {
  let requestedUrl = "";
  const transport = createDirectSemrushTransport(
    " test-secret ",
    async (input) => {
      requestedUrl = input.toString();
      return response("Ph;Nq\nseo;100");
    },
  );
  await transport("/?type=phrase_this&phrase=seo&database=nl");
  const parsedUrl = new URL(requestedUrl);
  assert.equal(parsedUrl.origin, "https://api.semrush.com");
  assert.equal(parsedUrl.searchParams.get("key"), "test-secret");
  assert.equal(parsedUrl.searchParams.get("type"), "phrase_this");
  assert.equal(parsedUrl.searchParams.get("database"), "nl");
});

test("parses quoted semicolon CSV and escaped quotes", () => {
  assert.deepEqual(parseSemrushCsv(
    'Ph;Nq;In\r\n"seo; content";10;"I ""informational"""\r\n',
  ), [["Ph", "Nq", "In"], ["seo; content", "10", 'I "informational"']]);
});

test("runs overview, broad, questions and organic reports", async () => {
  const transport: SemrushTransport = async (path) => {
    const type = new URL(`http://localhost${path}`).searchParams.get("type");
    if (type === "phrase_this") return response("Ph;Nq;Kd;In;Td\nseo content;100;30;I;up");
    if (type === "phrase_fullsearch") return response("Ph;Nq;Kd;In;Td\nseo content;100;30;I;up\ncontent marketing;40;20;C;flat");
    if (type === "phrase_questions") return response("Ph;Nq;Kd;In\nhoe werkt seo;20;10;I");
    return response("Po;Dn;Ur\n1;example.nl;https://example.nl/seo");
  };
  const result = await runSemrushResearch(
    { originalSubject: "seo content", contentGoal: "uitleg geven" },
    transport,
  );
  assert.equal(result.selectedMainKeyword, "seo content");
  assert.equal(result.searchVolume, 100);
  assert.equal(result.secondaryKeywords[0]?.keyword, "content marketing");
  assert.equal(result.relevantQuestions[0]?.question, "hoe werkt seo");
  assert.equal(result.organicCompetitors[0]?.domain, "example.nl");
});

test("treats empty responses as an empty result", async () => {
  const transport: SemrushTransport = async () => response("");
  const result = await runSemrushResearch(
    { originalSubject: "onbekend onderwerp", contentGoal: "uitleg" },
    transport,
  );
  assert.equal(result.selectedMainKeyword, "onbekend onderwerp");
  assert.equal(result.message, "Er is geen geschikt alternatief zoekwoord gevonden.");
  assert.deepEqual(result.secondaryKeywords, []);
});

test("maps invalid key and insufficient units errors", async () => {
  for (const [code, expected] of [
    ["120", "invalid_key"],
    ["131", "insufficient_units"],
  ] as const) {
    const transport: SemrushTransport = async () => response(`ERROR ${code} :: failed`);
    await assert.rejects(
      runSemrushResearch({ originalSubject: "seo", contentGoal: "uitleg" }, transport),
      (error: unknown) => error instanceof SemrushServiceError && error.code === expected,
    );
  }
});

test("maps connector timeout", async () => {
  const transport: SemrushTransport = async () =>
    new Promise<Response>(() => undefined);
  await assert.rejects(
    runSemrushResearch({ originalSubject: "seo", contentGoal: "uitleg" }, transport, 5),
    (error: unknown) => error instanceof SemrushServiceError && error.code === "timeout",
  );
});

test("chooses the most relevant broad keyword before volume", () => {
  const selection = selectMainKeyword(
    "duurzame tuin",
    "advies voor een groene tuin",
    [{ keyword: "duurzame tuin", searchVolume: 0, keywordDifficulty: null, searchIntent: null, trend: null }],
    [
      { keyword: "advies", searchVolume: 30, keywordDifficulty: null, searchIntent: null, trend: null },
      { keyword: "duurzame tuin ideeën", searchVolume: 20, keywordDifficulty: null, searchIntent: null, trend: null },
    ],
  );
  assert.equal(selection.selected.keyword, "duurzame tuin ideeën");
});
