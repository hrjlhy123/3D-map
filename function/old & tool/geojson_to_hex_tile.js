import fs from "fs";
import path from "path";
import { chain } from "stream-chain";

import streamJsonPkg from "stream-json";
import pickPkg from "stream-json/filters/Pick.js";
import streamArrayPkg from "stream-json/streamers/StreamArray.js";

import * as h3 from "h3-js";

const { parser } = streamJsonPkg;
const { pick } = pickPkg;
const { streamArray } = streamArrayPkg;

// 你可以改这里
const INPUT_DIR = path.resolve("../data_new");          // 你的 geojson 来源目录
const OUTPUT_DIR = path.resolve("../hex_tiles");        // 输出目录
const RES = 7;                                          // 六边形分辨率（折中）
const FLUSH_EVERY = 5000;                               // 每个 tile 缓存多少条就落盘一次（防止内存涨）

function scanCoords(coords, cb) {
  if (!coords) return;
  if (typeof coords[0] === "number") {
    cb(coords[0], coords[1]);
    return;
  }
  for (const c of coords) scanCoords(c, cb);
}

function getCenterSafe(feature) {
  const g = feature?.geometry;
  if (!g?.coordinates) return null;

  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  scanCoords(g.coordinates, (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  if (!Number.isFinite(minLon)) return null;

  return { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 };
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// 把 tile 文件组织成：../hex_tiles/<layer>/r<res>/<h3id>.ndjson
// （这里用 NDJSON 写入最省事；你仍然“逻辑上用 GeoJSON Feature”，只是存储为逐行 JSON，方便追加写入）
function tilePath(layerName, h3id) {
  const dir = path.join(OUTPUT_DIR, layerName, `r${RES}`);
  ensureDir(dir);
  return path.join(dir, `${h3id}.ndjson`);
}

async function processOneFile(file) {
  const inPath = path.join(INPUT_DIR, file);
  const layerName = file.replace(".geojson", "");

  const stat = fs.statSync(inPath);
  const totalBytes = stat.size;
  let processedBytes = 0;
  let lastPrint = 0;

  console.log(`\nTiling ${file} -> layer=${layerName}, res=${RES}`);
  console.log(`File size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  const input = fs.createReadStream(inPath, { encoding: "utf8" });

  input.on("data", (chunk) => {
    processedBytes += chunk.length;

    const percent = processedBytes / totalBytes;
    const now = Date.now();

    // 每 300ms 更新一次，避免刷屏
    if (now - lastPrint > 300) {
      const barLength = 30;
      const filled = Math.floor(percent * barLength);
      const bar =
        "█".repeat(filled) +
        "░".repeat(barLength - filled);

      process.stdout.write(
        `\r[${bar}] ${(percent * 100).toFixed(1)}%`
      );

      lastPrint = now;
    }
  });

  const pipeline = chain([
    input,
    parser(),
    pick({ filter: "features" }),
    streamArray(),
  ]);

  const buckets = new Map();
  let total = 0;

  function flushBucket(h3id) {
    const arr = buckets.get(h3id);
    if (!arr || arr.length === 0) return;

    const outPath = tilePath(layerName, h3id);
    fs.appendFileSync(outPath, arr.join(""), "utf8");
    arr.length = 0;
  }

  function flushAll() {
    for (const [h3id] of buckets) flushBucket(h3id);
  }

  return new Promise((resolve, reject) => {
    pipeline.on("data", ({ value: feature }) => {
      const c = getCenterSafe(feature);
      if (!c) return;

      const h3id = h3.latLngToCell(c.lat, c.lon, RES);

      feature.properties ??= {};
      feature.properties.__cLat = c.lat;
      feature.properties.__cLon = c.lon;
      feature.properties.__h3 = h3id;

      const line = JSON.stringify(feature) + "\n";

      let arr = buckets.get(h3id);
      if (!arr) {
        arr = [];
        buckets.set(h3id, arr);
      }
      arr.push(line);
      total++;

      if (arr.length >= FLUSH_EVERY) flushBucket(h3id);
    });

    pipeline.on("end", () => {
      flushAll();
      process.stdout.write("\n");
      console.log(`✓ Done. Total features: ${total}`);
      resolve();
    });

    pipeline.on("error", reject);
  });
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => f.endsWith(".geojson") && f.includes("_a_"));

  console.log(`Found ${files.length} files.`);
  for (const f of files) {
    await processOneFile(f);
  }

  console.log("\nAll tiling done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});