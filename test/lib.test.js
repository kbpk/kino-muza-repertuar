import assert from "node:assert/strict";
import test from "node:test";
import { dateLabel, externalLinks, groupMovies, metadata, nextAvailableDate, previousAvailableDate, searchMatches, showingEndMinutes, showingMatchesTime } from "../public/lib.js";
import { dayIso, normalizeDay, trimAtFirstEmptyDay } from "../scripts/fetch-repertoire.mjs";

test("grupuje seanse tego samego filmu", () => {
  const movie = { title: "Film", year: "2026", movieLink: "https://example.test/film", hour: "18:00" };
  const result = groupMovies([
    { id: "00", date: "04.09", repertoire: [movie, { ...movie, hour: "20:00" }] },
    { id: "01", date: "05.09", repertoire: [{ ...movie, hour: "16:00" }] },
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].showings.map((show) => show.hour), ["18:00", "20:00", "16:00"]);
});

test("buduje zakodowane linki do trzech serwisów", () => {
  const links = externalLinks({ title: "Tytuł PL", originalTitle: "A Film & More", year: "2025" });
  assert.match(links.imdb, /A%20Film%20%26%20More%202025/);
  assert.match(links.filmweb, /^https:\/\/www\.filmweb\.pl\/search\?q=/);
  assert.match(links.rottenTomatoes, /^https:\/\/www\.rottentomatoes\.com\/search\?search=/);
});

test("używa dokładnych linków po dopasowaniu", () => {
  const links = externalLinks({
    title: "Film",
    external: {
      imdb: { url: "https://www.imdb.com/title/tt123/" },
      filmweb: { url: "https://www.filmweb.pl/film/Film-2026-123" },
      rottenTomatoes: { url: "https://www.rottentomatoes.com/m/film" },
    },
  });
  assert.equal(links.imdb, "https://www.imdb.com/title/tt123/");
  assert.equal(links.filmweb, "https://www.filmweb.pl/film/Film-2026-123");
  assert.equal(links.rottenTomatoes, "https://www.rottentomatoes.com/m/film");
});

test("usuwa HTML z opisu, ale zachowuje tekst", () => {
  const day = normalizeDay({ id: "00", repertoire: [{ title: "Film", desc: "<p>A &amp; B<br>Druga linia</p><script>x</script>" }] });
  assert.equal(day.repertoire[0].description, "A & B\nDruga linia x");
});

test("opisuje dziś i jutro po polsku", () => {
  const now = new Date("2026-09-04T08:00:00");
  assert.equal(dateLabel({ repertoire: [{ datetime: "2026-09-04 18:00:00" }] }, now), "Dziś, 4 września");
  assert.equal(dateLabel({ repertoire: [{ datetime: "2026-09-05 18:00:00" }] }, now), "Jutro, 5 września");
});

test("metadane zawierają datę premiery", () => {
  assert.deepEqual(metadata({ director: " Jan Kowalski ", year: "2026", premiereDate: "2026-09-04" }), [
    "reż. Jan Kowalski",
    "2026",
    "premiera 2026-09-04",
    "język: -",
    "napisy: -",
  ]);
});

test("dubbing zastępuje język i napisy w zawsze widocznych metadanych", () => {
  assert.deepEqual(metadata({ dubbing: true, lang: "polski", subtitlesLang: "polskie" }), ["dubbing"]);
  assert.equal(metadata({ dubbing: false }).includes("dubbing"), false);
});

test("kończy repertuar na pierwszym pustym dniu", () => {
  const days = [
    { id: "00", repertoire: [{ title: "A" }] },
    { id: "01", repertoire: [{ title: "B" }] },
    { id: "02", repertoire: [] },
    { id: "03", repertoire: [{ title: "nie pokazuj" }] },
  ];
  assert.deepEqual(trimAtFirstEmptyDay(days).map((day) => day.id), ["00", "01"]);
});

test("wyznacza nazwę dziennego archiwum z daty seansu", () => {
  assert.equal(dayIso({ repertoire: [{ datetime: "2026-09-04 18:00:00" }] }), "2026-09-04");
  assert.equal(dayIso({ repertoire: [] }), "");
});

test("wyszukiwanie rozumie skróty, polskie znaki i literówki", () => {
  const movie = { title: "Gorzkie święta", director: "Pedro Almodóvar", countries: "Hiszpania" };
  assert.equal(searchMatches(movie, "grz"), true);
  assert.equal(searchMatches(movie, "gorzkue"), true);
  assert.equal(searchMatches(movie, "swieta"), true);
  assert.equal(searchMatches(movie, "grz almodvar"), true);
  assert.equal(searchMatches(movie, "nolan"), false);
  assert.equal(searchMatches(movie, ""), true);
});

test("filtruje seanse po najwcześniejszym starcie i najpóźniejszym końcu", () => {
  const show = { hour: "18:00" };
  assert.equal(showingMatchesTime(show, "111", "18:00", "19:51"), true);
  assert.equal(showingMatchesTime(show, "111", "18:01", ""), false);
  assert.equal(showingMatchesTime(show, "111", "", "19:50"), false);
  assert.equal(showingMatchesTime(show, "111"), true);
  assert.equal(showingMatchesTime(show, "", "", "20:00"), false);
  assert.equal(showingEndMinutes({ hour: "23:00" }, "90"), 1470);
  assert.equal(showingMatchesTime({ hour: "23:00" }, "90", "", "24:30"), true);
});

test("historia wskazuje poprzedni dostępny dzień", () => {
  const dates = ["2026-09-01", "2026-09-03", "2026-09-04", "2026-09-05"];
  assert.equal(previousAvailableDate(dates, "2026-09-04"), "2026-09-03");
  assert.equal(previousAvailableDate(dates, "2026-09-01"), null);
  assert.equal(nextAvailableDate(dates, "2026-09-04"), "2026-09-05");
  assert.equal(nextAvailableDate(dates, "2026-09-05"), null);
});
