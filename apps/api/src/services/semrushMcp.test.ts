import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { runSemrushResearch, SemrushServiceError } from "./semrush";
import { mcpRequestFromPath, responseFromMcpError, SemrushMcpClient } from "./semrushMcp";

// Responses below were recorded from the Semrush MCP server (database "nl").
const RECORDED: Record<string, string> = {
  phrase_this:
    "Keyword;Search Volume;Keyword Difficulty Index;Intent;Trends\ngeld besparen;1000;34;1;0.41,0.41,0.54\n",
  phrase_fullsearch:
    "Keyword;Search Volume;Keyword Difficulty Index;Intent;Trends\ngeld besparen met a+++ afzuigkap;1300;13;1;0.52,1.00\ngeld besparen;1000;34;1;0.41,0.41\n",
  phrase_questions:
    "Keyword;Search Volume;Keyword Difficulty Index;Intent\nhoe geld besparen;260;30;1\nhoe bespaar je geld;140;29;1\n",
  phrase_organic:
    "Position;Domain;Url\n1;www.nibud.nl;https://www.nibud.nl/onderwerpen/uitgaven/geld-besparen/\n2;porterenee.nl;https://porterenee.nl/33-x-snel-en-makkelijk-geld-besparen/\n",
};

interface FakeServer {
  url: string;
  calls: Array<{ report: string; params: Record<string, unknown>; auth: string | undefined }>;
  server: Server;
}

type Behaviour = (report: string, params: Record<string, unknown>) =>
  | { data: string }
  | { error: Record<string, unknown> };

async function startFakeSemrush(
  behaviour: Behaviour,
  validKey = "test-key",
): Promise<FakeServer> {
  const calls: FakeServer["calls"] = [];
  const server = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    if (auth !== `Apikey ${validKey}`) {
      res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;

    const mcp = new McpServer({ name: "fake-semrush", version: "1.0.0" });
    mcp.registerTool(
      "execute_report",
      { inputSchema: { report: z.string(), params: z.record(z.unknown()) } },
      async ({ report, params }) => {
        calls.push({ report, params, auth });
        const outcome = behaviour(report, params);
        if ("error" in outcome) {
          return { isError: true, content: [{ type: "text", text: JSON.stringify(outcome.error) }] };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ data: outcome.data, metadata: { format: "csv" } }) }],
        };
      },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp`, calls, server };
}

const recorded: Behaviour = (report) => ({ data: RECORDED[report] ?? "" });

test("translates classic API request paths to MCP report calls", () => {
  assert.deepEqual(
    mcpRequestFromPath(
      "/?type=phrase_fullsearch&phrase=geld+besparen&database=nl&export_columns=Ph%2CNq%2CKd%2CIn%2CTd&limit=10&sort=nq_desc",
    ),
    {
      report: "phrase_fullsearch",
      params: {
        phrase: "geld besparen",
        database: "nl",
        export_columns: ["keyword", "volume", "keyword_difficulty", "intent", "trend"],
        display_limit: 10,
        display_sort: "volume_desc",
      },
    },
  );
  assert.deepEqual(mcpRequestFromPath("/?type=phrase_organic&phrase=seo&database=nl&export_columns=Po,Dn,Ur&limit=5").params, {
    phrase: "seo",
    database: "nl",
    export_columns: ["position", "domain", "url"],
    display_limit: 5,
  });
});

test("maps MCP errors to the classic Semrush error format", async () => {
  assert.equal(await responseFromMcpError({ code: "no_api_units", message: "x" }).text(), "ERROR 132 :: API UNITS BALANCE IS ZERO");
  assert.equal(await responseFromMcpError({ code: "no_subscription" }).text(), "ERROR 130 :: API DISABLED");
  assert.equal(responseFromMcpError({ code: "rate_limit" }).status, 429);
  assert.equal(
    await responseFromMcpError({ code: "internal", message: "get phrase_this: ERROR 50 :: NOTHING FOUND\nNo data found" }).text(),
    "ERROR 50 :: NOTHING FOUND",
  );
});

test("runs the full research flow through the MCP server with the API key header", async (t) => {
  const fake = await startFakeSemrush(recorded);
  const client = new SemrushMcpClient({ apiKey: "test-key", url: fake.url });
  t.after(async () => {
    await client.close();
    fake.server.close();
  });

  const result = await runSemrushResearch(
    { originalSubject: "geld besparen", contentGoal: "bespaartips geven" },
    (path) => client.request(path),
  );

  assert.equal(result.selectedMainKeyword, "geld besparen");
  assert.equal(result.searchVolume, 1000);
  assert.equal(result.keywordDifficulty, 34);
  assert.equal(result.trend, "0.41,0.41,0.54");
  assert.deepEqual(result.secondaryKeywords.map((k) => k.keyword), ["geld besparen met a+++ afzuigkap"]);
  assert.deepEqual(result.relevantQuestions.map((q) => [q.question, q.searchVolume]), [
    ["hoe geld besparen", 260],
    ["hoe bespaar je geld", 140],
  ]);
  assert.deepEqual(result.organicCompetitors[0], {
    position: 1,
    domain: "www.nibud.nl",
    url: "https://www.nibud.nl/onderwerpen/uitgaven/geld-besparen/",
  });
  assert.deepEqual(fake.calls.map((c) => c.report).sort(), ["phrase_fullsearch", "phrase_organic", "phrase_questions", "phrase_this"]);
  assert.ok(fake.calls.every((c) => c.auth === "Apikey test-key"));
  const organic = fake.calls.find((c) => c.report === "phrase_organic");
  assert.deepEqual(organic?.params.export_columns, ["position", "domain", "url"]);
});

test("treats 'nothing found' as an empty report", async (t) => {
  const fake = await startFakeSemrush((report) =>
    report === "phrase_this"
      ? { error: { code: "internal", message: "get phrase_this: ERROR 50 :: NOTHING FOUND\nNo data found for this request." } }
      : recorded(report, {}),
  );
  const client = new SemrushMcpClient({ apiKey: "test-key", url: fake.url });
  t.after(async () => {
    await client.close();
    fake.server.close();
  });
  const result = await runSemrushResearch(
    { originalSubject: "geld besparen", contentGoal: "tips" },
    (path) => client.request(path),
  );
  // Falls back to the best broad match because the exact phrase had no data.
  assert.equal(result.selectedMainKeyword, "geld besparen met a+++ afzuigkap");
});

test("reports an empty unit balance as insufficient units", async (t) => {
  const fake = await startFakeSemrush(() => ({
    error: { code: "no_api_units", message: "Not enough API units", retryable: false },
  }));
  const client = new SemrushMcpClient({ apiKey: "test-key", url: fake.url });
  t.after(async () => {
    await client.close();
    fake.server.close();
  });
  await assert.rejects(
    runSemrushResearch({ originalSubject: "seo", contentGoal: "uitleg" }, (path) => client.request(path)),
    (error: unknown) => error instanceof SemrushServiceError && error.code === "insufficient_units",
  );
});

test("reports a rejected API key as an invalid key", async (t) => {
  const fake = await startFakeSemrush(recorded);
  const client = new SemrushMcpClient({ apiKey: "wrong-key", url: fake.url });
  t.after(async () => {
    await client.close();
    fake.server.close();
  });
  await assert.rejects(
    runSemrushResearch({ originalSubject: "seo", contentGoal: "uitleg" }, (path) => client.request(path)),
    (error: unknown) => error instanceof SemrushServiceError && error.code === "invalid_key",
  );
  assert.equal(fake.calls.length, 0);
});
