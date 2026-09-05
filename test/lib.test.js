import assert from "node:assert/strict";
import test from "node:test";
import { dateLabel, detailsMetadata, externalLinks, fullDate, groupMovies, isRepertoireStale, mergeDaysByDate, metadata, nextAvailableDate, previousAvailableDate, searchMatches, showingEndMinutes, showingMatchesHall, showingMatchesTime, sortMovies } from "../public/lib.js";
import { dayIso, extractRepertoireDates, nonEmptyDays, normalizeDay, preservePastShowings, repertoireDayOffsets, sourceDate } from "../scripts/fetch-repertoire.mjs";

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
  const day = normalizeDay({ id: "00", repertoire: [{ title: " Film ", originalTitle: " THE FILM ", director: " Reżyser ", desc: "<p>A &amp; B<br>Druga linia</p><script>x</script>" }] });
  assert.equal(day.repertoire[0].title, "Film");
  assert.equal(day.repertoire[0].originalTitle, "THE FILM");
  assert.equal(day.repertoire[0].director, "Reżyser");
  assert.equal(day.repertoire[0].description, "A & B\nDruga linia x");
});

test("opisuje dziś i jutro po polsku", () => {
  const now = new Date("2026-09-04T08:00:00");
  assert.equal(dateLabel({ repertoire: [{ datetime: "2026-09-04 18:00:00" }] }, now), "Dziś, 4 września");
  assert.equal(dateLabel({ repertoire: [{ datetime: "2026-09-05 18:00:00" }] }, now), "Jutro, 5 września");
});

test("metadane pod tytułem zawierają tylko najważniejsze informacje", () => {
  assert.deepEqual(metadata({ director: " Jan Kowalski ", genres: ["Dramat", "Komedia"], countries: "Polska", age: "16", year: "2026", premiereDate: "2026-09-04" }), [
    "reż. Jan Kowalski",
    "2026",
    "Dramat, Komedia",
    "język: -",
    "napisy: -",
  ]);
});

test("szczegóły zawierają dodatkowe informacje Muzy bez daty premiery", () => {
  assert.deepEqual(detailsMetadata({
    countries: "Polska",
    age: "16",
    cycle: "Klasyka",
    event: "Pokaz 4K",
    deaf: true,
    ad: true,
    tape35mm: true,
    prePremier: true,
    ticketPrice: "25 zł",
    ticketHalfPrice: "20 zł",
    premiereDate: "2026-09-04",
  }), [
    ["Kraj produkcji", "Polska"],
    ["Wiek", "16+"],
    ["Cykl", "Klasyka"],
    ["Wydarzenie", "Pokaz 4K"],
    ["Dostępność", "napisy dla niesłyszących, audiodeskrypcja"],
    ["Format", "35 mm"],
    ["Status", "przedpremiera"],
    ["Bilet normalny", "25 zł"],
    ["Bilet ulgowy", "20 zł"],
  ]);
});

test("dubbing zastępuje język i napisy w zawsze widocznych metadanych", () => {
  assert.deepEqual(metadata({ dubbing: true, lang: "polski", subtitlesLang: "polskie" }), ["dubbing"]);
  assert.equal(metadata({ dubbing: false }).includes("dubbing"), false);
});

test("pomija puste dni, ale zachowuje późniejsze seanse", () => {
  const days = [
    { id: "00", repertoire: [{ title: "A" }] },
    { id: "01", repertoire: [{ title: "B" }] },
    { id: "02", repertoire: [] },
    { id: "03", repertoire: [{ title: "pokaż" }] },
  ];
  assert.deepEqual(nonEmptyDays(days).map((day) => day.id), ["00", "01", "03"]);
});

test("odczytuje unikalne daty tylko z zakładki filmów", () => {
  const html = `
    <span class="day lh-1">01.01</span>
    <div class="tab-films" id="movies">
      <span class="h2 day lh-1">22.09</span>
      <span class="lh-1 day h2">03.11</span>
      <span class="day lh-1">22.09</span>
    </div>`;
  assert.deepEqual(extractRepertoireDates(html), ["22.09", "03.11"]);
  assert.deepEqual(extractRepertoireDates("<main>brak zakładki</main>"), []);
});

test("łączy najbliższe dni z odległymi datami i obsługuje zmianę roku", () => {
  assert.deepEqual(repertoireDayOffsets(["22.09", "03.11", "04.09", "31.02"], "2026-09-05", 3), [0, 1, 2, 17, 59, 364]);
});

test("ustala datę bazową z czasu odpowiedzi Muzy", () => {
  assert.equal(sourceDate({ now: "2026-09-05 08:45:04", repertoire: [] }), "2026-09-05");
  assert.equal(sourceDate({ repertoire: [{ datetime: "2026-09-06 18:00:00" }] }), "2026-09-06");
});

test("wyznacza nazwę dziennego archiwum z daty seansu", () => {
  assert.equal(dayIso({ repertoire: [{ datetime: "2026-09-04 18:00:00" }] }), "2026-09-04");
  assert.equal(dayIso({ repertoire: [] }), "");
});

