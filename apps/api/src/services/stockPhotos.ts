/**
 * Free stock photos from Pexels (https://www.pexels.com/api/). Needs the
 * PEXELS_API_KEY setting; without it no stock photos are shown.
 */
export interface StockPhoto {
  url: string;
  alt: string;
  photographer: string;
  photographerUrl: string;
  pageUrl: string;
}

const cache = new Map<string, StockPhoto[]>();

/** Always true: without a key the free Openverse catalogue is used. */
export function pexelsConfigured(): boolean {
  return true;
}

/** Which photo service is used: the first one with a key, else Openverse (no key needed). */
export function stockProvider(): "pexels" | "unsplash" | "pixabay" | "openverse" {
  if (process.env.PEXELS_API_KEY) return "pexels";
  if (process.env.UNSPLASH_ACCESS_KEY) return "unsplash";
  if (process.env.PIXABAY_API_KEY) return "pixabay";
  return "openverse";
}

export async function searchStockPhotos(query: string, perPage = 5, fetcher: typeof fetch = fetch): Promise<StockPhoto[]> {
  if (!query.trim()) return [];
  const provider = stockProvider();
  if (provider !== "pexels") return searchOther(provider, query, perPage, fetcher);
  const key = process.env.PEXELS_API_KEY!;
  const cacheKey = `${query.toLowerCase()}:${perPage}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: String(perPage), orientation: "landscape" })}`;
  const res = await fetcher(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`pexels_${res.status}`);
  const data = (await res.json()) as { photos?: { src?: { large?: string; landscape?: string }; alt?: string; photographer?: string; photographer_url?: string; url?: string }[] };
  const photos = (data.photos ?? [])
    .filter((p) => p.src?.large)
    .map((p) => ({
      url: p.src!.landscape ?? p.src!.large!,
      alt: p.alt ?? "",
      photographer: p.photographer ?? "Pexels",
      photographerUrl: p.photographer_url ?? "https://www.pexels.com",
      pageUrl: p.url ?? "https://www.pexels.com",
    }));
  cache.set(cacheKey, photos);
  return photos;
}

async function searchOther(provider: "unsplash" | "pixabay" | "openverse", query: string, perPage: number, fetcher: typeof fetch): Promise<StockPhoto[]> {
  const cacheKey = `${provider}:${query.toLowerCase()}:${perPage}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  let photos: StockPhoto[] = [];
  const signal = AbortSignal.timeout(10_000);
  if (provider === "unsplash") {
    const res = await fetcher(`https://api.unsplash.com/search/photos?${new URLSearchParams({ query, per_page: String(perPage), orientation: "landscape" })}`, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }, signal });
    if (!res.ok) throw new Error(`unsplash_${res.status}`);
    const data = (await res.json()) as { results?: { urls?: { regular?: string }; alt_description?: string; user?: { name?: string; links?: { html?: string } }; links?: { html?: string } }[] };
    photos = (data.results ?? []).filter((p) => p.urls?.regular).map((p) => ({ url: p.urls!.regular!, alt: p.alt_description ?? "", photographer: `${p.user?.name ?? "Unsplash"} (Unsplash)`, photographerUrl: p.user?.links?.html ?? "https://unsplash.com", pageUrl: p.links?.html ?? "https://unsplash.com" }));
  } else if (provider === "pixabay") {
    const res = await fetcher(`https://pixabay.com/api/?${new URLSearchParams({ key: process.env.PIXABAY_API_KEY!, q: query, per_page: String(Math.max(3, perPage)), image_type: "photo", orientation: "horizontal", safesearch: "true" })}`, { signal });
    if (!res.ok) throw new Error(`pixabay_${res.status}`);
    const data = (await res.json()) as { hits?: { webformatURL?: string; largeImageURL?: string; tags?: string; user?: string; pageURL?: string }[] };
    photos = (data.hits ?? []).filter((p) => p.largeImageURL).map((p) => ({ url: p.largeImageURL!, alt: p.tags ?? "", photographer: `${p.user ?? "Pixabay"} (Pixabay)`, photographerUrl: p.pageURL ?? "https://pixabay.com", pageUrl: p.pageURL ?? "https://pixabay.com" }));
  } else {
    // Openverse: free, no key. Only photos that may be used commercially and edited.
    const res = await fetcher(`https://api.openverse.org/v1/images/?${new URLSearchParams({ q: query, page_size: String(Math.max(5, perPage)), license_type: "commercial,modification", category: "photograph", aspect_ratio: "wide", mature: "false" })}`, { headers: { "user-agent": "YellowlimeBot/1.0 (+https://yellowlime.nl)" }, signal });
    if (!res.ok) throw new Error(`openverse_${res.status}`);
    const data = (await res.json()) as { results?: { url?: string; title?: string; creator?: string; creator_url?: string; foreign_landing_url?: string; license?: string; license_version?: string; width?: number }[] };
    photos = (data.results ?? [])
      .filter((p) => p.url && /^https:/.test(p.url) && (p.width ?? 1200) >= 800)
      .map((p) => ({ url: p.url!, alt: p.title ?? "", photographer: `${p.creator ?? "onbekend"} (${(p.license ?? "cc").toUpperCase()} ${p.license_version ?? ""})`.trim(), photographerUrl: p.creator_url ?? p.foreign_landing_url ?? "https://openverse.org", pageUrl: p.foreign_landing_url ?? "https://openverse.org" }));
  }
  cache.set(cacheKey, photos);
  return photos;
}
