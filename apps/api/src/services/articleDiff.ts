/**
 * Compares the AI version of an article with the version after the human
 * check, block by block (headings, paragraphs, list items), and per changed
 * block word by word. The result is stored with the correction and is the
 * learning material for later: what do reviewers remove, add or rewrite?
 */
export interface BlockChange {
  type: "verwijderd" | "toegevoegd" | "gewijzigd";
  /** Kind of block: kop, alinea, lijst, samenvatting. */
  kind: string;
  /** The H2 the block belongs to (context). */
  section: string | null;
  before: string | null;
  after: string | null;
  /** For a changed block: words taken out and put in. */
  removedWords?: string[];
  addedWords?: string[];
}

export interface ArticleDifference {
  changed: boolean;
  stats: {
    blocksBefore: number; blocksAfter: number;
    removed: number; added: number; changed: number; unchanged: number;
    wordsBefore: number; wordsAfter: number;
    /** Share of the AI text that stayed exactly the same (0..1). */
    keptShare: number;
  };
  meta: { metaTitle: { before: string; after: string } | null; metaDescription: { before: string; after: string } | null };
  changes: BlockChange[];
}

interface Block { text: string; kind: string; section: string | null }

const words = (s: string) => s.split(/\s+/).filter(Boolean);

export function toBlocks(markdown: string): Block[] {
  const out: Block[] = [];
  let section: string | null = null;
  for (const chunk of markdown.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    // List items are separate blocks so one removed bullet is visible as such.
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
      for (const l of lines) out.push({ text: l.trim(), kind: "lijst", section });
      continue;
    }
    const text = lines.join("\n").trim();
    if (/^#{1,6}\s/.test(text)) {
      if (/^##\s/.test(text)) section = text.replace(/^##\s+/, "");
      out.push({ text, kind: "kop", section });
    } else if (text.startsWith(">")) out.push({ text, kind: "samenvatting", section });
    else out.push({ text, kind: "alinea", section });
  }
  return out;
}

/** Longest common subsequence on strings: pairs of equal indexes. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

function similarity(a: string, b: string): number {
  const wa = words(a.toLowerCase()), wb = words(b.toLowerCase());
  if (!wa.length || !wb.length) return 0;
  const common = lcs(wa, wb, (x, y) => x === y).length;
  return (2 * common) / (wa.length + wb.length);
}

function wordChanges(before: string, after: string) {
  const wa = words(before), wb = words(after);
  const pairs = lcs(wa, wb, (x, y) => x === y);
  const keptA = new Set(pairs.map(([i]) => i)), keptB = new Set(pairs.map(([, j]) => j));
  return { removedWords: wa.filter((_, i) => !keptA.has(i)).slice(0, 80), addedWords: wb.filter((_, j) => !keptB.has(j)).slice(0, 80) };
}

export function compareArticles(
  before: { fullArticle: string; metaTitle: string; metaDescription: string },
  after: { fullArticle: string; metaTitle: string; metaDescription: string },
): ArticleDifference {
  const a = toBlocks(before.fullArticle), b = toBlocks(after.fullArticle);
  const pairs = lcs(a, b, (x, y) => x.text === y.text);
  const changes: BlockChange[] = [];
  let unchanged = 0;
  let ai = 0, bi = 0;
  const flushGap = (aEnd: number, bEnd: number) => {
    const gapA = a.slice(ai, aEnd), gapB = b.slice(bi, bEnd);
    // Pair up blocks in the gap that are still similar: those were rewritten.
    const usedB = new Set<number>();
    for (const blockA of gapA) {
      let best = -1, score = 0.35;
      gapB.forEach((blockB, k) => { if (!usedB.has(k) && blockB.kind === blockA.kind) { const s = similarity(blockA.text, blockB.text); if (s > score) { score = s; best = k; } } });
      if (best >= 0) {
        usedB.add(best);
        changes.push({ type: "gewijzigd", kind: blockA.kind, section: gapB[best].section, before: blockA.text, after: gapB[best].text, ...wordChanges(blockA.text, gapB[best].text) });
      } else changes.push({ type: "verwijderd", kind: blockA.kind, section: blockA.section, before: blockA.text, after: null });
    }
    gapB.forEach((blockB, k) => { if (!usedB.has(k)) changes.push({ type: "toegevoegd", kind: blockB.kind, section: blockB.section, before: null, after: blockB.text }); });
  };
  for (const [i, j] of pairs) { flushGap(i, j); unchanged++; ai = i + 1; bi = j + 1; }
  flushGap(a.length, b.length);

  const wordsBefore = words(before.fullArticle).length;
  const keptWords = a.filter((_, i) => pairs.some(([x]) => x === i)).reduce((s, blk) => s + words(blk.text).length, 0);
  const metaTitle = before.metaTitle !== after.metaTitle ? { before: before.metaTitle, after: after.metaTitle } : null;
  const metaDescription = before.metaDescription !== after.metaDescription ? { before: before.metaDescription, after: after.metaDescription } : null;
  return {
    changed: changes.length > 0 || Boolean(metaTitle || metaDescription),
    stats: {
      blocksBefore: a.length, blocksAfter: b.length,
      removed: changes.filter((c) => c.type === "verwijderd").length,
      added: changes.filter((c) => c.type === "toegevoegd").length,
      changed: changes.filter((c) => c.type === "gewijzigd").length,
      unchanged,
      wordsBefore, wordsAfter: words(after.fullArticle).length,
      keptShare: wordsBefore ? Math.round((keptWords / wordsBefore) * 1000) / 1000 : 1,
    },
    meta: { metaTitle, metaDescription },
    changes,
  };
}
