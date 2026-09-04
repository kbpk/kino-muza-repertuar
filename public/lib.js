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
  const haystack = normalizeSearch([movie.title, movie.originalTitle, movie.director, movie.countries].filter(Boolean).join(" "));
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

export function previousAvailableDate(availableDates, selectedDate) {
  return availableDates.filter((date) => date < selectedDate).at(-1) || null;
}

export function nextAvailableDate(availableDates, selectedDate) {
  return availableDates.find((date) => date > selectedDate) || null;
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
    movie.countries,
    movie.year,
    movie.duration && `${movie.duration} min`,
    movie.premiereDate && `premiera ${movie.premiereDate}`,
    movie.age && `${movie.age}+`,
    ...language,
  ].filter(Boolean);
}
