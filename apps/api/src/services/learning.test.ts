import test from "node:test";
import assert from "node:assert/strict";
import { lessonsBlock, parseLessons } from "./learning";

test("parses lessons and fixes bad scopes", () => {
  const raw = 'Hier: {"lessons":[{"rule":"Noem geen prijzen","explanation":"Je haalde de prijzen weg.","before":"€1.000","after":null,"suggestedScope":"partner","reason":"Alleen hier gezien"},{"rule":"","explanation":"x"},{"rule":"Korte zinnen","suggestedScope":"raar"}]}';
  const l = parseLessons(raw);
  assert.equal(l.length, 2);
  assert.equal(l[0].rule, "Noem geen prijzen");
  assert.equal(l[1].suggestedScope, "partner");
  assert.deepEqual(parseLessons("geen json"), []);
});

test("lessons block puts partner lessons before general ones", () => {
  const b = lessonsBlock({ partner: ["Noem geen prijzen"], general: ["Korte zinnen"] });
  assert.ok(b.indexOf("Noem geen prijzen") < b.indexOf("Korte zinnen"));
  assert.equal(lessonsBlock({ partner: [], general: [] }), "");
});
