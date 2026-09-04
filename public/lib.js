export function movieKey(show) {
  return [show.movieLink || show.title, show.year || ""].join("|").toLocaleLowerCase("pl");
}

export function normalizeSearch(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[łŁ]/g, "l")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function subsequenceMatch(query, word) {
  if (query.length < 3 || query[0] !== word[0]) return false;
  let queryIndex = 0;
  let first = -1;
  let last = -1;
  for (let index = 0; index < word.length && queryIndex < query.length; index += 1) {
    if (word[index] === query[queryIndex]) {
      if (first === -1) first = index;
      last = index;
      queryIndex += 1;
    }
  }
  return queryIndex === query.length && last - first + 1 <= query.length + 2;
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

function tokenMatches(query, words) {
  return words.some((word) => {
    if (word.includes(query)) return true;
    if (subsequenceMatch(query, word)) return true;
    if (query.length < 4 || Math.abs(query.length - word.length) > 2) return false;
    const allowedErrors = query.length >= 8 ? 2 : 1;
    return editDistance(query, word) <= allowedErrors;
  });
}

export function searchMatches(movie, query) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeSearch([movie.title, movie.originalTitle].filter(Boolean).join(" "));
  if (haystack.includes(normalizedQuery)) return true;
  const words = haystack.split(" ").filter(Boolean);
  return normalizedQuery.split(" ").every((token) => tokenMatches(token, words));
}

function minutesFromTime(value, maximumHour = 23) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > maximumHour || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function showingEndMinutes(show, duration) {
  const start = minutesFromTime(show.hour || show.datetime?.slice(11, 16));
  const runtime = Number.parseInt(duration, 10);
  if (start === null || !Number.isFinite(runtime) || runtime <= 0) return null;
  return start + runtime;
}

export function showingMatchesTime(show, duration, startFrom = "", endBy = "") {
  const earliestStart = minutesFromTime(startFrom);
  const latestEnd = minutesFromTime(endBy, 47);
  if (earliestStart === null && latestEnd === null) return true;

  const start = minutesFromTime(show.hour || show.datetime?.slice(11, 16));
  if (start === null || (earliestStart !== null && start < earliestStart)) return false;
  if (latestEnd === null) return true;

  const end = showingEndMinutes(show, duration);
  return end !== null && end <= latestEnd;
}

export function showingMatchesHall(show, selectedHalls = null) {
  if (selectedHalls === null) return true;
  const halls = selectedHalls instanceof Set ? selectedHalls : new Set(selectedHalls);
  return halls.has(String(show.hall || ""));
}

export function previousAvailableDate(availableDates, selectedDate) {
  return availableDates.filter((date) => date < selectedDate).at(-1) || null;
}

export function nextAvailableDate(availableDates, selectedDate) {
  return availableDates.find((date) => date > selectedDate) || null;
}

export function mergeDaysByDate(...collections) {
  const days = new Map();
  for (const collection of collections) {
    for (const day of collection || []) {
      const date = fullDate(day);
      if (date) days.set(date, day);
    }
  }
  return [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, day]) => day);
}

function warsawClock(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, part]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    time: `${parts.hour}:${parts.minute}`,
  };
}

function previousDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function expectedRepertoireUpdate(now = new Date(), graceMinutes = 150) {
  const localNow = warsawClock(now);
  const weekday = new Date(`${localNow.date}T12:00:00Z`).getUTCDay();
  const targets = weekday === 2 ? [12, 14, 16, 18] : [12, 18];
  const dueToday = targets.filter((hour) => localNow.minutes >= hour * 60 + graceMinutes);
  const date = dueToday.length ? localNow.date : previousDate(localNow.date);
  const hour = dueToday.at(-1) ?? 18;
  return {
    date,
    hour,
    key: `${date} ${String(hour).padStart(2, "0")}:00`,
  };
}

export function isRepertoireStale(fetchedAt, now = new Date(), graceMinutes = 150) {
  const fetched = new Date(fetchedAt);
  if (Number.isNaN(fetched.getTime())) return true;

  const expected = expectedRepertoireUpdate(now, graceMinutes);
  const localFetched = warsawClock(fetched);
  const fetchedKey = `${localFetched.date} ${localFetched.time}`;
  return fetchedKey < expected.key;
}

