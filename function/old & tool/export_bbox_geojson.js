import fs from "fs";
import path from "path";
import readline from "readline";

import streamChain from "stream-chain";
const { chain } = streamChain;

import streamJson from "stream-json";
const { parser } = streamJson;

import pickPkg from "stream-json/filters/Pick.js";
const { pick } = pickPkg;

import streamArrayPkg from "stream-json/streamers/StreamArray.js";
const { streamArray } = streamArrayPkg;

// =====================
// 1) Your constants
// =====================
const SCALE = 100000.0;

// 相机参数（按你前端逻辑）
const dist = 20000;

// 你前端的中心点（lon0/lat0）
const lon0 = -122.29499816894531;
const lat0 = 47.575477600097656;

// 需要你按前端真实值设置（这里给常见默认）
const fov = (60 * Math.PI) / 180; // 60deg
const aspect = 16 / 9;            // 如果你 canvas 不是 16:9，改成 width/height

// 你前端的 SAFETY
const SAFETY = 2.5;

// =====================
// 2) Compute bbox (same as frontend)
// =====================
const halfHeightWorld = Math.tan(fov / 2) * dist;
const halfWidthWorld = halfHeightWorld * aspect;

const halfLon = halfWidthWorld / SCALE;
const halfLat = halfHeightWorld / SCALE;

const bbox = {
    minLon: lon0 - halfLon * SAFETY,
    maxLon: lon0 + halfLon * SAFETY,
    minLat: lat0 - halfLat * SAFETY,
    maxLat: lat0 + halfLat * SAFETY,
};

console.log("Computed bbox:", bbox);

// =====================
// 3) Find input files
// =====================
const DATA_DIR = path.resolve("../data");

// 只筛 buildings（和你后端一致）
const AREA_FILES = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".geojson") && f.includes("_a_"))
    .map((f) => path.join(DATA_DIR, f));

console.log("AREA_FILES:", AREA_FILES.map((p) => path.basename(p)));

if (AREA_FILES.length === 0) {
    console.error("No _a_*.geojson files found in:", DATA_DIR);
    process.exit(1);
}

// =====================
// 4) bbox utils (same logic as your backend)
// =====================
const bbox_intersect = (a, b) => {
    return !(
        a.maxLon < b.minLon ||
        a.minLon > b.maxLon ||
        a.maxLat < b.minLat ||
        a.minLat > b.maxLat
    );
};

const bbox_compute = (geometry) => {
    let minLon = +Infinity, minLat = +Infinity;
    let maxLon = -Infinity, maxLat = -Infinity;

    const visit = ([lon, lat]) => {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    };

    if (geometry?.type === "Polygon") {
        geometry.coordinates.forEach((ring) => ring.forEach(visit));
    } else if (geometry?.type === "MultiPolygon") {
        geometry.coordinates.forEach((poly) =>
            poly.forEach((ring) => ring.forEach(visit))
        );
    } else {
        return null;
    }

    return { minLon, minLat, maxLon, maxLat };
};

// =====================
// 5) Export: merge all matched features into ONE file
// =====================
async function exportOneFile(inputPath, bbox) {
    const baseName = path.basename(inputPath, ".geojson");
    const OUTPUT_DIR = path.resolve(DATA_DIR, "data_new");

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const outPath = path.resolve(OUTPUT_DIR, `${baseName}_seattle.geojson`);
    console.log("Exporting:", baseName);

    const totalBytes = fs.statSync(inputPath).size;

    const out = fs.createWriteStream(outPath, { encoding: "utf8" });
    out.write(`{"type":"FeatureCollection","features":[\n`);

    let first = true;
    let total = 0;
    let kept = 0;

    // --- progress helpers ---
    const barWidth = 28;
    const spinnerFrames = ["|", "/", "-", "\\"];
    let spinnerIdx = 0;

    const startTime = Date.now();

    const formatBytes = (n) => {
        const units = ["B", "KB", "MB", "GB"];
        let i = 0;
        let x = n;
        while (x >= 1024 && i < units.length - 1) {
            x /= 1024;
            i++;
        }
        return `${x.toFixed(i === 0 ? 0 : 1)}${units[i]}`;
    };

    const formatTime = (sec) => {
        if (!isFinite(sec) || sec < 0) return "--:--";
        sec = Math.floor(sec);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };

    const renderProgress = (bytesRead) => {
        const now = Date.now();
        const elapsedSec = (now - startTime) / 1000;

        const pct = totalBytes > 0 ? Math.min(1, bytesRead / totalBytes) : 0;
        const filled = Math.round(pct * barWidth);
        const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

        const speed = elapsedSec > 0 ? bytesRead / elapsedSec : 0; // B/s
        const remaining = totalBytes - bytesRead;
        const etaSec = speed > 0 ? remaining / speed : Infinity;

        const spin = spinnerFrames[spinnerIdx++ % spinnerFrames.length];

        const line =
            `${spin} ${baseName} ` +
            `${String((pct * 100).toFixed(1)).padStart(5, " ")}% ` +
            `[${bar}] ` +
            `${formatBytes(bytesRead)}/${formatBytes(totalBytes)} ` +
            `| ${formatBytes(speed)}/s ` +
            `| ETA ${formatTime(etaSec)} ` +
            `| kept ${kept}`;

        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(line);
    };

    return new Promise((resolve, reject) => {
        // ⭐关键：把 readStream 单独拿出来，才能读 bytesRead
        const rs = fs.createReadStream(inputPath);

        const pipeline = chain([
            rs,
            parser(),
            pick({ filter: "features" }),
            streamArray(),
        ]);

        // ⭐每 200ms 刷一次（不要在每个 feature 刷，会很慢）
        const timer = setInterval(() => {
            renderProgress(rs.bytesRead);
        }, 200);

        pipeline.on("data", ({ value: feature }) => {
            total++;

            const fb = bbox_compute(feature.geometry);
            if (!fb || !bbox_intersect(fb, bbox)) return;

            if (!first) out.write(",\n");
            first = false;

            out.write(JSON.stringify(feature));
            kept++;
        });

        pipeline.on("end", () => {
            clearInterval(timer);
            // 最后一刷到 100%
            renderProgress(totalBytes);

            out.write(`\n]}\n`);
            out.end();

            // 换行+最终摘要
            process.stdout.write("\n");
            console.log(`Done: ${baseName} | total=${total} kept=${kept} | out=${path.basename(outPath)}`);
            resolve();
        });

        pipeline.on("error", (err) => {
            clearInterval(timer);
            process.stdout.write("\n");
            reject(err);
        });
    });
}

// =====================
// 6) Run
// =====================
(async () => {
    for (const f of AREA_FILES) {
        await exportOneFile(f, bbox);
    }
    console.log("All layers done.");
})();