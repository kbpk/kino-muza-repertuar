import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const CACHE_MAX_AGE = 12 * 60 * 60 * 1000;
const MATCH_VERSION = 10;
const IMDb_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";

export function normalize(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[łŁ]/g, "l")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function candidateTitles(movie) {
  return [...new Set([movie.originalTitle, movie.title].map((title) => String(title || "").trim()).filter(Boolean))];
}

function samePerson(expected, actual) {
  const left = normalize(expected);
  const right = normalize(actual);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function titleScore(movie, title, year) {
  const candidate = normalize(title);
  const original = normalize(movie.originalTitle);
  const local = normalize(movie.title);
  const expectedYear = Number(movie.year);
  const candidateYear = Number(year);
  if (expectedYear && candidateYear && expectedYear !== candidateYear) return -100;
  if (candidate === original && original) return 10;
  if (candidate === local && local) return 9;
  if (original && (candidate.includes(original) || original.includes(candidate))) return 3;
  if (local && (candidate.includes(local) || local.includes(candidate))) return 2;
  return -100;
}

function similarTitle(left, right) {
  const ignored = new Set(["a", "and", "amp", "i", "the"]);
  const words = (value) => normalize(value).split(" ").filter((word) => word && !ignored.has(word));
  const leftWords = words(left);
  const rightWords = words(right);
  if (!leftWords.length || Math.abs(leftWords.length - rightWords.length) > 1) return false;
  return leftWords.every((word) => rightWords.some((candidate) => {
    if (word === candidate) return true;
    if (word.length < 5 || Math.abs(word.length - candidate.length) > 1) return false;
    let differences = 0;
    if (word.length === candidate.length) {
      for (let index = 0; index < word.length; index += 1) differences += word[index] === candidate[index] ? 0 : 1;
      return differences <= 1;
    }
    const [shorter, longer] = word.length < candidate.length ? [word, candidate] : [candidate, word];
    let shortIndex = 0;
    for (let longIndex = 0; longIndex < longer.length; longIndex += 1) {
      if (shorter[shortIndex] === longer[longIndex]) shortIndex += 1;
    }
    return shortIndex === shorter.length;
  }));
}

export function rottenTomatoesTitleScore(movie, title, year) {
  const expectedYear = Number(movie.year);
  const candidateYear = Number(year);
  if (expectedYear && candidateYear && Math.abs(expectedYear - candidateYear) > 1) return -100;
  const strict = Math.max(titleScore({ ...movie, year: "" }, title, ""), 0);
  if (strict > 0) return strict;
  if (candidateTitles(movie).some((expected) => similarTitle(expected, title))) return 6;
  return -100;
}

export function rottenTomatoesDirectUrls(movie) {
  const urls = [];
  for (const title of candidateTitles(movie)) {
    const words = normalize(title).split(" ").filter(Boolean);
    if (!words.length) continue;
    const underscore = words.join("_");
    const year = Number(movie.year);
    urls.push(
      `https://www.rottentomatoes.com/m/${underscore}`,
      `https://www.rottentomatoes.com/m/${underscore}_${movie.year}`,
      ...(year ? [
        `https://www.rottentomatoes.com/m/${underscore}_${year - 1}`,
        `https://www.rottentomatoes.com/m/${underscore}_${year + 1}`,
      ] : []),
      `https://www.rottentomatoes.com/m/${words.join("-")}`,
    );
  }
  return [...new Set(urls)];
}

export function rottenTomatoesIdentityMatches(movie, data, allowTitleAlias = false) {
  const expectedYear = Number(movie.year);
  const actualYear = Number(data.year);
  if (expectedYear && actualYear && Math.abs(expectedYear - actualYear) > 1) return false;
  const directorMatches = movie.director && data.directors?.some((director) => samePerson(movie.director, director));
  if (movie.director && !directorMatches) return false;
  if (rottenTomatoesTitleScore(movie, data.title, data.year) > 0) return true;
  return allowTitleAlias && Boolean(directorMatches && expectedYear && actualYear);
}

async function fetchWithRetry(url, options = {}, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; kino-muza-repertuar/1.0)",
          accept: "text/html,application/json",
          ...options.headers,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function safe(source, previous, worker) {
  try {
    return await worker();
  } catch (error) {
    console.warn(`${source}: ${error.message}`);
    return previous || null;
  }
}

export function chooseImdbCandidate(movie, candidates) {
  const eligible = candidates.filter((candidate) => candidate.id?.startsWith("tt") && ["feature", "movie"].includes(candidate.q || candidate.qid));
  const matches = eligible
    .map((candidate) => ({ candidate, score: titleScore(movie, candidate.l, candidate.y) }))
    .filter(({ score }) => score >= 9)
    .sort((a, b) => b.score - a.score || (a.candidate.rank || Infinity) - (b.candidate.rank || Infinity));
  const best = matches[0];
  if (!best) {
    const expectedYear = Number(movie.year);
    const sameYear = expectedYear ? eligible.filter((candidate) => Number(candidate.y) === expectedYear) : [];
    return sameYear.length === 1 && sameYear[0] === eligible[0] ? sameYear[0] : null;
  }
  const rival = matches.find((item, index) => index > 0 && item.score === best.score);
  const bestRank = best.candidate.rank || Infinity;
  const rivalRank = rival?.candidate.rank || Infinity;
  if (rival && bestRank * 4 >= rivalRank) return null;
  return best.candidate;
}

async function matchImdb(movie) {
  for (const title of candidateTitles(movie)) {
    const query = [title, movie.year].filter(Boolean).join(" ");
    const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`;
    const payload = await (await fetchWithRetry(url)).json();
    const candidate = chooseImdbCandidate(movie, payload.d || []);
    if (candidate) return { id: candidate.id, url: `https://www.imdb.com/title/${candidate.id}/`, rating: null, votes: null };
  }
  return null;
}

export function chooseFilmwebCandidate(movie, candidates) {
  return candidates
    .filter((candidate) => candidate.preview?.directors?.some((director) => samePerson(movie.director, director.name)))
    .map((candidate) => ({ candidate, score: Math.max(
      titleScore(movie, candidate.info.title, candidate.info.year),
      titleScore(movie, candidate.info.originalTitle, candidate.info.year),
    ) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

export function filmwebPosterUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path.replace(/\.\$\./, ".3.");
  const normalized = String(path).startsWith("/") ? path : `/${path}`;
  return `https://fwcdn.pl/fpo${normalized.replace(/\.\$\./, ".3.")}`;
}

async function matchFilmweb(movie) {
  for (const title of candidateTitles(movie)) {
    const result = await (await fetchWithRetry(`https://www.filmweb.pl/api/v1/search?query=${encodeURIComponent(title)}`)).json();
    const hits = (result.searchHits || []).filter((hit) => hit.type === "film").slice(0, 8);
    const candidates = (await Promise.all(hits.map(async (hit) => {
      try {
        const [info, preview] = await Promise.all([
          fetchWithRetry(`https://www.filmweb.pl/api/v1/film/${hit.id}/info`).then((response) => response.json()),
          fetchWithRetry(`https://www.filmweb.pl/api/v1/film/${hit.id}/preview`).then((response) => response.json()),
        ]);
        return { id: hit.id, info, preview };
      } catch {
        return null;
      }
    }))).filter(Boolean);
    const candidate = chooseFilmwebCandidate(movie, candidates);
    if (!candidate) continue;
    const rating = await (await fetchWithRetry(`https://www.filmweb.pl/api/v1/film/${candidate.id}/rating`)).json();
    const slug = encodeURIComponent(candidate.info.title).replace(/%20/g, "+");
    return {
      id: String(candidate.id),
      url: `https://www.filmweb.pl/film/${slug}-${candidate.info.year}-${candidate.id}`,
      posterUrl: filmwebPosterUrl(candidate.info.posterPath || candidate.preview?.poster?.path),
      rating: Number.isFinite(rating.rate) ? Math.round(rating.rate * 10) / 10 : null,
      votes: Number.isFinite(rating.count) ? rating.count : null,
    };
  }
  return null;
}

function attribute(source, name) {
  return source.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || "";
}

function textContent(source) {
  return source
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRottenTomatoesSearch(html) {
  return [...html.matchAll(/<search-page-media-row\b([^>]*)>([\s\S]*?)<\/search-page-media-row>/gi)].map((match) => {
    const attributes = match[1];
    const body = match[2];
    const titleAnchor = body.match(/<a\b([^>]*)data-qa="info-name"[^>]*>([\s\S]*?)<\/a>/i);
    return {
      title: titleAnchor ? textContent(titleAnchor[2]) : "",
      year: attribute(attributes, "release-year") || attribute(attributes, "releaseyear"),
      url: titleAnchor ? attribute(titleAnchor[1], "href") : "",
    };
  }).filter((item) => item.title && item.url && item.url.includes("/m/"));
}

export function parseRottenTomatoesPage(html) {
  const scoreScript = html.match(/<script[^>]+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/i);
  const scorecard = scoreScript ? JSON.parse(scoreScript[1].trim()) : {};
  const jsonLdScripts = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  let movie = null;
  for (const script of jsonLdScripts) {
    try {
      const value = JSON.parse(script[1]);
      const values = Array.isArray(value) ? value : [value];
      movie = values.find((item) => item?.["@type"] === "Movie") || movie;
    } catch {
      // Inny blok JSON-LD może być niepoprawny i nie dotyczyć filmu.
    }
  }
  const directors = (Array.isArray(movie?.director) ? movie.director : [movie?.director]).filter(Boolean).map((item) => item.name);
  return {
    title: movie?.name || "",
    year: html.match(/"releaseYear":"(\d{4})"/)?.[1] || String(movie?.dateCreated || movie?.datePublished || "").slice(0, 4),
    directors,
    canonicalUrl: movie?.url || "",
    criticsRating: Number(scorecard.criticsScore?.score) || null,
    criticsVotes: Number(scorecard.criticsScore?.reviewCount || scorecard.criticsScore?.ratingCount) || null,
    audienceRating: Number(scorecard.audienceScore?.score) || null,
    audienceVotes: (Number(scorecard.audienceScore?.likedCount) || 0) + (Number(scorecard.audienceScore?.notLikedCount) || 0) || null,
  };
}

async function matchRottenTomatoes(movie) {
  for (const title of candidateTitles(movie)) {
    const query = encodeURIComponent([title, movie.year].filter(Boolean).join(" "));
    const html = await (await fetchWithRetry(`https://www.rottentomatoes.com/search?search=${query}`)).text();
    const candidates = parseRottenTomatoesSearch(html)
      .map((candidate) => ({ ...candidate, score: rottenTomatoesTitleScore(movie, candidate.title, candidate.year) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const candidate of candidates) {
      try {
        const page = await (await fetchWithRetry(candidate.url)).text();
        const data = parseRottenTomatoesPage(page);
        if (!rottenTomatoesIdentityMatches(movie, { ...data, title: data.title || candidate.title, year: data.year || candidate.year })) continue;
        const { canonicalUrl, ...details } = data;
        return { url: canonicalUrl || candidate.url, ...details };
      } catch {
        // Następny kandydat lub polski tytuł może dać właściwy film.
      }
    }
  }
  for (const url of rottenTomatoesDirectUrls(movie)) {
    try {
      const response = await fetchWithRetry(url, {}, 1);
      const page = await response.text();
      const data = parseRottenTomatoesPage(page);
      if (!rottenTomatoesIdentityMatches(movie, data, true)) continue;
      const { canonicalUrl, ...details } = data;
      return { url: canonicalUrl || response.url || url, ...details };
    } catch {
      // Nieistniejące przewidywane adresy są normalną częścią fallbacku.
    }
  }
  return null;
}

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function imdbRatings(ids, cacheDirectory) {
  if (!ids.length) return new Map();
  const path = join(cacheDirectory, "title.ratings.tsv.gz");
  let refresh = false;
  try {
    refresh = Date.now() - (await stat(path)).mtimeMs > 24 * 60 * 60 * 1000;
  } catch {
    refresh = true;
  }
  if (refresh) {
    const response = await fetchWithRetry(IMDb_RATINGS_URL);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  const wanted = new Set(ids);
  const values = new Map();
  const tsv = gunzipSync(await readFile(path)).toString("utf8");
  for (const line of tsv.split("\n")) {
    const [id, rating, votes] = line.split("\t");
    if (wanted.has(id)) values.set(id, { rating: Number(rating), votes: Number(votes) });
  }
  return values;
}

function cacheKey(movie) {
  return [movie.originalTitle || movie.title, movie.year, movie.director].map(normalize).join("|");
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function enrichRepertoire(days, { cacheDirectory = ".cache" } = {}) {
  await mkdir(cacheDirectory, { recursive: true });
  const cachePath = join(cacheDirectory, "external-ratings.json");
  const cache = await loadJson(cachePath, { entries: {} });
  const movies = [...new Map(days.flatMap((day) => day.repertoire).map((movie) => [cacheKey(movie), movie])).entries()];

  const enriched = await mapConcurrent(movies, 3, async ([key, movie]) => {
    const previous = cache.entries[key];
    if (previous?.matchVersion === MATCH_VERSION && Date.now() - new Date(previous.updatedAt).getTime() < CACHE_MAX_AGE) return [key, previous];
    const [imdb, filmweb, rottenTomatoes] = await Promise.all([
      safe(`IMDb ${movie.title}`, previous?.imdb, () => matchImdb(movie)),
      safe(`Filmweb ${movie.title}`, previous?.filmweb, () => matchFilmweb(movie)),
      safe(`Rotten Tomatoes ${movie.title}`, previous?.rottenTomatoes, () => matchRottenTomatoes(movie)),
    ]);
    return [key, { matchVersion: MATCH_VERSION, updatedAt: new Date().toISOString(), imdb, filmweb, rottenTomatoes }];
  });

  const entries = Object.fromEntries(enriched);
  const imdbIds = [...new Set(Object.values(entries).map((entry) => entry.imdb?.id).filter(Boolean))];
  try {
    const ratings = await imdbRatings(imdbIds, cacheDirectory);
    for (const entry of Object.values(entries)) {
      const rating = ratings.get(entry.imdb?.id);
      if (rating) Object.assign(entry.imdb, rating);
    }
  } catch (error) {
    console.warn(`IMDb ratings: ${error.message}`);
  }

  cache.entries = { ...cache.entries, ...entries };
  cache.updatedAt = new Date().toISOString();
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  for (const day of days) {
    for (const movie of day.repertoire) {
      const entry = entries[cacheKey(movie)];
      movie.external = entry ? {
        imdb: entry.imdb,
        filmweb: entry.filmweb ? {
          id: entry.filmweb.id,
          url: entry.filmweb.url,
          posterUrl: entry.filmweb.posterUrl,
          rating: entry.filmweb.rating,
          votes: entry.filmweb.votes,
        } : null,
        rottenTomatoes: entry.rottenTomatoes,
      } : null;
    }
  }
  return days;
}
