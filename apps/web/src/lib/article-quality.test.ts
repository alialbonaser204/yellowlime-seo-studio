import assert from 'node:assert/strict';
import test from 'node:test';
import { findAiPhrases, fleschDouma, parseArticle, rateArticle } from './article-quality';

const para = (n: number) => Array.from({ length: n }, (_, i) => `Een warmtepomp verwarmt je huis zuinig en stil, ook in de winter ${i + 1}.`).join(' ');

const good = [
  '# Warmtepomp kopen: waar let je op?',
  '',
  `Wil je een warmtepomp kopen? ${para(2)}`,
  '',
  '## Wat kost een warmtepomp kopen?',
  para(3),
  '',
  '## Soorten warmtepompen',
  para(3),
  '',
  '### Hybride warmtepomp',
  para(2),
  '',
  '## Warmtepomp kopen en subsidie',
  para(3),
  '',
  '## Onderhoud',
  para(3),
].join('\n');

test('reads headings, paragraphs and list items from markdown', () => {
  const parsed = parseArticle('# Titel\n\nTekst met een [link](https://x.nl).\n\n## Kop\n\n- punt een\n- punt twee\n\nSlot.');
  assert.deepEqual(parsed.h1, ['Titel']);
  assert.deepEqual(parsed.h2, ['Kop']);
  assert.deepEqual(parsed.paragraphs, ['Tekst met een link.', 'Slot.']);
  assert.ok(parsed.body.includes('punt twee'));
});

test('a well-built article scores well and every check passes on keyword placement', () => {
  const result = rateArticle({
    content: good,
    primaryKeyword: 'warmtepomp kopen',
    metaTitle: 'Warmtepomp kopen: prijzen, soorten en subsidie in 2026',
    metaDescription: 'Een warmtepomp kopen? Lees wat een warmtepomp kost, welke soorten er zijn, hoe je subsidie krijgt en waar je op let bij installatie en onderhoud.',
  });
  const byId = Object.fromEntries(result.checks.map((c) => [c.id, c.status]));
  assert.equal(byId['keyword-title'], 'pass');
  assert.equal(byId['keyword-intro'], 'pass');
  assert.equal(byId['keyword-h2'], 'pass');
  assert.equal(byId['meta-title'], 'pass');
  assert.equal(byId['meta-description'], 'pass');
  assert.equal(byId['structure'], 'pass');
  assert.equal(byId['ai-phrases'], 'pass');
  assert.ok(result.score >= 70, `score ${result.score}`);
});

test('missing keyword, meta and headings are flagged and lower the score', () => {
  const result = rateArticle({ content: para(20), primaryKeyword: 'zonnepanelen', metaTitle: '', metaDescription: '' });
  const failed = result.checks.filter((c) => c.status === 'fail').map((c) => c.id);
  for (const id of ['keyword-title', 'keyword-intro', 'keyword-h2', 'meta-title', 'meta-description', 'structure', 'paragraphs']) {
    assert.ok(failed.includes(id), `${id} should fail`);
  }
  assert.ok(result.score < 55);
  assert.equal(result.grade, 'Onvoldoende');
});

test('finds typical Dutch AI phrases', () => {
  const found = findAiPhrases('In de wereld van energie speelt een warmtepomp een cruciale rol. Laten we eens kijken. Het is belangrijk om te weten dat het naadloos werkt.');
  assert.deepEqual(found.map((f) => f.phrase).sort(), ['het is belangrijk om te…', 'in de wereld van', 'laten we eens kijken', 'naadloos', 'speelt een cruciale rol'].sort());
  assert.deepEqual(findAiPhrases('Een warmtepomp is zuinig. Hij werkt ook in de winter.'), []);
});

test('Flesch-Douma: short simple sentences read easier than long complex ones', () => {
  const easy = fleschDouma(Array.from({ length: 10 }, () => 'De pomp is stil. Hij is zuinig. Je huis blijft warm.').join(' '));
  const hard = fleschDouma(Array.from({ length: 6 }, () => 'De energietransitieverplichtingen van gemeentelijke organisaties veroorzaken onvoorziene administratieve consequenties voor particuliere woningeigenaren en installatiebedrijven.').join(' '));
  assert.ok(easy !== null && hard !== null);
  assert.ok(easy! > 70, `easy ${easy}`);
  assert.ok(hard! < 30, `hard ${hard}`);
  assert.equal(fleschDouma('Te kort.'), null);
});
