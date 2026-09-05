import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseFilmwebCandidate,
  chooseImdbCandidate,
  candidateTitles,
  filmwebGenres,
  normalize,
  filmwebPosterUrl,
  imdbIdentityMatches,
  parseRottenTomatoesPage,
  parseRottenTomatoesSearch,
  rottenTomatoesDirectUrls,
  rottenTomatoesIdentityMatches,
  rottenTomatoesTitleScore,
} from "../scripts/external-ratings.mjs";

const movie = { title: "Odyseja", originalTitle: "The Odyssey", year: "2026", director: "Christopher Nolan" };

test("próbuje najpierw tytułu oryginalnego, potem polskiego", () => {
  assert.deepEqual(candidateTitles(movie), ["The Odyssey", "Odyseja"]);
  assert.deepEqual(candidateTitles({ title: "Ten sam", originalTitle: "Ten sam" }), ["Ten sam"]);
});

test("normalizuje polskie znaki do porównań", () => {
  assert.equal(normalize("Zażółć gęślą"), "zazolc gesla");
});

test("IMDb wybiera zgodny tytuł i rok", () => {
  const result = chooseImdbCandidate(movie, [
    { id: "tt-old", l: "The Odyssey", y: 2016, q: "feature", rank: 1 },
    { id: "tt-right", l: "The Odyssey", y: 2026, q: "feature", rank: 3 },
  ]);
  assert.equal(result.id, "tt-right");
});

test("IMDb toleruje roczną różnicę daty premiery przy zgodnym tytule", () => {
  const promisedLand = { title: "Ziemia obiecana", originalTitle: "The Promised Land", year: "1974" };
  const result = chooseImdbCandidate(promisedLand, [
    { id: "tt-new", l: "The Promised Land", y: 2023, q: "feature", rank: 1 },
    { id: "tt0072446", l: "The Promised Land", y: 1975, q: "feature", rank: 20 },
  ]);
  assert.equal(result.id, "tt0072446");
});

test("IMDb odrzuca dwa równie prawdopodobne filmy", () => {
  const result = chooseImdbCandidate(movie, [
    { id: "tt-one", l: "The Odyssey", y: 2026, q: "feature", rank: 100 },
    { id: "tt-two", l: "The Odyssey", y: 2026, q: "feature", rank: 120 },
  ]);
  assert.equal(result, null);
});

test("IMDb akceptuje jednoznaczny alias jako pierwsze trafienie ze zgodnym rokiem", () => {
  const city = { title: "Miasto straconych dusz", originalTitle: "Stadt der verlorenen Seelen", year: "1983" };
  const result = chooseImdbCandidate(city, [
    { id: "tt0084724", l: "City of Lost Souls", y: 1983, q: "feature", rank: 168527 },
    { id: "tt0112682", l: "The City of Lost Children", y: 1995, q: "feature", rank: 6371 },
  ]);
  assert.equal(result.id, "tt0084724");
});

test("IMDb potwierdza odległy rok zgodnością tytułu i reżysera", () => {
  const delayed = { title: "Film", originalTitle: "The Film", year: "2018", director: "Jan Kowalski" };
  assert.equal(imdbIdentityMatches(delayed, {
    candidateTitle: "The Film",
    title: "Film",
    directors: ["Jan Kowalski"],
  }), true);
  assert.equal(imdbIdentityMatches(delayed, {
    candidateTitle: "The Film",
    title: "Film",
    directors: ["Anna Nowak"],
  }), false);
});

test("IMDb odrzuca alias, gdy zgodny rok nie jest jednoznaczny", () => {
  const city = { title: "Inny tytuł", originalTitle: "Nieznany tytuł", year: "1983" };
  const result = chooseImdbCandidate(city, [
    { id: "tt-one", l: "First", y: 1983, q: "feature", rank: 10 },
    { id: "tt-two", l: "Second", y: 1983, q: "feature", rank: 20 },
  ]);
  assert.equal(result, null);
});

test("Filmweb wymaga zgodnego reżysera", () => {
  const result = chooseFilmwebCandidate(movie, [
    { id: 1, info: { title: "Odyseja", year: 2026 }, preview: { directors: [{ name: "Inny Reżyser" }] } },
    { id: 2, info: { title: "Odyseja", originalTitle: "The Odyssey", year: 2026 }, preview: { directors: [{ name: "Christopher Nolan" }] } },
  ]);
  assert.equal(result.id, 2);
});

