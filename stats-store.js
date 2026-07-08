import { Storage } from "@google-cloud/storage";
import { createLogger } from "./utils.js";

const log = createLogger(import.meta.url);

const BUCKET_NAME = process.env.GCP_STATS_BUCKET;
let storage;

function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

function dateKey(date, tenantId) {
  return `stats/${tenantId}/${date}.json`;
}

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

async function readDayStats(tenantId, date) {
  try {
    const [content] = await getStorage().bucket(BUCKET_NAME).file(dateKey(date, tenantId)).download();
    return JSON.parse(content.toString());
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

function emptyDay(tenantId, date) {
  return {
    date,
    tenantId,
    requestCount: 0,
    totalInputChars: 0,
    totalOutputTokens: 0,
    byEndpoint: {},
  };
}

export async function recordStat(tenantId, endpoint, inputChars, outputTokens) {
  if (!BUCKET_NAME) return;
  try {
    const date = todayDate();
    const stats = (await readDayStats(tenantId, date)) ?? emptyDay(tenantId, date);

    stats.requestCount++;
    stats.totalInputChars += inputChars;
    stats.totalOutputTokens += outputTokens;

    const ep = stats.byEndpoint[endpoint] ?? { count: 0, inputChars: 0, outputTokens: 0 };
    ep.count++;
    ep.inputChars += inputChars;
    ep.outputTokens += outputTokens;
    stats.byEndpoint[endpoint] = ep;

    await getStorage()
      .bucket(BUCKET_NAME)
      .file(dateKey(date, tenantId))
      .save(JSON.stringify(stats), { contentType: "application/json" });
  } catch (err) {
    log.error(`Failed to record stat for ${tenantId}: ${err.message}`);
  }
}

export async function getAllStats(tenantIds, days = 30) {
  if (!BUCKET_NAME) return { tenants: tenantIds, stats: {} };

  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split("T")[0];
  });

  const result = {};
  await Promise.all(
    tenantIds.map(async (tenantId) => {
      const rows = await Promise.all(dates.map((date) => readDayStats(tenantId, date)));
      result[tenantId] = rows.filter(Boolean);
    })
  );

  return { tenants: tenantIds, stats: result };
}