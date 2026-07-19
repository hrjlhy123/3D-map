import fs from "fs";
import path from "path";
import cliProgress from "cli-progress";

import { chain } from "stream-chain";

import streamJsonPkg from "stream-json";
import pickPkg from "stream-json/filters/Pick.js";
import streamArrayPkg from "stream-json/streamers/StreamArray.js";

const { parser } = streamJsonPkg;
const { pick } = pickPkg;
const { streamArray } = streamArrayPkg;


const INPUT_DIR = path.resolve("../data_new");
const OUTPUT_DIR = path.resolve("../data_new_ndjson");

// indexing rules
const INDEX_MIN_N = 50000;
const TARGET_ENTRIES = 1000;
const MIN_STEP = 500;
const MAX_STEP = 20000;

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

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

  return {
    cLon: (minLon + maxLon) / 2,
    cLat: (minLat + maxLat) / 2,
  };
}

function makePipeline(inputStream) {
  return chain([
    inputStream,
    parser(),
    pick({ filter: "features" }),
    streamArray(),
  ]);
}

async function countFeatures(inPath, totalSize, fileLabel) {
  console.log(`Counting features: ${fileLabel}`);

  const bar = new cliProgress.SingleBar({
    format: "[COUNT] [{bar}] {percentage}% | {value}/{total} bytes",
  });
  bar.start(totalSize, 0);

  const input = fs.createReadStream(inPath, { encoding: "utf8" });
  input.on("data", () => bar.update(input.bytesRead));

  const pipeline = makePipeline(input);

  let N = 0;

  return new Promise((resolve, reject) => {
    pipeline.on("data", () => {
      N++;
    });

    pipeline.on("end", () => {
      bar.stop();
      resolve(N);
    });

    pipeline.on("error", (err) => {
      bar.stop();
      reject(err);
    });
  });
}

async function writeNdjsonAndIndex(inPath, outPath, totalSize, fileLabel, stepOrNull) {
  const buildIndex = Number.isFinite(stepOrNull);
  const outIndexPath = outPath + ".index.json";

  console.log(
    `Writing NDJSON: ${fileLabel}` +
      (buildIndex ? ` | index step=${stepOrNull}` : " | no index")
  );

  const bar = new cliProgress.SingleBar({
    format: "[WRITE] [{bar}] {percentage}% | {value}/{total} bytes",
  });
  bar.start(totalSize, 0);

  const input = fs.createReadStream(inPath, { encoding: "utf8" });
  const output = fs.createWriteStream(outPath, { encoding: "utf8" });

  input.on("data", () => bar.update(input.bytesRead));

  const pipeline = makePipeline(input);

  let offset = 0;
  let count = 0;

  // only allocate entries if we are building index
  const entries = buildIndex ? [] : null;

  return new Promise((resolve, reject) => {
    pipeline.on("data", ({ value: feature }) => {
      const center = getCenterSafe(feature);
      if (center) {
        feature.properties ??= {};
        feature.properties.__cLat = center.cLat;
        feature.properties.__cLon = center.cLon;
      }

      if (buildIndex && count % stepOrNull === 0) {
        const cLat = feature.properties?.__cLat;
        entries.push({
          i: count,
          offset,
          cLat: Number.isFinite(cLat) ? cLat : null,
        });
      }

      const line = JSON.stringify(feature) + "\n";
      offset += Buffer.byteLength(line, "utf8");
      count++;

      if (!output.write(line)) {
        pipeline.pause();
        output.once("drain", () => pipeline.resume());
      }
    });

    pipeline.on("end", () => {
      output.end();
      bar.stop();

      if (buildIndex) {
        fs.writeFileSync(
          outIndexPath,
          JSON.stringify({ step: stepOrNull, count, entries }, null, 2),
          "utf8"
        );
      } else {
        // 如果之前生成过旧索引，顺手清掉（可选）
        if (fs.existsSync(outIndexPath)) fs.unlinkSync(outIndexPath);
      }

      console.log(`✓ Wrote ${count} features -> ${path.basename(outPath)}`);
      resolve();
    });

    pipeline.on("error", (err) => {
      bar.stop();
      output.destroy();
      reject(err);
    });

    output.on("error", (err) => {
      bar.stop();
      pipeline.destroy(err);
      reject(err);
    });
  });
}

async function processFile(file) {
  const inPath = path.join(INPUT_DIR, file);
  const outPath = path.join(OUTPUT_DIR, file.replace(".geojson", ".ndjson"));

  const stat = fs.statSync(inPath);
  const totalSize = stat.size;

  console.log(`\nProcessing ${file}`);

  // pass 1: count N
  const N = await countFeatures(inPath, totalSize, file);

  // decide index
  let step = null;
  if (N >= INDEX_MIN_N) {
    step = clamp(Math.floor(N / TARGET_ENTRIES), MIN_STEP, MAX_STEP);
  }

  console.log(`N=${N} => ${step ? `build index (step=${step})` : "no index"}`);

  // pass 2: write ndjson (+ optional index)
  await writeNdjsonAndIndex(inPath, outPath, totalSize, file, step);
}

async function main() {
  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => f.endsWith(".geojson") && f.includes("_a_"));

  console.log(`Found ${files.length} files to convert.`);

  for (const file of files) {
    await processFile(file);
  }

  console.log("\nAll done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});