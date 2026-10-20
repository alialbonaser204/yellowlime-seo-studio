import assert from "node:assert/strict";
import test from "node:test";
import { collectWebsite } from "./websiteCollection";
import { extractHtmlPage } from "./htmlExtraction";
import {
  claudeErrorMessage,
  generatePartnerProfile,
  generateSafePartnerProfileDraft,
  makeSafePartnerProfileDraftPrompt,
} from "./claudePartnerProfile";
import { fetchRobots } from "./safeHttp";
import { fetchSafe } from "./safeHttp";
import { registrableDomain, validateWebsiteUrl } from "./websiteUrlPolicy";

const resolver = async () => [{ address: "93.184.216.34", family: 4 as const }];

test("collects at most five prioritized HTML pages and strips boilerplate", async () => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.endsWith("/robots.txt")) return { url, status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *\nAllow: /" };
    const pathname = new URL(url).pathname;
    const links = ["/contact", "/about", "/services", "/products", "/extra", "/six"]
      .map((href) => `<a href="${href}">${href}</a>`).join("");
    return {
      url,
      status: 200,
      headers: { "content-type": "text/html" },
      body: `<html><title>${pathname}</title><nav>Menu cookie</nav><main><p>Useful ${pathname} text.</p>${pathname === "/" ? links : ""}</main><footer>Footer</footer></html>`,
    };
  };
  const result = await collectWebsite("https://example.com", { resolver, fetcher });
  assert.equal(result.pages.length, 5);
  assert.ok(result.pages[0].text.includes("Useful"));
  assert.ok(!result.pages[0].text.includes("Footer"));
  assert.ok(calls.includes("https://example.com/robots.txt"));
});

test("rejects empty text and removes duplicate boilerplate lines", () => {
  const page = extractHtmlPage("https://example.com", "<header>x</header><main><p>One line</p><p>One line</p></main>");
  assert.equal(page.text, "One line");
});

test("validates Claude JSON and source URLs", async () => {
  const pages = [{ url: "https://example.com", title: "Home", text: "Acme" }];
  const valid = JSON.stringify({
    company_name: "Acme", company_description: null, products: [], services: [],
    target_audience: [], tone_of_voice: [], writing_style: [], important_facts: [],
    locations: [], source_urls: ["https://example.com"], missing_information: [],
  });
  const profile = await generatePartnerProfile(pages, async () => valid);
  assert.equal(profile.companyName, "Acme");
  await assert.rejects(() => generatePartnerProfile(pages, async () => "not json"), /invalid_claude_json/);
  await assert.rejects(() => generatePartnerProfile(pages, async () => valid.replace("https://example.com", "https://evil.test")), /invented_source_url/);
});

test("generates a safe draft without inventing missing company facts", async () => {
  const existing = {
    companyName: "Atlas Fietsen",
    companyDescription: null,
    products: [],
    services: [],
    targetAudience: [],
    toneOfVoice: [],
    writingStyle: [],
    importantFacts: [],
    locations: [],
    sourceUrls: ["https://atlas-fietsen.nl/"],
    missingInformation: [],
  };
  const safeOutput = JSON.stringify({
    company_name: "Atlas Fietsen",
    company_description: null,
    products: [],
    services: [],
    target_audience: [],
    tone_of_voice: [],
    writing_style: [],
    important_facts: [],
    locations: [],
    source_urls: ["https://atlas-fietsen.nl/"],
    missing_information: ["Bedrijfsomschrijving", "Producten en diensten"],
  });
  const prompt = makeSafePartnerProfileDraftPrompt(
    "Atlas Fietsen",
    "https://atlas-fietsen.nl/",
    existing,
  );
  assert.match(prompt, /website URL is an identifier only/i);
  const draft = await generateSafePartnerProfileDraft(
    "Atlas Fietsen",
    "https://atlas-fietsen.nl/",
    existing,
    async () => safeOutput,
  );
  assert.equal(draft.companyName, "Atlas Fietsen");
  assert.deepEqual(draft.products, []);
  const fencedDraft = await generateSafePartnerProfileDraft(
    "Atlas Fietsen",
    "https://atlas-fietsen.nl/",
    existing,
    async () => `\`\`\`json\n${safeOutput}\n\`\`\``,
  );
  assert.equal(fencedDraft.companyName, "Atlas Fietsen");
  await assert.rejects(
    () => generateSafePartnerProfileDraft(
      "Atlas Fietsen",
      "https://atlas-fietsen.nl/",
      existing,
      async () => safeOutput.replace('"products":[]', '"products":["Stadsfietsen"]'),
    ),
    /invented_profile_fact/,
  );
});

test("uses the public suffix list at registrable-domain boundaries", async () => {
  assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
  assert.notEqual(registrableDomain("example.co.uk"), registrableDomain("example.com"));
  await assert.rejects(
    () => validateWebsiteUrl("https://example.invalid", resolver),
    /publieke domeinextensie/,
  );
});

