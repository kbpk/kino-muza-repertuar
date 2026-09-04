import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expectedRepertoireUpdate, isRepertoireStale } from "../public/lib.js";

export function updateScheduleDecision(eventName, fetchedAt, now = new Date()) {
  if (eventName !== "schedule") return { run: true, target: null };
  const target = expectedRepertoireUpdate(now, 0);
  return {
    run: isRepertoireStale(fetchedAt, now, 0),
    target,
  };
}

async function main() {
  const eventName = process.env.EVENT_NAME || "";
  let fetchedAt = "";
  if (eventName === "schedule") {
    const index = JSON.parse(await readFile("public/data/index.json", "utf8"));
    fetchedAt = index.fetchedAt || "";
  }

  const decision = updateScheduleDecision(eventName, fetchedAt);
  process.stdout.write(`run=${decision.run}\n`);
  if (!decision.target) {
    console.error("Ręczne uruchomienie - aktualizacja jest wymagana.");
  } else if (decision.run) {
    console.error(`Aktualizacja ${decision.target.key} jest wymagana (ostatnia: ${fetchedAt || "brak"}).`);
  } else {
    console.error(`Aktualizacja ${decision.target.key} już istnieje (ostatnia: ${fetchedAt}).`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
