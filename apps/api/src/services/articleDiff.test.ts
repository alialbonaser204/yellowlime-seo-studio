import test from "node:test";
import assert from "node:assert/strict";
import { compareArticles } from "./articleDiff";

const meta = { metaTitle: "T", metaDescription: "D" };
test("finds removed, added and rewritten blocks", () => {
  const before = "# Titel\n\nIntro over fietsen.\n\n## Prijzen\n\nEen fiets kost veel geld bij ons in de winkel.\n\n- punt een\n- punt twee\n\n## Conclusie\n\nKortom, kom langs.";
  const after = "# Titel\n\nIntro over fietsen.\n\n## Prijzen\n\nEen fiets kost vaak minder geld bij ons in de winkel.\n\n- punt een\n\nBel ons voor advies.";
  const d = compareArticles({ fullArticle: before, ...meta }, { fullArticle: after, ...meta, metaTitle: "Nieuw" });
  assert.equal(d.changed, true);
  const types = d.changes.map((c) => `${c.type}:${c.kind}`);
  assert.ok(types.includes("gewijzigd:alinea"));
  assert.ok(types.includes("verwijderd:lijst"));
  assert.ok(types.includes("verwijderd:kop"));
  assert.ok(types.includes("toegevoegd:alinea"));
  const rewrite = d.changes.find((c) => c.type === "gewijzigd")!;
  assert.deepEqual(rewrite.removedWords, ["veel"]);
  assert.deepEqual(rewrite.addedWords, ["vaak", "minder"]);
  assert.deepEqual(d.meta.metaTitle, { before: "T", after: "Nieuw" });
  assert.ok(d.stats.keptShare > 0 && d.stats.keptShare < 1);
});

test("no changes", () => {
  const d = compareArticles({ fullArticle: "# A\n\nB", ...meta }, { fullArticle: "# A\n\nB", ...meta });
  assert.equal(d.changed, false);
  assert.equal(d.stats.keptShare, 1);
});
