import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATABLE_FIELDS,
  generateProfileFields,
  makeProfileFieldsPrompt,
  parseGeneratedProfile,
  quoteAppears,
  textSignals,
  toProfileContent,
} from "./profileGeneration";
import { collectWebsite } from "./websiteCollection";

const pages = [
  {
    url: "https://atlas.nl/",
    title: "Atlas Fietsen – e-bikes in Amersfoort",
    text: "Welkom bij Atlas Fietsen! Wij helpen je graag aan een e-bike die past bij jouw dagelijkse rit. Kom langs in onze winkel in Amersfoort. Gratis proefrit en onderhoud aan huis.",
  },
  {
    url: "https://atlas.nl/blog/accu-onderhoud",
    title: "Zo gaat je accu langer mee",
    text: "Wil je langer plezier van je e-bike? Laad je accu nooit helemaal leeg. Bewaar hem in de winter binnen. Zo houd je de actieradius op peil.",
  },
];

test("counts simple style signals", () => {
  const s = textSignals(pages[0].text);
  assert.ok(s.jeJij >= 2);
  assert.equal(s.uUw, 0);
  assert.ok(s.exclamations >= 1);
  assert.ok(s.avgSentenceWords > 3);
});

test("the prompt asks for evidence, gives field guidance and style signals", () => {
  const prompt = makeProfileFieldsPrompt("Atlas Fietsen", "https://atlas.nl", ["toneOfVoice", "locations"], pages);
  assert.match(prompt, /LETTERLIJKE citaten/);
  assert.match(prompt, /toneOfVoice \(Tone of voice\) — INZICHT/);
  assert.match(prompt, /locations \(Locaties\) — FEIT/);
  assert.match(prompt, /je\/jij\/jouw \d+x/);
  assert.match(prompt, /BRON: https:\/\/atlas.nl\/blog\/accu-onderhoud \(blog\/artikel\)/);
  assert.doesNotMatch(prompt, /companyDescription \(/);
});

test("finds quotes even when punctuation or casing differs", () => {
  const text = "welkom bij atlas fietsen wij helpen je graag aan een e bike die past bij jouw dagelijkse rit";
  assert.ok(quoteAppears("Wij helpen je graag aan een e-bike", text));
  assert.ok(quoteAppears("…helpen je graag aan een e-bike, die past", text));
  assert.ok(!quoteAppears("Wij zijn de goedkoopste van Nederland", text));
});

test("keeps grounded answers, drops invented facts and unproven insights", () => {
  const raw = JSON.stringify({
    fields: {
      toneOfVoice: {
        items: ["Spreekt de lezer aan met je en jouw", "Enthousiast, met uitroeptekens"],
        evidence: [{ quote: "Wij helpen je graag aan een e-bike die past bij jouw dagelijkse rit", url: "https://atlas.nl/" }],
        confidence: "hoog",
        note: null,
      },
      locations: {
        items: ["Amersfoort", "Utrecht"],
        evidence: [{ quote: "onze winkel in Amersfoort", url: "https://atlas.nl/" }],
        confidence: "hoog",
      },
      targetAudience: {
        items: ["Studenten met een klein budget"],
        evidence: [{ quote: "Speciale studentenkorting op alle fietsen", url: "https://atlas.nl/" }],
        confidence: "middel",
      },
      services: {
        items: ["Gratis proefrit", "Onderhoud aan huis"],
        evidence: [{ quote: "Gratis proefrit en onderhoud aan huis", url: "https://atlas.nl/onbekend" }],
      },
    },
    missing_information: ["Openingstijden"],
  });
  const result = parseGeneratedProfile(raw, ["toneOfVoice", "locations", "targetAudience", "services", "companyDescription"], pages);
  const get = (f: string) => result.fields.find((x) => x.field === f)!;

  assert.deepEqual(get("toneOfVoice").items, ["Spreekt de lezer aan met je en jouw", "Enthousiast, met uitroeptekens"]);
  assert.equal(get("toneOfVoice").evidence.length, 1);

  assert.deepEqual(get("locations").items, ["Amersfoort"], "Utrecht is not on the website");
  assert.match(get("locations").note ?? "", /weggelaten/);

  // The quote does not exist on the website, so the insight is not grounded.
  assert.deepEqual(get("targetAudience").items, []);
  assert.equal(get("targetAudience").confidence, "laag");

  // Evidence pointing at an unknown URL is dropped, which leaves the field unproven.
  assert.deepEqual(get("services").items, []);

  assert.equal(get("companyDescription").text, null);
  assert.ok(result.missingInformation.includes("Openingstijden"));
  assert.ok(result.missingInformation.some((m) => m.startsWith("Bedrijfsomschrijving")));
  assert.deepEqual(result.sourceUrls, ["https://atlas.nl/"]);
});

test("rejects output that is not JSON", () => {
  assert.throws(() => parseGeneratedProfile("Sorry, dat kan ik niet.", ["products"], pages), /invalid_claude_json/);
});

test("generates all fields and converts them to the stored profile", async () => {
  let prompt = "";
  const runner = async (input: string) => {
    prompt = input;
    return "```json\n" + JSON.stringify({
      fields: {
        companyName: { text: "Atlas Fietsen", evidence: [{ quote: "Welkom bij Atlas Fietsen", url: "https://atlas.nl/" }], confidence: "hoog" },
        writingStyle: {
          items: ["Korte zinnen met praktische tips", "Begint artikelen met een vraag aan de lezer"],
          evidence: [{ quote: "Wil je langer plezier van je e-bike?", url: "https://atlas.nl/blog/accu-onderhoud" }],
          confidence: "middel",
        },
      },
      missing_information: [],
    }) + "\n```";
  };
  const result = await generateProfileFields({ companyName: "Atlas", websiteUrl: "https://atlas.nl", fields: GENERATABLE_FIELDS, pages }, runner);
  assert.equal(GENERATABLE_FIELDS.every((f) => prompt.includes(`- ${f} (`)), true);
  const profile = toProfileContent(result, "Atlas", "https://atlas.nl");
  assert.equal(profile.companyName, "Atlas Fietsen");
  assert.equal(profile.writingStyle.length, 2);
  assert.deepEqual(profile.products, []);
  assert.deepEqual(profile.sourceUrls.sort(), ["https://atlas.nl/", "https://atlas.nl/blog/accu-onderhoud"]);
});

test("collects extra pages and a couple of blog articles for the writing style", async () => {
  const resolver = async () => [{ address: "93.184.216.34", family: 4 as const }];
  const links = ["/over-ons", "/contact", "/assortiment", "/blog/a", "/blog/b", "/blog/c", "/x1", "/x2", "/x3", "/x4"];
  const fetcher = async (url: string) => {
    if (url.endsWith("/robots.txt")) return { url, status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *\nAllow: /" };
    const path = new URL(url).pathname;
    return {
      url,
      status: 200,
      headers: { "content-type": "text/html" },
      body: `<html><title>${path}</title><main><p>Tekst van ${path}.</p>${path === "/" ? links.map((l) => `<a href="${l}">x</a>`).join("") : ""}</main></html>`,
    };
  };
  const result = await collectWebsite("https://example.com", { resolver, fetcher, maxPages: 8, articlePages: 2 });
  const paths = result.pages.map((p) => new URL(p.url).pathname);
  assert.equal(paths.length, 8);
  assert.equal(paths.filter((p) => p.startsWith("/blog/")).length, 2);
  assert.ok(paths.includes("/over-ons") && paths.includes("/assortiment") && paths.includes("/contact"));
});