test("Filmweb toleruje roczną różnicę daty premiery przy zgodnym tytule i reżyserze", () => {
  const konopielka = { title: "Konopielka", year: "1982", director: "Witold Leszczyński" };
  const result = chooseFilmwebCandidate(konopielka, [
    { id: 1111, info: { title: "Konopielka", year: 1981 }, preview: { directors: [{ name: "Witold Leszczyński" }] } },
    { id: 2222, info: { title: "Konopielka", year: 2001 }, preview: { directors: [{ name: "Witold Leszczyński" }] } },
  ]);
  assert.equal(result.id, 1111);
});

test("Filmweb potwierdza większą różnicę roku zgodnością tytułu i reżysera", () => {
  const delayed = { title: "Długo czekający film", year: "2018", director: "Jan Kowalski" };
  const result = chooseFilmwebCandidate(delayed, [
    { id: 3333, info: { title: "Długo czekający film", year: 2023 }, preview: { directors: [{ name: "Jan Kowalski" }] } },
  ]);
  assert.equal(result.id, 3333);
});

test("buduje adres wystarczająco dużego plakatu Filmwebu", () => {
  assert.equal(
    filmwebPosterUrl("/54/99/10085499/8255327.$.jpg"),
    "https://fwcdn.pl/fpo/54/99/10085499/8255327.3.jpg",
  );
});

test("odczytuje polskie gatunki z podglądu Filmwebu", () => {
  assert.deepEqual(filmwebGenres({ genres: [
    { name: { text: "Dramat" } },
    { name: { text: "Komedia" } },
    { name: { text: "Dramat" } },
  ] }), ["Dramat", "Komedia"]);
});

test("odczytuje wyniki i oceny Rotten Tomatoes", () => {
  const search = `<search-page-media-row release-year="2026"><a href="https://www.rottentomatoes.com/m/the_odyssey_2026" data-qa="info-name">The &amp; Odyssey</a></search-page-media-row>`;
  assert.deepEqual(parseRottenTomatoesSearch(search), [{ title: "The & Odyssey", year: "2026", url: "https://www.rottentomatoes.com/m/the_odyssey_2026" }]);
  const page = `<script type="application/ld+json">{"@type":"Movie","name":"The Odyssey","dateCreated":"2026-07-17","director":[{"name":"Christopher Nolan"}]}</script><script id="media-scorecard-json" type="application/json">{"criticsScore":{"score":"94","reviewCount":506},"audienceScore":{"score":"97","likedCount":100,"notLikedCount":5}}</script>`;
  assert.deepEqual(parseRottenTomatoesPage(page), {
    title: "The Odyssey",
    year: "2026",
    directors: ["Christopher Nolan"],
    canonicalUrl: "",
    criticsRating: 94,
    criticsVotes: 506,
    audienceRating: 97,
    audienceVotes: 105,
  });
});

test("Rotten Tomatoes toleruje Cleopatre zamiast Cleopatra i różnicę roku premiery", () => {
  const asterix = {
    title: "Asterix i Obelix: Misja Kleopatra",
    originalTitle: "Asterix & Obelix: Mission Cleopatra",
    year: "2002",
  };
  assert.equal(rottenTomatoesTitleScore(asterix, "Asterix & Obelix: Mission Cleopatre", "2003"), 6);
  assert.equal(rottenTomatoesTitleScore(asterix, "Asterix & Obelix: The Middle Kingdom", "2023"), -100);
});

test("buduje bezpośredni fallback Rotten Tomatoes z tytułu oryginalnego", () => {
  const urls = rottenTomatoesDirectUrls({ title: "Gorzkie święta", originalTitle: "Bitter Christmas", year: "2026" });
  assert.equal(urls[0], "https://www.rottentomatoes.com/m/bitter_christmas");
  assert.ok(urls.includes("https://www.rottentomatoes.com/m/bitter_christmas_2026"));
});

test("fallback RT próbuje sąsiedni rok i potwierdza alias reżyserem", () => {
  const city = { title: "Miasto straconych dusz", originalTitle: "Stadt der verlorenen Seelen", year: "1983", director: "Rosa von Praunheim" };
  assert.ok(rottenTomatoesDirectUrls(city).includes("https://www.rottentomatoes.com/m/stadt_der_verlorenen_seelen_1982"));
  assert.equal(rottenTomatoesIdentityMatches(city, {
    title: "City of Lost Souls",
    year: "1983",
    directors: ["Rosa von Praunheim"],
  }, true), true);
  assert.equal(rottenTomatoesIdentityMatches(city, {
    title: "City of Lost Souls",
    year: "1983",
    directors: ["Inny Reżyser"],
  }, true), false);
});
