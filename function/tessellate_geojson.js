import fs from "fs";
import path from "path";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

import streamChain from "stream-chain";
const { chain } = streamChain

import streamJson from "stream-json";
const { parser } = streamJson

import pickPkg from "stream-json/filters/Pick.js";
const { pick } = pickPkg

import streamArrayPkg from "stream-json/streamers/StreamArray.js";
const { streamArray } = streamArrayPkg

import { geojsonToIndices } from "./algorithm/earcut.js";

import * as h3 from "h3-js";

import readline from "readline";

async function readNdjsonTile(filePath, onFeature) {
    const rs = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });

    for await (const line of rl) {
        if (!line) continue;
        const feature = JSON.parse(line);
        await onFeature(feature); // 这里面跑 earcut + ws.send
    }
}

const TILE_ROOT = path.resolve("../data_hex_tiles");

function tileFile(layer, res, h3id) {
    return path.join(TILE_ROOT, layer, `r${res}`, `${h3id}.ndjson`);
}

function bboxToGeoJsonPolygon(b) {
    // h3-js 通常吃 GeoJSON polygon： [ [ [lon,lat], ... ] ]
    return {
        type: "Polygon",
        coordinates: [[
            [b.minLon, b.minLat],
            [b.maxLon, b.minLat],
            [b.maxLon, b.maxLat],
            [b.minLon, b.maxLat],
            [b.minLon, b.minLat],
        ]],
    };
}

function h3idsForBbox(bbox, res) {
    const poly = bboxToGeoJsonPolygon(bbox);

    // polygonToCells 需要的是 coordinates（数组），不是 {type,coordinates} 对象
    if (h3.polygonToCells) {
        // 第3个参数 true：表示输入是 GeoJSON 格式（[lon,lat]）
        return h3.polygonToCells(poly.coordinates, res, true);
    }

    // 旧版本兼容（一般 polyfill 接受 GeoJSON 对象）
    return h3.polyfill(poly, res, true);
}

const server = http.createServer()
const wss = new WebSocketServer({ server })
server.listen(8080, () => {
    console.log("WS server: ws://localhost: 8080")
})

wss.on("connection", (ws) => {
    console.log("client connected")

    let pipeline = null
    let running = false
    let abort = false

    const stopPipeline = () => {
        abort = true
        if (pipeline) pipeline.destroy()
        pipeline = null
        running = false
    }

    ws.on("message", async (raw) => {
        let msg
        try {
            msg = JSON.parse(raw.toString())
        } catch {
            ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
            return
        }

        if (msg.type === "start") {
            if (running) return;

            const bbox = msg.bbox ?? null;
            const RES = msg.res ?? 7;
            const layer = msg.layer ?? "gis_osm_buildings_a_free_1";

            if (!bbox || bbox.minLon == null) {
                ws.send(JSON.stringify({ type: "error", message: "bbox invalid" }));
                running = false;
                return;
            }

            abort = false;
            running = true;

            const state = { sent: 0, errors: 0 };

            // bbox 中心
            const centerLon = (bbox.minLon + bbox.maxLon) / 2;
            const centerLat = (bbox.minLat + bbox.maxLat) / 2;

            // ✅ 1) bbox 内所有 tiles（数组）
            const tiles = h3idsForBbox(bbox, RES);

            // ✅ 2) tiles 按“距离中心”由近到远排序
            const tileDist2 = (h3id) => {
                const [lat, lon] = h3.cellToLatLng(h3id); // 返回 [lat, lon]
                const dx = lon - centerLon;
                const dy = lat - centerLat;
                return dx * dx + dy * dy;
            };
            tiles.sort((a, b) => tileDist2(a) - tileDist2(b));

            ws.send(JSON.stringify({
                type: "status",
                message: "started",
                tiles: tiles.length,
            }));

            // ===== batching state =====
            let batch = [];
            let batchBytes = 0;
            let flushTimer = null;
            let flushing = false;

            // tune these
            const MAX_ITEMS = 100_000_000;             // 你原来的 500 OK
            const MAX_BYTES = 2_000_000;       // 1MB 左右一包（建议加）
            const MAX_DELAY_MS = 1_000;           // 你原来的 50ms OK
            const BACKPRESSURE_HIGH = 8_000_000; // 8MB：开始等
            const BACKPRESSURE_LOW = 2_000_000; // 2MB：恢复发

            function scheduleFlush() {
                if (flushTimer) return;
                flushTimer = setTimeout(() => {
                    flushTimer = null;
                    void flushBatch();
                }, MAX_DELAY_MS);
            }

            async function waitBackpressure() {
                // ws 没有 drain 事件，只能轮询 bufferedAmount
                if (ws.bufferedAmount <= BACKPRESSURE_HIGH) return;
                while (ws.bufferedAmount > BACKPRESSURE_LOW) {
                    await new Promise(r => setTimeout(r, 5));
                }
            }

            async function flushBatch() {
                if (flushing) return;
                if (batch.length === 0) return;

                flushing = true;
                try {
                    await waitBackpressure();

                    const payload = {
                        type: "batch",
                        layer,
                        // 可选：如果你想按 tile 分组，这里也可以带 h3id（前提：batch 里同 tile）
                        features: batch,
                    };

                    ws.send(JSON.stringify(payload));

                    batch = [];
                    batchBytes = 0;
                } finally {
                    flushing = false;
                }
            }

            function pushToBatch(featureObj) {
                // 粗略估算 bytes：宁愿估大一点触发 flush，也别估小导致包太大
                const approx = featureObj._bytes ?? 0; // 你也可以不传，用 JSON 长度估算
                batch.push(featureObj);
                batchBytes += approx;

                if (batch.length >= MAX_ITEMS || batchBytes >= MAX_BYTES) {
                    void flushBatch(); // 立刻 flush（不用等 timer）
                } else {
                    scheduleFlush();   // 走 timer flush
                }
            }

            // ✅ 3) 一次只读 1 个 tile，读到就发（tile 内不排序）
            for (const h3id of tiles) {
                if (abort) break;

                const filePath = tileFile(layer, RES, h3id);
                if (!fs.existsSync(filePath)) continue;

                await readNdjsonTile(filePath, async (feature) => {
                    if (abort) return;

                    try {
                        // const parts = geojsonToIndices(feature);

                        // ws.send(JSON.stringify({ type: "feature", layer, h3id, parts }));
                        // state.sent++;
                        const parts = geojsonToIndices(feature);

                        // 估算大小：最简单就是 stringify 一下取 length（会多一点 CPU，但比每条 send 省太多）
                        // 更省 CPU 的方式是根据数组长度粗估：例如 positions/indices 长度 * 4 bytes 等
                        const obj = { h3id, parts };
                        obj._bytes = JSON.stringify(obj).length;

                        pushToBatch(obj);
                        state.sent++;

                        // ✅ 可选：简单背压，防止发太快撑爆内存（10MB 阈值你可调）
                        if (ws.bufferedAmount > 10_000_000) {
                            await new Promise(r => setTimeout(r, 5));
                        }
                    } catch (e) {
                        state.errors++;
                    }
                });
            }

            await flushBatch();
            ws.send(JSON.stringify({
                type: "status",
                message: abort ? "stopped" : "completed",
                sent: state.sent,
                errors: state.errors,
            }));

            running = false;
            return;
        }

        if (msg.type == "stop") {
            stopPipeline()
            ws.send(JSON.stringify({ type: "status", message: "stopped" }))
            return
        }

        ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }))
    })

    ws.on("close", () => {
        console.log("client disconnected")
        stopPipeline()
    })
})
