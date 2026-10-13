import dns from "node:dns/promises";
import net from "node:net";
import type { LookupAddress } from "node:dns";
import { getDomain, getHostname, parse } from "tldts";

export class WebsitePolicyError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "WebsitePolicyError";
  }
}

export type AddressResolver = (host: string) => Promise<LookupAddress[]>;

const DEFAULT_RESOLVER: AddressResolver = (host) =>
  dns.lookup(host, { all: true, verbatim: true });

export function registrableDomain(hostname: string): string {
  const host = (getHostname(hostname.replace(/^\[|\]$/g, "")) ?? "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (net.isIP(host)) return host;
  const domain = getDomain(host);
  if (!domain || !parse(host).isIcann) {
    throw new WebsitePolicyError("De website heeft geen publieke domeinextensie.");
  }
  return domain;
}

function isPrivateOrReservedIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = net.isIP(normalized);
  if (version === 4) {
    const octets = normalized.split(".").map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 2) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version !== 6) return true;
  const parts = normalized.split(":");
  const first = Number.parseInt((parts.find(Boolean) || "0"), 16);
  const isMapped = normalized.startsWith("::ffff:");
  if (isMapped) {
    const mapped = normalized.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) return isPrivateOrReservedIp(mapped);
    const hexParts = mapped.split(":").filter(Boolean);
    if (hexParts.length === 2) {
      const high = Number.parseInt(hexParts[0], 16);
      const low = Number.parseInt(hexParts[1], 16);
      return isPrivateOrReservedIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    first === 0 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    normalized.startsWith("2001:db8:") ||
    first >= 0xff00
  );
}

export async function validateWebsiteUrl(
  input: string,
  resolver: AddressResolver = DEFAULT_RESOLVER,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new WebsitePolicyError("De website-URL is ongeldig.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebsitePolicyError("Alleen HTTP en HTTPS-websites zijn toegestaan.");
  }
  if (url.username || url.password) {
    throw new WebsitePolicyError("Website-URL's met inloggegevens zijn niet toegestaan.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new WebsitePolicyError("Ongebruikelijke websitepoorten zijn niet toegestaan.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new WebsitePolicyError("Lokale websites zijn niet toegestaan.");
  }
  if (net.isIP(host) && isPrivateOrReservedIp(host)) {
    throw new WebsitePolicyError("Privé- of gereserveerde IP-adressen zijn niet toegestaan.");
  }
  const addresses = await resolvePublicAddresses(host, resolver);
  registrableDomain(host);
  return url;
}

export async function resolvePublicAddresses(
  host: string,
  resolver: AddressResolver = DEFAULT_RESOLVER,
): Promise<LookupAddress[]> {
  let addresses: LookupAddress[];
  try {
    addresses = net.isIP(host)
      ? [{ address: host, family: net.isIP(host) as 4 | 6 }]
      : await resolver(host);
  } catch {
    throw new WebsitePolicyError("De website kon niet worden gevonden.");
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw new WebsitePolicyError("De website verwijst naar een niet-publiek IP-adres.");
  }
  return addresses;
}

export function sameRegistrableDomain(a: URL, b: URL): boolean {
  try {
    return registrableDomain(a.hostname) === registrableDomain(b.hostname);
  } catch {
    return false;
  }
}

export { isPrivateOrReservedIp };