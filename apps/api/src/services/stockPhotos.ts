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

export function pexelsConfigured(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

export async function searchStockPhotos(query: string, perPage = 5, fetcher: typeof fetch = fetch): Promise<StockPhoto[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key || !query.trim()) return [];
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