test("robots-parser honors disallow, allows 404, and fails closed when unavailable", async () => {
  const origin = new URL("https://example.com");
  const disallowed = await fetchRobots(origin, {
    fetcher: async (url) => ({
      url, status: 200, headers: { "content-type": "text/plain" },
      body: "User-agent: *\nDisallow: /private",
    }),
  });
  assert.equal(disallowed.allowed("https://example.com/private/a"), false);
  assert.equal(disallowed.allowed("https://example.com/about"), true);
  const missing = await fetchRobots(origin, {
    fetcher: async (url) => ({ url, status: 404, headers: {}, body: "" }),
  });
  assert.equal(missing.allowed("https://example.com/private"), true);
  const unavailable = await fetchRobots(origin, {
    fetcher: async () => { throw new Error("timeout"); },
  });
  assert.equal(unavailable.unavailable, true);
  assert.equal(unavailable.allowed("https://example.com/about"), false);
  // RFC 9309: a firewall answering 403 on robots.txt means "no rules", a 5xx means "stay away".
  const forbidden = await fetchRobots(origin, { fetcher: async (url) => ({ url, status: 403, headers: {}, body: "" }) });
  assert.equal(forbidden.unavailable, false);
  assert.equal(forbidden.allowed("https://example.com/about"), true);
  const serverError = await fetchRobots(origin, { fetcher: async (url) => ({ url, status: 503, headers: {}, body: "" }) });
  assert.equal(serverError.unavailable, true);
  assert.equal(serverError.reason, "http_503");
  // Rules for our bot are matched on its product token.
  const ownRules = await fetchRobots(origin, {
    fetcher: async (url) => ({ url, status: 200, headers: {}, body: "User-agent: LimeyBot\nDisallow: /" }),
  });
  assert.equal(ownRules.allowed("https://example.com/about"), false);
});

test("maps Claude worker failures to safe Dutch messages", () => {
  assert.equal(claudeErrorMessage(new Error("invalid_key")), "De AI-sleutel is ongeldig.");
  assert.equal(claudeErrorMessage(new Error("claude_timeout")), "De AI-analyse duurde te lang.");
});

test("never fetches external-domain links", async () => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.endsWith("/robots.txt")) {
      return { url, status: 404, headers: {}, body: "" };
    }
    return {
      url, status: 200, headers: { "content-type": "text/html" },
      body: '<main>Company text <a href="https://evil.net/secret">external</a><a href="/about">about</a></main>',
    };
  };
  await collectWebsite("https://example.com", { resolver, fetcher });
  assert.ok(calls.includes("https://example.com/"));
  assert.ok(calls.includes("https://example.com/about"));
  assert.ok(!calls.some((url) => url.startsWith("https://evil.net/")));
});

test("blocks cross-domain redirects in fetchSafe without making the second request", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () => fetchSafe("https://example.com", {
      resolver,
      transport: async (url) => {
        calls.push(url.toString());
        return {
          url: url.toString(), status: 302,
          headers: { location: "https://evil.net/redirected" },
          body: "",
        };
      },
    }),
    /ander domein/,
  );
  assert.deepEqual(calls, ["https://example.com/"]);
});

test("blocks private IPv4, IPv6, and mixed private DNS answers", async () => {
  await assert.rejects(() => validateWebsiteUrl("http://127.0.0.1", resolver), /niet toegestaan/);
  await assert.rejects(() => validateWebsiteUrl("http://[::1]", resolver), /niet toegestaan/);
  await assert.rejects(
    () => validateWebsiteUrl("https://public.example.com", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "fd00::1", family: 6 },
    ]),
    /niet-publiek/,
  );
});

test("fails safely for wrong content type, oversized body, and empty cleaned content", async () => {
  const wrongType = async (url: string) => url.endsWith("/robots.txt")
    ? { url, status: 404, headers: {}, body: "" }
    : { url, status: 200, headers: { "content-type": "application/pdf" }, body: "not html" };
  await assert.rejects(() => collectWebsite("https://example.com", { resolver, fetcher: wrongType }), /geen publieke HTML/);

  await assert.rejects(
    () => fetchSafe("https://example.com", {
      resolver,
      maxBytes: 10,
      transport: async (url) => ({
        url: url.toString(), status: 200, headers: { "content-type": "text/html" }, body: "01234567890",
      }),
    }),
    /te groot/,
  );

  const empty = async (url: string) => url.endsWith("/robots.txt")
    ? { url, status: 404, headers: {}, body: "" }
    : { url, status: 200, headers: { "content-type": "text/html" }, body: "<nav>only menu</nav><footer>only footer</footer>" };
  await assert.rejects(() => collectWebsite("https://example.com", { resolver, fetcher: empty }), /geen leesbare tekst/);
});
test("DNS lookup works with Node's all-addresses mode and prefers IPv4", async () => {
  const { safeLookup } = await import("./safeHttp");
  const http = await import("node:http");
  const resolver2 = async () => [
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const },
    { address: "93.184.216.34", family: 4 as const },
  ];
  const lookup = safeLookup(resolver2);
  const all = await new Promise<unknown>((resolve) => lookup("example.com", { all: true }, (_e, a) => resolve(a)));
  assert.deepEqual((all as Array<{ family: number }>).map((a) => a.family), [4, 6]);
  const single = await new Promise<unknown[]>((resolve) => lookup("example.com", 0, (_e, a, f) => resolve([a, f])));
  assert.deepEqual(single, ["93.184.216.34", 4]);

  // A real request through Node's HTTP client with this lookup (the public
  // address is swapped for the local test server, keeping the answer's shape).
  const server = http.createServer((_q, s) => s.end("ok")).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const body = await new Promise<string>((resolve, reject) => {
    const req = http.request({
      hostname: "example.com", port, path: "/",
      lookup: (h: string, o: never, cb: (e: Error | null, a: unknown, f?: number) => void) =>
        lookup(h, o, (e, a, f) => cb(e, Array.isArray(a) ? a.map((x) => ({ ...x, address: "127.0.0.1", family: 4 })) : "127.0.0.1", f && 4)),
    } as never, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve(b)); });
    req.on("error", reject); req.end();
  });
  server.close();
  assert.equal(body, "ok");
});
