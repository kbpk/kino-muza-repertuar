import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { enrichRepertoire } from "./external-ratings.mjs";
import { enrichMuzaDetails } from "./muza-details.mjs";

const DEFAULT_SOURCE = "https://www.kinomuza.pl/repertoire/day/";
const DEFAULT_DAYS = 13;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const POSTER_VERSION = 2;

function plainText(value = "") {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(25_000),
        headers: {
          "user-agent": "kino-muza-repertuar/1.0 (+https://github.com/kbpk/kino-muza-repertuar)",
          ...options.headers,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} dla ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
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

function imageFilename(url) {
  const hash = createHash("sha256").update(`${POSTER_VERSION}|${url}`).digest("hex").slice(0, 20);
  return `${hash}.webp`;
}

async function cacheImage(url, mediaDirectory) {
  const filename = imageFilename(url);
  const destination = join(mediaDirectory, filename);
  try {
    await readFile(destination);
    return `media/posters/${filename}`;
  } catch {
    // Brak pliku w cache jest oczekiwany.
  }

  const response = await fetchWithRetry(url, {}, 2);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error(`Nieprawidłowy typ miniatury: ${contentType}`);
  const source = Buffer.from(await response.arrayBuffer());
  if (source.length > 15 * 1024 * 1024) throw new Error("Miniatura przekracza limit 15 MB");
  const { default: sharp } = await import("sharp");
  const optimized = await sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(240, 345, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 72, effort: 4 })
    .toBuffer();
  await writeFile(destination, optimized);
  return `media/posters/${filename}`;
}

function posterKey(movie) {
  return [movie.movieLink || movie.title, movie.year || ""].join("|").toLocaleLowerCase("pl");
}

export function normalizeDay(day) {
  return {
    ...day,
    id: String(day.id ?? ""),
    date: String(day.date ?? ""),
    info: Array.isArray(day.info) ? day.info : [],
    repertoire: (Array.isArray(day.repertoire) ? day.repertoire : []).map((show) => ({
      ...show,
      description: plainText(show.desc || show.shortDesc || ""),
      shortDescription: plainText(show.shortDesc || ""),
    })),
  };
}

export function trimAtFirstEmptyDay(days) {
  const firstEmpty = days.findIndex((day) => day.repertoire.length === 0);
  return firstEmpty === -1 ? days : days.slice(0, firstEmpty);
}

export function dayIso(day) {
  const datetime = day.repertoire?.[0]?.datetime;
  if (datetime && /^\d{4}-\d{2}-\d{2}/.test(datetime)) return datetime.slice(0, 10);
  return "";
}

async function writeDailyArchive(days, dataDirectory, fetchedAt, source) {
  const daysDirectory = join(dataDirectory, "days");
  await mkdir(daysDirectory, { recursive: true });
  for (const day of days) {
    const date = dayIso(day);
    if (!date) continue;
    const path = join(daysDirectory, `${date}.json`);
    let previous = null;
    try {
      previous = JSON.parse(await readFile(path, "utf8"));
    } catch {
      // Pierwszy zapis danego dnia.
    }
    const unchanged = previous && JSON.stringify(previous.day) === JSON.stringify(day);
    const payload = {
      schemaVersion: 1,
      date,
      updatedAt: unchanged ? previous.updatedAt : fetchedAt,
      source,
      day,
    };
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
  }
  return (await readdir(daysDirectory))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.slice(0, 10))
    .sort();
}

async function pruneUnusedPosters(dataDirectory, posterDirectory) {
  const daysDirectory = join(dataDirectory, "days");
  const used = new Set();
  for (const filename of await readdir(daysDirectory)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(filename)) continue;
    const payload = JSON.parse(await readFile(join(daysDirectory, filename), "utf8"));
    for (const movie of payload.day?.repertoire || []) {
      const poster = String(movie.poster || "");
      if (poster.startsWith("media/posters/")) used.add(poster.slice("media/posters/".length));
    }
  }
  const files = (await readdir(posterDirectory)).filter((filename) => filename.endsWith(".webp"));
  await Promise.all(files.filter((filename) => !used.has(filename)).map((filename) => unlink(join(posterDirectory, filename))));
}

