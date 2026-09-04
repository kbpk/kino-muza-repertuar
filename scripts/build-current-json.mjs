import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DATA_DIRECTORY = fileURLToPath(new URL("../public/data/", import.meta.url));
const index = JSON.parse(await readFile(`${DATA_DIRECTORY}index.json`, "utf8"));

if (!Array.isArray(index.currentDates)) throw new Error("Brak currentDates w data/index.json");

const days = await Promise.all(index.currentDates.map(async (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Nieprawidłowa data: ${date}`);
  const payload = JSON.parse(await readFile(`${DATA_DIRECTORY}days/${date}.json`, "utf8"));
  if (!payload?.day || !Array.isArray(payload.day.repertoire)) throw new Error(`Nieprawidłowe dane dnia: ${date}`);
  return payload.day;
}));

const repertoire = {
  schemaVersion: 1,
  fetchedAt: index.fetchedAt,
  source: index.source,
  days,
};

await writeFile(`${DATA_DIRECTORY}repertoire.json`, `${JSON.stringify(repertoire)}\n`);
console.log(`Zbudowano data/repertoire.json: ${days.length} dni.`);