test("zachowuje zakończone seanse, ale ufa Muzie w sprawie przyszłych", () => {
  const previous = { repertoire: [
    { datetime: "2026-09-04 14:00:00", title: "Zakończony", hall: "1" },
    { datetime: "2026-09-04 22:00:00", title: "Odwołany", hall: "2" },
  ] };
  const current = {
    now: "2026-09-04 20:00:00",
    repertoire: [{ datetime: "2026-09-04 21:00:00", title: "Aktualny", hall: "3" }],
  };
  assert.deepEqual(preservePastShowings(previous, current).repertoire.map(({ title }) => title), ["Zakończony", "Aktualny"]);
});

test("wyszukiwanie rozumie skróty, polskie znaki i literówki tylko w tytułach", () => {
  const movie = { title: "Gorzkie święta", originalTitle: "Bitter Christmas", director: "Pedro Almodóvar", countries: "Hiszpania" };
  assert.equal(searchMatches(movie, "grz"), true);
  assert.equal(searchMatches(movie, "gorzkue"), true);
  assert.equal(searchMatches(movie, "swieta"), true);
  assert.equal(searchMatches(movie, "bitter"), true);
  assert.equal(searchMatches(movie, "grz almodvar"), false);
  assert.equal(searchMatches(movie, "almodvar"), false);
  assert.equal(searchMatches(movie, "hiszpania"), false);
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

test("opcjonalnie filtruje seanse po sali", () => {
  assert.equal(showingMatchesHall({ hall: "2" }), true);
  assert.equal(showingMatchesHall({ hall: "2" }, new Set(["1", "2"])), true);
  assert.equal(showingMatchesHall({ hall: "3" }, new Set(["1", "2"])), false);
  assert.equal(showingMatchesHall({ hall: "2" }, new Set()), false);
});

test("sortuje filmy alfabetycznie, po ocenach i pierwszym seansie", () => {
  const movies = [
    { title: "B", external: { filmweb: { rating: 7 }, imdb: { rating: 8 }, rottenTomatoes: { criticsRating: 70 } }, showings: [{ datetime: "2026-09-05 18:00:00" }] },
    { title: "A", external: { filmweb: { rating: 8 }, imdb: { rating: 7 }, rottenTomatoes: { criticsRating: 90 } }, showings: [{ datetime: "2026-09-05 20:00:00" }] },
    { title: "C", external: {}, showings: [{ datetime: "2026-09-05 16:00:00" }] },
  ];
  assert.deepEqual(sortMovies(movies).map(({ title }) => title), ["A", "B", "C"]);
  assert.deepEqual(sortMovies(movies, "filmweb").map(({ title }) => title), ["A", "B", "C"]);
  assert.deepEqual(sortMovies(movies, "imdb").map(({ title }) => title), ["B", "A", "C"]);
  assert.deepEqual(sortMovies(movies, "rottenTomatoes").map(({ title }) => title), ["A", "B", "C"]);
  assert.deepEqual(sortMovies(movies, "firstShowing").map(({ title }) => title), ["C", "B", "A"]);
});

test("historia wskazuje poprzedni dostępny dzień", () => {
  const dates = ["2026-09-01", "2026-09-03", "2026-09-04", "2026-09-05"];
  assert.equal(previousAvailableDate(dates, "2026-09-04"), "2026-09-03");
  assert.equal(previousAvailableDate(dates, "2026-09-01"), null);
  assert.equal(nextAvailableDate(dates, "2026-09-04"), "2026-09-05");
  assert.equal(nextAvailableDate(dates, "2026-09-05"), null);
});

test("pasek dni dołącza załadowaną historię bez duplikowania bieżących dni", () => {
  const current = [
    { date: "2026-09-05", repertoire: [] },
    { date: "2026-09-06", repertoire: [] },
  ];
  const cache = new Map([
    ["2026-09-04", { date: "2026-09-04", repertoire: [] }],
    ["2026-09-05", current[0]],
  ]);
  assert.deepEqual(mergeDaysByDate(current, cache.values()).map(fullDate), [
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
  ]);
});

test("ostrzega po nieudanej oczekiwanej aktualizacji", () => {
  const afterEveningGrace = new Date("2026-09-04T18:31:00Z");
  assert.equal(isRepertoireStale("2026-09-04T11:17:00Z", afterEveningGrace), true);
  assert.equal(isRepertoireStale("2026-09-04T16:10:00Z", afterEveningGrace), false);
});

test("uwzględnia dodatkowe wtorkowe aktualizacje", () => {
  const afterTuesdayGrace = new Date("2026-09-08T14:31:00Z");
  assert.equal(isRepertoireStale("2026-09-08T11:10:00Z", afterTuesdayGrace), true);
  assert.equal(isRepertoireStale("2026-09-08T12:10:00Z", afterTuesdayGrace), false);
});
