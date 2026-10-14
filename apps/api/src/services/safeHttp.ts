import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import robotsParser from "robots-parser";
import { validateWebsiteUrl, resolvePublicAddresses, sameRegistrableDomain, type AddressResolver, WebsitePolicyError } from "./websiteUrlPolicy";

export const USER_AGENT = "LimeyPartnerResearchBot/1.0";
export const MAX_HTML_BYTES = 2 * 1024 * 1024;

export interface SafeResponse {
  url: string;
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface SafeHttpOptions {
  resolver?: AddressResolver;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Accept header to send; defaults to HTML. */
  accept?: string;
  fetcher?: (url: string, options?: SafeHttpOptions) => Promise<SafeResponse>;
  transport?: (url: URL, options: SafeHttpOptions) => Promise<SafeResponse>;
}

function readBody(response: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      response.destroy();
      reject(new WebsitePolicyError("De website reageert te traag."));
    }, timeoutMs);
    response.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        clearTimeout(timer);
        response.destroy();
        reject(new WebsitePolicyError("De webpagina is te groot."));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    response.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    response.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function oneRequest(url: URL, options: SafeHttpOptions): Promise<SafeResponse> {
  const resolver = options.resolver;
  const validated = await validateWebsiteUrl(url.toString(), resolver);
  if (options.transport) {
    const response = await options.transport(validated, options);
    if (Buffer.byteLength(response.body, "utf8") > (options.maxBytes ?? MAX_HTML_BYTES)) {
      throw new WebsitePolicyError("De webpagina is te groot.");
    }
    return { ...response, url: response.url || validated.toString() };
  }
  const request = validated.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const req = request(
      {
        protocol: validated.protocol,
        hostname: validated.hostname,
        port: validated.port || undefined,
        path: `${validated.pathname}${validated.search}`,
        method: "GET",
        headers: { "user-agent": USER_AGENT, accept: options.accept ?? "text/html,application/xhtml+xml" },
        timeout: options.timeoutMs ?? 10_000,
        servername: validated.hostname,
        lookup: (hostname, _opts, callback) => {
          resolvePublicAddresses(hostname, resolver)
            .then((addresses) => callback(null, addresses[0].address, addresses[0].family))
            .catch((error) => callback(error as Error, "", 0));
        },
      },
      async (response) => {
        try {
          const body = await readBody(response, options.maxBytes ?? MAX_HTML_BYTES, options.timeoutMs ?? 10_000);
          const headers: Record<string, string | undefined> = {
            "content-type": response.headers["content-type"],
            location: response.headers.location,
          };
          settled = true;
          resolve({ url: validated.toString(), status: response.statusCode ?? 0, headers, body });
        } catch (error) {
          fail(error);
        }
      },
    );
    req.on("timeout", () => {
      req.destroy();
      fail(new WebsitePolicyError("De website reageert te traag."));
    });
    req.on("error", fail);
    req.end();
  });
}

export async function fetchSafe(
  initialUrl: string | URL,
  options: SafeHttpOptions = {},
): Promise<SafeResponse> {
  let current = new URL(initialUrl.toString());
  const original = await validateWebsiteUrl(current.toString(), options.resolver);
  const maxRedirects = options.maxRedirects ?? 5;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const response = await oneRequest(current, options);
    if (response.status < 300 || response.status >= 400 || !response.headers.location) return response;
    if (redirects === maxRedirects) throw new WebsitePolicyError("Te veel doorverwijzingen.");
    const next = new URL(response.headers.location, current);
    if (current.protocol === "https:" && next.protocol !== "https:") {
      throw new WebsitePolicyError("Een onveilige doorverwijzing is geblokkeerd.");
    }
    if (!sameRegistrableDomain(original, next)) {
      throw new WebsitePolicyError("Doorverwijzing naar een ander domein is geblokkeerd.");
    }
    await validateWebsiteUrl(next.toString(), options.resolver);
    current = next;
  }
  throw new WebsitePolicyError("Te veel doorverwijzingen.");
}

export async function fetchRobots(
  origin: URL,
  options: SafeHttpOptions = {},
): Promise<{ allowed: (url: string) => boolean; unavailable: boolean; sitemaps: string[] }> {
  const robotsUrl = new URL("/robots.txt", origin);
  try {
    const response = await (options.fetcher ?? fetchSafe)(robotsUrl.toString(), { ...options, maxBytes: 128 * 1024, maxRedirects: 2 });
    if (response.status === 404) return { allowed: () => true, unavailable: false, sitemaps: [] };
    if (response.status < 200 || response.status >= 300) return { allowed: () => false, unavailable: true, sitemaps: [] };
    const parser = robotsParser(robotsUrl.toString(), response.body);
    return {
      allowed: (url) => parser.isAllowed(url, USER_AGENT) !== false,
      unavailable: false,
      sitemaps: parser.getSitemaps(),
    };
  } catch {
    return { allowed: () => false, unavailable: true, sitemaps: [] };
  }
}