export async function buildSnapshot({
  source = DEFAULT_SOURCE,
  daysCount = DEFAULT_DAYS,
  outputDirectory = join(ROOT, "public"),
  skipImages = false,
  skipExternal = false,
  skipMuzaDetails = false,
} = {}) {
  const startedAt = Date.now();
  const indexes = Array.from({ length: daysCount }, (_, index) => index);
  const fetchedDays = await mapConcurrent(indexes, 3, async (index) => {
    const response = await fetchWithRetry(`${source}${index}`);
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.repertoire)) {
      throw new Error(`Nieprawidłowa odpowiedź dla dnia ${index}`);
    }
    return normalizeDay(payload);
  });
  const days = trimAtFirstEmptyDay(fetchedDays);

  const dataDirectory = join(outputDirectory, "data");
  const posterDirectory = join(outputDirectory, "media", "posters");
  await Promise.all([mkdir(posterDirectory, { recursive: true }), mkdir(dataDirectory, { recursive: true })]);
  if (!skipExternal) await enrichRepertoire(days, { cacheDirectory: join(ROOT, ".cache") });
  if (!skipMuzaDetails) await enrichMuzaDetails(days, { cacheDirectory: join(ROOT, ".cache") });

  const posterMap = new Map();
  if (!skipImages) {
    const movies = [...new Map(days.flatMap((day) => day.repertoire).map((movie) => [posterKey(movie), movie])).entries()];
    const downloads = new Map();
    const download = (url) => {
      if (!downloads.has(url)) downloads.set(url, cacheImage(url, posterDirectory));
      return downloads.get(url);
    };
    await mapConcurrent(movies, 4, async ([key, movie]) => {
      const sources = [movie.external?.filmweb?.posterUrl, movie.muzaPosterUrl].filter(Boolean);
      for (const url of sources) {
        try {
          posterMap.set(key, await download(url));
          return;
        } catch (error) {
          console.warn(`Miniatura ${movie.title} (${url}): ${error.message}`);
        }
      }
    });
  }

  for (const day of days) {
    for (const show of day.repertoire) {
      show.poster = posterMap.get(posterKey(show)) || "";
      delete show.cachedThumb;
      delete show.muzaPosterUrl;
      if (show.external?.filmweb) delete show.external.filmweb.posterUrl;
    }
  }

  const fetchedAt = new Date().toISOString();
  const availableDates = await writeDailyArchive(days, dataDirectory, fetchedAt, source);
  await pruneUnusedPosters(dataDirectory, posterDirectory);
  const snapshot = {
    schemaVersion: 1,
    fetchedAt,
    source,
    fetchDurationMs: Date.now() - startedAt,
    days,
  };
  const index = {
    schemaVersion: 1,
    fetchedAt,
    source,
    currentDates: days.map(dayIso).filter(Boolean),
    availableDates,
  };
  await writeFile(join(dataDirectory, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return snapshot;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshot = await buildSnapshot({
    source: process.env.MUZA_SOURCE_URL || DEFAULT_SOURCE,
    daysCount: Number(process.env.MUZA_DAYS || DEFAULT_DAYS),
    outputDirectory: process.env.OUTPUT_DIR || join(ROOT, "public"),
    skipImages: process.env.SKIP_IMAGES === "1",
    skipExternal: process.env.SKIP_EXTERNAL === "1",
    skipMuzaDetails: process.env.SKIP_MUZA_DETAILS === "1",
  });
  const shows = snapshot.days.reduce((sum, day) => sum + day.repertoire.length, 0);
  console.log(`Zapisano ${snapshot.days.length} dni i ${shows} seansów w ${snapshot.fetchDurationMs} ms.`);
}