export function groupMovies(days) {
  const movies = new Map();
  for (const day of days) {
    for (const show of day.repertoire || []) {
      const key = movieKey(show);
      if (!movies.has(key)) movies.set(key, { ...show, showings: [] });
      movies.get(key).showings.push({
        dayId: day.id,
        date: day.date,
        datetime: show.datetime,
        hour: show.hour,
        hall: show.hall,
        ticketLink: show.ticketLink,
        ticketPrice: show.ticketPrice,
        ticketHalfPrice: show.ticketHalfPrice,
      });
    }
  }
  return [...movies.values()].sort((a, b) => a.title.localeCompare(b.title, "pl"));
}

function firstShowing(movie) {
  return (movie.showings || [])
    .map((show) => show.datetime || `${show.date || ""} ${show.hour || ""}`)
    .filter(Boolean)
    .sort()[0] || "";
}

export function sortMovies(movies, sortBy = "title") {
  const titleOrder = (left, right) => left.title.localeCompare(right.title, "pl");
  const rating = (movie) => {
    if (sortBy === "filmweb") return movie.external?.filmweb?.rating;
    if (sortBy === "imdb") return movie.external?.imdb?.rating;
    if (sortBy === "rottenTomatoes") return movie.external?.rottenTomatoes?.criticsRating;
    return null;
  };
  return [...movies].sort((left, right) => {
    if (sortBy === "firstShowing") {
      const leftShowing = firstShowing(left);
      const rightShowing = firstShowing(right);
      if (leftShowing && rightShowing && leftShowing !== rightShowing) return leftShowing.localeCompare(rightShowing);
      if (leftShowing !== rightShowing) return leftShowing ? -1 : 1;
      return titleOrder(left, right);
    }
    if (["filmweb", "imdb", "rottenTomatoes"].includes(sortBy)) {
      const leftRating = rating(left);
      const rightRating = rating(right);
      const leftMissing = !Number.isFinite(leftRating);
      const rightMissing = !Number.isFinite(rightRating);
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      if (!leftMissing && leftRating !== rightRating) return rightRating - leftRating;
    }
    return titleOrder(left, right);
  });
}

export function externalLinks(movie) {
  const title = movie.originalTitle || movie.title;
  const query = [title, movie.year].filter(Boolean).join(" ");
  return {
    imdb: movie.external?.imdb?.url || `https://www.imdb.com/find/?q=${encodeURIComponent(query)}&s=tt`,
    filmweb: movie.external?.filmweb?.url || `https://www.filmweb.pl/search?q=${encodeURIComponent(query)}`,
    rottenTomatoes: movie.external?.rottenTomatoes?.url || `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`,
  };
}

export function fullDate(showOrDay) {
  const datetime = showOrDay.datetime || showOrDay.repertoire?.[0]?.datetime;
  if (datetime) return datetime.slice(0, 10);
  return showOrDay.date || "";
}

export function dateLabel(day, now = new Date()) {
  const iso = fullDate(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return day.date;
  const date = new Date(`${iso}T12:00:00`);
  const [year, month, dayOfMonth] = iso.split("-").map(Number);
  const targetDay = Date.UTC(year, month - 1, dayOfMonth);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const difference = Math.round((targetDay - today) / 86_400_000);
  const prefix = difference === 0 ? "Dziś" : difference === 1 ? "Jutro" : new Intl.DateTimeFormat("pl-PL", { weekday: "long" }).format(date);
  return `${prefix}, ${new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" }).format(date)}`;
}

export function metadata(movie) {
  const language = movie.dubbing
    ? ["dubbing"]
    : [`język: ${movie.lang || "-"}`, `napisy: ${movie.subtitlesLang || "-"}`];

  return [
    movie.director && `reż. ${movie.director.trim()}`,
    movie.year,
    movie.duration && `${movie.duration} min`,
    movie.genres?.length && movie.genres.join(", "),
    ...language,
  ].filter(Boolean);
}

export function detailsMetadata(movie) {
  const accessibility = [
    movie.deaf && "napisy dla niesłyszących",
    movie.ad && "audiodeskrypcja",
  ].filter(Boolean);
  return [
    ["Kraj produkcji", movie.countries],
    ["Wiek", movie.age && `${movie.age}+`],
    ["Cykl", movie.cycle],
    ["Wydarzenie", movie.event && movie.event !== movie.cycle ? movie.event : ""],
    ["Dostępność", accessibility.join(", ")],
    ["Format", movie.tape35mm ? "35 mm" : ""],
    ["Status", movie.prePremier ? "przedpremiera" : ""],
    ["Bilet normalny", movie.ticketPrice],
    ["Bilet ulgowy", movie.ticketHalfPrice],
  ].filter(([, value]) => value);
}
