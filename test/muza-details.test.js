import assert from "node:assert/strict";
import test from "node:test";
import { chooseMuzaPoster, extractMuzaImageUrl, extractMuzaLongDescription, isPlaceholderImageUrl, movieSlug, muzaFeaturedImage } from "../scripts/muza-details.mjs";

test("wyciąga pełny opis z sekcji filmu Muzy", () => {
  const html = `
    <section class="content content-movie">
      <div class="container"><div class="paragraph other">
        <p>Pierwszy akapit z &#8222;cytatem&#8221;.</p>
        <p>Drugi<br>wiersz &amp; koniec.</p>
      </div></div>
    </section>
  `;
  assert.equal(extractMuzaLongDescription(html), "Pierwszy akapit z „cytatem”.\n\nDrugi\nwiersz & koniec.");
});

test("nie bierze tekstu spoza sekcji opisu", () => {
  assert.equal(extractMuzaLongDescription('<div class="paragraph"><p>Menu</p></div>'), "");
});

test("odczytuje slug z linku karty filmu", () => {
  assert.equal(movieSlug("https://www.kinomuza.pl/movie/odyseja/"), "odyseja");
  assert.equal(movieSlug("not a url"), "");
});

test("odczytuje obraz karty filmu z REST i HTML Muzy", () => {
  const record = { _embedded: { "wp:featuredmedia": [{
    source_url: "https://muza.test/full.jpg",
    media_details: { sizes: { medium: { source_url: "https://muza.test/medium.jpg" } } },
  }] } };
  assert.equal(muzaFeaturedImage(record), "https://muza.test/medium.jpg");
  assert.equal(extractMuzaImageUrl('<meta property="og:image" content="https://muza.test/movie.jpg">'), "https://muza.test/movie.jpg");
});

test("odrzuca placeholder obrazu Muzy ze wszystkich źródeł", () => {
  const placeholder = "https://www.kinomuza.pl/content/themes/kinomuza/assets/img/content/placeholder-800x450.jpg";
  assert.equal(isPlaceholderImageUrl(placeholder), true);
  assert.equal(extractMuzaImageUrl(`<meta property="og:image" content="${placeholder}">`), "");
  assert.equal(muzaFeaturedImage({ _embedded: { "wp:featuredmedia": [{ source_url: placeholder }] } }), "");
  assert.equal(chooseMuzaPoster([{
    slug: "placeholder-800x450",
    source_url: placeholder,
    media_details: { width: 800, height: 1200 },
  }]), "");
});

test("fallback Muzy wybiera pionowy plakat zamiast poziomego featured media", () => {
  const attachments = [
    { slug: "hero", source_url: "https://muza.test/hero.jpg", media_details: { width: 900, height: 500 } },
    {
      slug: "tony_plakat_fin",
      source_url: "https://www.kinomuza.pl/content/uploads/2026/09/TONY_plakat_fin.jpg",
      media_details: {
        width: 693,
        height: 1024,
        sizes: { medium: { source_url: "https://www.kinomuza.pl/content/uploads/2026/09/TONY_plakat_fin-541x800.jpg" } },
      },
    },
  ];
  assert.equal(
    chooseMuzaPoster(attachments),
    "https://www.kinomuza.pl/content/uploads/2026/09/TONY_plakat_fin-541x800.jpg",
  );
});
