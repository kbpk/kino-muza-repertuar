import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const DETAILS_VERSION = 4;

export function isPlaceholderImageUrl(value) {
  if (!value) return false;
  try {
    const pathname = decodeURIComponent(new URL(value).pathname).toLocaleLowerCase("en");
    return /(?:^|[/_.-])placeholder(?:[/_.-]|$)/.test(pathname);
  } catch {
    return /(?:^|[/_.-])placeholder(?:[/_.-]|$)/i.test(String(value));
  }
}

function usableImageUrl(value) {
  return value && !isPlaceholderImageUrl(value) ? value : "";
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, hexadecimal, number) => {
      const codePoint = Number.parseInt(number, hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    });
}

function blockContents(html, openingPattern) {
  const opening = openingPattern.exec(html);
  if (!opening) return "";
  const start = opening.index + opening[0].length;
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 1;
  let tag;
  while ((tag = tags.exec(html))) {
    depth += /^<div\b/i.test(tag[0]) ? 1 : -1;
    if (depth === 0) return html.slice(start, tag.index);
  }
  return "";
}

export function extractMuzaLongDescription(html) {
  const sectionMatch = html.match(/<section\b[^>]*class=["'][^"']*\bcontent-movie\b[^"']*["'][^>]*>/i);
  if (!sectionMatch) return "";
  const section = html.slice(sectionMatch.index + sectionMatch[0].length);
  const paragraph = blockContents(section, /<div\b[^>]*class=["'][^"']*\bparagraph\b[^"']*["'][^>]*>/i);
  if (!paragraph) return "";
  return decodeEntities(paragraph)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractMuzaImageUrl(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/\b(?:property|name)=["']og:image["']/i.test(tag)) continue;
    const url = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1] || "";
    const decodedUrl = decodeEntities(url);
    if (usableImageUrl(decodedUrl)) return decodedUrl;
  }
  return "";
}

export function muzaFeaturedImage(record) {
  const image = record?._embedded?.["wp:featuredmedia"]?.[0];
  return usableImageUrl(image?.media_details?.sizes?.medium?.source_url)
    || usableImageUrl(image?.source_url)
    || "";
}

export function chooseMuzaPoster(attachments) {
  return (attachments || [])
    .map((attachment) => {
      const details = attachment?.media_details || {};
      const width = Number(details.width);
      const height = Number(details.height);
      const identity = [attachment.slug, attachment.title?.rendered, details.file, attachment.source_url].filter(Boolean).join(" ");
      return {
        url: usableImageUrl(details.sizes?.medium?.source_url) || usableImageUrl(attachment.source_url) || "",
        width,
        height,
        namedPoster: /(?:plakat|poster)/i.test(identity),
      };
    })
    .filter((image) => image.url && image.width > 0 && image.height / image.width >= 1.2)
    .sort((left, right) => (
      Number(right.namedPoster) - Number(left.namedPoster)
      || Math.abs(left.height / left.width - 1.45) - Math.abs(right.height / right.width - 1.45)
      || right.height * right.width - left.height * left.width
    ))[0]?.url || "";
}

export function movieSlug(movieLink) {
  try {
    const parts = new URL(movieLink).pathname.split("/").filter(Boolean);
    const movieIndex = parts.indexOf("movie");
    return movieIndex >= 0 ? parts[movieIndex + 1] || "" : "";
  } catch {
    return "";
  }
}

async function fetchWithRetry(url, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(25_000),
        headers: { "user-agent": "kino-muza-repertuar/1.0 (+https://github.com/kbpk/kino-muza-repertuar)" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
  throw lastError;
}

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
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

async function refreshMovie(movie, previous) {
  const checkedAt = new Date().toISOString();
  if (previous?.version === DETAILS_VERSION && Date.now() - new Date(previous.checkedAt).getTime() < CACHE_MAX_AGE) return previous;
  const slug = movieSlug(movie.movieLink);
  if (!slug) return previous || { version: DETAILS_VERSION, checkedAt, modified: "", description: "", imageUrl: "" };

  let modified = "";
  let imageUrl = usableImageUrl(previous?.imageUrl);
  try {
    const records = await (await fetchWithRetry(`https://www.kinomuza.pl/wp-json/wp/v2/movie?slug=${encodeURIComponent(slug)}&_embed=1`)).json();
    const record = records[0];
    modified = record?.modified || "";
    imageUrl = muzaFeaturedImage(record) || imageUrl;
    if (!movie.external?.filmweb?.posterUrl && record?.id) {
      try {
        const attachments = await (await fetchWithRetry(
          `https://www.kinomuza.pl/wp-json/wp/v2/media?parent=${record.id}&per_page=100&_fields=slug,title,source_url,media_details`,
        )).json();
        imageUrl = chooseMuzaPoster(attachments) || imageUrl;
      } catch (error) {
        console.warn(`Plakat Muzy ${movie.title}: ${error.message}`);
      }
    }
    if (previous?.description && modified && previous.modified === modified && imageUrl) {
      return { ...previous, version: DETAILS_VERSION, checkedAt, imageUrl };
    }
  } catch (error) {
    if (previous?.description) return { ...previous, version: DETAILS_VERSION, checkedAt, imageUrl };
    console.warn(`Muza REST ${movie.title}: ${error.message}`);
  }

  try {
    const html = await (await fetchWithRetry(movie.movieLink)).text();
    const description = extractMuzaLongDescription(html);
    return {
      version: DETAILS_VERSION,
      checkedAt,
      modified,
      description: description || previous?.description || movie.description || "",
      imageUrl: usableImageUrl(imageUrl) || extractMuzaImageUrl(html),
    };
  } catch (error) {
    console.warn(`Opis Muzy ${movie.title}: ${error.message}`);
    return previous
      ? { ...previous, version: DETAILS_VERSION, checkedAt, imageUrl: usableImageUrl(imageUrl) }
      : { version: DETAILS_VERSION, checkedAt, modified, description: movie.description || "", imageUrl };
  }
}

export async function enrichMuzaDetails(days, { cacheDirectory = ".cache" } = {}) {
  await mkdir(cacheDirectory, { recursive: true });
  const cachePath = join(cacheDirectory, "muza-details.json");
  const cache = await loadJson(cachePath, { entries: {} });
  const movies = [...new Map(days.flatMap((day) => day.repertoire).filter((movie) => movie.movieLink).map((movie) => [movie.movieLink, movie])).entries()];
  const refreshed = await mapConcurrent(movies, 3, async ([url, movie]) => [url, await refreshMovie(movie, cache.entries[url])]);
  cache.entries = { ...cache.entries, ...Object.fromEntries(refreshed) };
  cache.updatedAt = new Date().toISOString();
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);

  for (const day of days) {
    for (const movie of day.repertoire) {
      movie.longDescription = cache.entries[movie.movieLink]?.description || movie.description || "";
      movie.muzaPosterUrl = usableImageUrl(cache.entries[movie.movieLink]?.imageUrl);
    }
  }
  return days;
}
