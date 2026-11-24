import test from "node:test";
import assert from "node:assert/strict";
import { firstFont, fontsFromCss, parseHomePage, primaryColorFromCss } from "./brandStyle";

test("reads heading and body fonts from CSS", () => {
  const css = `body{font-family:"Open Sans",sans-serif} h1,h2{font-family:'Montserrat',Arial} .x{color:#000}`;
  assert.deepEqual(fontsFromCss(css), { heading: "Montserrat", body: "Open Sans" });
  assert.equal(firstFont("var(--f), FontAwesome, Inter, sans-serif"), "Inter");
});

test("primary colour skips greys and picks the most used colour", () => {
  assert.equal(primaryColorFromCss("a{color:#e30613}.b{background:#e30613}.c{color:#333333}.d{color:#ffffff}"), "#e30613");
});

test("finds logo, fonts and photos on the home page", () => {
  const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="/s.css">
  <img class="site-logo" src="/logo.png"><img src="/img/fiets.jpg" alt="Gazelle fiets" width="800"><img src="/icon.svg">`;
  const p = parseHomePage(html, "https://voorbeeld.nl/");
  assert.equal(p.logoUrl, "https://voorbeeld.nl/logo.png");
  assert.deepEqual(p.fontCssUrls, ["https://fonts.googleapis.com/css2?family=Inter"]);
  assert.deepEqual(p.stylesheets, ["https://voorbeeld.nl/s.css"]);
  assert.deepEqual(p.images, [{ url: "https://voorbeeld.nl/img/fiets.jpg", alt: "Gazelle fiets" }]);
});
