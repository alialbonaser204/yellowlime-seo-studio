import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Semrush MCP transport.
 *
 * The rest of the Semrush service speaks the classic Semrush API format: it
 * builds a request path such as `/?type=phrase_this&phrase=seo&database=nl`
 * and expects a semicolon-separated CSV body (or an `ERROR nnn :: ...` line).
 * This module translates those requests to the Semrush MCP server's
 * `execute_report` tool and translates the answers back, so the parsing and
 * error handling in `semrush.ts` stay the same for both routes.
 *
 * Semrush MCP access (with an API-unit allowance) is included in the Semrush
 * One Starter / Pro+ and SEO Classic Pro / Guru plans; the classic API needs
 * the Business plan.
 */

export const DEFAULT_SEMRUSH_MCP_URL = "https://mcp.semrush.com/v2/mcp";

/** Classic API column codes → MCP `export_columns` names. */
const COLUMN_NAMES: Record<string, string> = {
  Ph: "keyword",
  Nq: "volume",
  Kd: "keyword_difficulty",
  In: "intent",
  Td: "trend",
  Cp: "cpc",
  Co: "competitive_density",
  Nr: "results",
  Po: "position",
  Dn: "domain",
  Ur: "url",
};

/** Classic API sort codes → MCP `display_sort` values. */
const SORT_NAMES: Record<string, string> = {
  nq_desc: "volume_desc",
  nq_asc: "volume_asc",
  kd_desc: "keyword_difficulty_desc",
  kd_asc: "keyword_difficulty_asc",
  cp_desc: "cpc_desc",
  cp_asc: "cpc_asc",
};

export interface McpReportRequest {
  report: string;
  params: Record<string, unknown>;
}

/** Translate a classic Semrush API request path into an `execute_report` call. */
export function mcpRequestFromPath(path: string): McpReportRequest {
  const query = new URL(path, "https://semrush.invalid").searchParams;
  const report = query.get("type");
  if (!report) throw new Error("Semrush request without report type");

  const params: Record<string, unknown> = {};
  const phrase = query.get("phrase");
  if (phrase !== null) params.phrase = phrase;
  const database = query.get("database");
  if (database !== null) params.database = database;

  const columns = query.get("export_columns");
  if (columns) {
    params.export_columns = columns
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean)
      .map((code) => COLUMN_NAMES[code] ?? code.toLowerCase());
  }

  const limit = query.get("limit") ?? query.get("display_limit");
  if (limit) params.display_limit = Number(limit);
  const offset = query.get("offset") ?? query.get("display_offset");
  if (offset) params.display_offset = Number(offset);

  const sort = query.get("sort") ?? query.get("display_sort");
  if (sort) params.display_sort = SORT_NAMES[sort] ?? sort;

  return { report, params };
}

interface McpErrorPayload {
  code?: string;
  message?: string;
}

const textResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** Translate an MCP error payload into the classic API's error format. */
export function responseFromMcpError(payload: McpErrorPayload): Response {
  const message = payload.message ?? "";
  const classic = message.match(/ERROR\s+(\d+)\s*::\s*([^\n]*)/i);
  if (classic) return textResponse(`ERROR ${classic[1]} :: ${classic[2]}`);

  switch (payload.code) {
    case "no_api_units":
      return textResponse("ERROR 132 :: API UNITS BALANCE IS ZERO");
    case "no_subscription":
      return textResponse("ERROR 130 :: API DISABLED");
    case "rate_limit":
      return textResponse("ERROR :: RATE LIMIT", 429);
    case "unauthorized":
    case "invalid_api_key":
    case "authentication_failed":
      return textResponse("ERROR 120 :: WRONG KEY - ID IS NOT FOUND");
    case "validation_failed":
      return textResponse(`ERROR 400 :: ${message}`);
    default:
      return textResponse("Semrush MCP error", 502);
  }
}

/** Turn an `execute_report` tool result into a classic API response. */
export function responseFromToolResult(result: {
  content?: unknown;
  isError?: boolean;
}): Response {
  const text = Array.isArray(result.content)
    ? result.content
        .filter((part): part is { type: "text"; text: string } =>
          typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text",
        )
        .map((part) => part.text)
        .join("")
    : "";

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = undefined;
  }

  if (result.isError) {
    return responseFromMcpError(
      payload && typeof payload === "object" ? (payload as McpErrorPayload) : { message: text },
    );
  }
  if (payload && typeof payload === "object" && typeof (payload as { data?: unknown }).data === "string") {
    return textResponse((payload as { data: string }).data);
  }
  if (payload && typeof payload === "object" && "code" in payload) {
    return responseFromMcpError(payload as McpErrorPayload);
  }
  return textResponse("Unexpected Semrush MCP response", 502);
}

export interface SemrushMcpOptions {
  apiKey: string;
  url?: string;
  timeoutMs?: number;
}

/**
 * Keeps one MCP session per API key/URL and calls `execute_report` on it.
 * A failed session is dropped and re-created once, because MCP sessions can
 * expire on the server side.
 */
export class SemrushMcpClient {
  private client: Promise<Client> | null = null;

  constructor(private readonly options: SemrushMcpOptions) {}

  private connect(): Promise<Client> {
    if (!this.client) {
      const transport = new StreamableHTTPClientTransport(
        new URL(this.options.url ?? DEFAULT_SEMRUSH_MCP_URL),
        { requestInit: { headers: { Authorization: `Apikey ${this.options.apiKey}` } } },
      );
      const client = new Client({ name: "yellowlime-seo-studio", version: "1.0.0" });
      this.client = client.connect(transport).then(
        () => client,
        (error: unknown) => {
          this.client = null;
          throw error;
        },
      );
    }
    return this.client;
  }

  private async reset(): Promise<void> {
    const pending = this.client;
    this.client = null;
    if (pending) await pending.then((client) => client.close()).catch(() => undefined);
  }

  async request(path: string): Promise<Response> {
    const { report, params } = mcpRequestFromPath(path);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const client = await this.connect();
        const result = await client.callTool(
          { name: "execute_report", arguments: { report, params } },
          undefined,
          { timeout: this.options.timeoutMs ?? 30_000 },
        );
        return responseFromToolResult(result as { content?: unknown; isError?: boolean });
      } catch (error) {
        await this.reset();
        if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) {
          return textResponse("ERROR 120 :: WRONG KEY - ID IS NOT FOUND");
        }
        if (attempt >= 1) throw error;
      }
    }
  }

  close(): Promise<void> {
    return this.reset();
  }
}
