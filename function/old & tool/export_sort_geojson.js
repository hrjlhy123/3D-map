import fs from "fs";
import path from "path";

import pkg from "stream-json";
import streamers from "stream-json/streamers/StreamArray.js";
import filters from "stream-json/filters/Pick.js";

const { parser } = pkg;
const { streamArray } = streamers;
const { pick } = filters;

const inputDir = "../data";
const outputDir = "./data_new";

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

const files = fs.readdirSync(inputDir)
    .filter(f => f.endsWith(".geojson") && f.includes("_a_"));

console.log(`Found ${files.length} files to sort.\n`);

function scanCoords(coords, cb) {
    if (!coords) return;
    if (typeof coords[0] === "number") {
        // [lon, lat, ...]
        cb(coords[0], coords[1]);
        return;
    }
    for (const c of coords) scanCoords(c, cb);
}

function getCenter(feature) {
    const g = feature?.geometry;
    if (!g?.coordinates) return null;

    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    let count = 0;

    scanCoords(g.coordinates, (lon, lat) => {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        count++;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    });

    if (count === 0) return null;

    return {
        lon: (minLon + maxLon) / 2,
        lat: (minLat + maxLat) / 2,
    };
}

function renderProgress(percent, etaSeconds) {
    const barLength = 30;
    const filled = Math.floor(percent * barLength);
    const empty = barLength - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);

    process.stdout.write(
        `\r[${bar}] ${(percent * 100).toFixed(1)}% | ETA: ${etaSeconds.toFixed(1)}s`
    );
}

async function processFile(file) {
    return new Promise((resolve, reject) => {

        const filePath = path.join(inputDir, file);
        const stats = fs.statSync(filePath);
        const totalSize = stats.size;

        let processedBytes = 0;
        let lastRender = Date.now();
        const startTime = Date.now();

        const features = [];

        console.log(`Sorting ${file}`);

        const readStream = fs.createReadStream(filePath);

        readStream.on("data", chunk => {
            processedBytes += chunk.length;

            const now = Date.now();
            if (now - lastRender > 200) {
                const percent = processedBytes / totalSize;
                const elapsed = (now - startTime) / 1000;
                const speed = processedBytes / elapsed;
                const remainingBytes = totalSize - processedBytes;
                const eta = remainingBytes / speed;

                renderProgress(percent, eta);
                lastRender = now;
            }
        });

        const pipeline = readStream
            .pipe(parser())
            .pipe(pick({ filter: "features" }))
            .pipe(streamArray());

        pipeline.on("data", ({ value }) => {
            const center = getCenter(value);
            if (!center) return; // 跳过坏数据
            features.push({ feature: value, ...center });
        });

        pipeline.on("end", () => {

            process.stdout.write("\nSorting in memory...\n");

            features.sort((a, b) => {
                if (a.lat !== b.lat) {
                    return b.lat - a.lat; // North → South
                }
                return a.lon - b.lon;     // West → East
            });

            console.log("Writing sorted file...");

            const outputPath = path.join(outputDir, file);
            const writeStream = fs.createWriteStream(outputPath);

            writeStream.write('{"type":"FeatureCollection","features":[\n');

            for (let i = 0; i < features.length; i++) {
                const json = JSON.stringify(features[i].feature);

                if (i < features.length - 1) {
                    writeStream.write(json + ",\n");
                } else {
                    writeStream.write(json + "\n");
                }

                if (i % 10000 === 0) {
                    process.stdout.write(`\rWritten ${i}/${features.length}`);
                }
            }

            writeStream.write("]}");
            writeStream.end();

            writeStream.on("finish", () => {
                console.log(`\nFinished ${file}\n`);
                resolve();
            });
        });

        pipeline.on("error", reject);
    });
}

(async () => {
    for (const file of files) {
        await processFile(file);
    }
    console.log("All files sorted successfully.");
})();