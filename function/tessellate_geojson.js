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

// const GEOJSON_PATH = "../data/gis_osm_buildings_a_free_1.geojson"
const DATA_DIR = path.resolve(`../data`);

// 1. Automatically locate all *_A_*.geojson files
const AREA_FILES = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(`.geojson`) && f.includes(`_a_`))
    .map((f) => path.join(DATA_DIR, f))

console.log(`AREA_FILES:`, AREA_FILES.map(p => path.basename(p)))

const bbox_intersect = (a, b) => {
    return !(
        a.maxLon < b.minLon ||
        a.minLon > b.maxLon ||
        a.maxLat < b.minLat ||
        a.minLat > b.maxLat
    )
}

const bbox_compute = (geometry) => {
    let minLon = +Infinity, minLat = +Infinity
    let maxLon = -Infinity, maxLat = -Infinity

    const visit = ([lon, lat]) => {
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
    }

    if (geometry.type == `Polygon`) {
        geometry.coordinates.forEach(ring => ring.forEach(visit))
    } else if (geometry.type == `MultiPolygon`) {
        geometry.coordinates.forEach(poly =>
            poly.forEach(ring => ring.forEach(visit))
        )
    } else {
        return null
    }

    return { minLon, minLat, maxLon, maxLat }
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

    // 2. read file
    const readFile = (filePath, { bbox, limit, sample }, state) => {
        const layer = path.basename(filePath).replace(`.geojson`, ``)

        ws.send(JSON.stringify({ type: `status`, message: `file_start`, layer }))

        return new Promise((resolve) => {
            pipeline = chain([
                fs.createReadStream(filePath),
                parser(),
                pick({ filter: `features` }),
                streamArray()
            ])

            pipeline.on(`data`, ({ value: feature }) => {
                if (abort || ws.readyState != WebSocket.OPEN) {
                    pipeline.destroy()
                    return
                }

                if (state.sent >= limit) {
                    ws.send(JSON.stringify({ type: `done`, sent: state.sent }))
                    pipeline.destroy()
                    return
                }

                if (bbox) {
                    const fb = bbox_compute(feature.geometry)
                    if (!fb || !bbox_intersect(fb, bbox)) return
                }

                try {
                    const parts = geojsonToIndices(feature)

                    // ⚠️ 最简单：直接推送 earcut 结果（parts 可能很大）
                    // 更稳：只推送统计信息，必要时再按需推 parts
                    const payload = sample && state.sent >= sample
                        ? {
                            // 推轻量版
                            type: "feature",
                            index: state.sent,
                            layer,
                            name: feature.properties?.name ?? "(no name)",
                            geomType: feature.geometry?.type,
                            verts: parts.reduce((s, p) => s + p.data.length / 2, 0),
                            tris: parts.reduce((s, p) => s + p.indices.length / 3, 0)
                        } : {
                            // 推完整版
                            type: "feature",
                            index: state.sent,
                            layer,
                            name: feature.properties?.name ?? "(no name)",
                            geomType: feature.geometry?.type,
                            parts,
                        }
                    ws.send(JSON.stringify(payload))
                    state.sent++
                } catch (e) {
                    ws.send(
                        JSON.stringify({
                            type: "feature_error",
                            index: state.sent,
                            layer,
                            message: e?.message ?? String(e),
                        })
                    )
                    state.errors++
                }
            })

            pipeline.on(`end`, () => {
                ws.send(JSON.stringify({ type: `status`, message: `file_end`, layer }))
                resolve()
            })

            pipeline.on(`error`, (err) => {
                // trigger by stop/destroy
                if (String(err?.code) == `ERR_STREAM_PREMATURE_CLOSE`) {
                    ws.send(JSON.stringify({ type: `status`, message: `stopped` }))
                    resolve()
                    return
                }
                ws.send(
                    JSON.stringify({
                        type: `error`,
                        message: err?.message ?? String(err),
                        layer,
                    })
                )
                resolve()
            })
        })
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
            if (running) return

            const limit = Number(msg.limit ?? 50)
            const sample = Number(msg.sample ?? 5) // 0 表示不限制推送内容大小
            const bbox = msg.bbox ?? null

            abort = false
            running = true

            ws.send(JSON.stringify({
                type: "status",
                message: "started",
                limit,
                files: AREA_FILES.map(p => path.basename(p)),
            }))

            const state = { sent: 0, errors: 0 }

            // 3. Run sequentially in file order
            for (const filePath of AREA_FILES) {
                if (abort) break
                if (state.sent >= limit) break
                await readFile(filePath, { bbox, limit, sample }, state)
            }

            ws.send(JSON.stringify({
                type: `status`,
                message: `completed`,
                sent: state.sent,
                errors: state.errors,
            }))

            return
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
