import fs from "fs";
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
// import { type } from "os";

const GEOJSON_PATH = "../data/gis_osm_buildings_a_free_1.geojson"

const server = http.createServer()
const wss = new WebSocketServer({ server })
server.listen(8080, () => {
    console.log("WS server: ws://localhost: 8080")
})

wss.on("connection", (ws) => {
    console.log("client connected")

    let pipeline = null
    let running = false

    ws.on("message", (raw) => {
        let msg
        try {
            msg = JSON.parse(raw.toString())
        } catch {
            ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
            return
        }

        if (msg.type === "start") {
            if (running) {
                return
            }

            const limit = Number(msg.limit ?? 50)
            const sample = Number(msg.sample ?? 5) // 0 表示不限制推送内容大小
            running = true

            ws.send(JSON.stringify({ type: "status", message: "started", limit }))

            let i = 0

            pipeline = chain([
                fs.createReadStream(GEOJSON_PATH),
                parser(),
                pick({ filter: "features" }),
                streamArray(),
            ])

            pipeline.on("data", ({ value: feature }) => {
                if (ws.readyState != WebSocket.OPEN) {
                    pipeline.destroy()
                    return
                }
                if (i >= limit) {
                    ws.send(
                        JSON.stringify({
                            type: "done"
                        })
                    )
                    console.log(`Reached limit of ${limit}, done.`)
                    pipeline.destroy()
                    return
                }

                try {
                    const parts = geojsonToIndices(feature)

                    // ⚠️ 最简单：直接推送 earcut 结果（parts 可能很大）
                    // 更稳：只推送统计信息，必要时再按需推 parts
                    const payload = sample && i >= sample
                        ? {
                            // 推轻量版
                            type: "feature",
                            index: i,
                            name: feature.properties?.name ?? "(no name)",
                            geomType: feature.geometry?.type,
                            verts: parts.reduce((s, p) => s + p.data.length / 2, 0),
                            tris: parts.reduce((s, p) => s + p.indices.length / 3, 0)
                        } : {
                            // 推完整版
                            type: "feature",
                            index: i,
                            name: feature.properties?.name ?? "(no name)",
                            geomType: feature.geometry?.type,
                            parts,
                        }
                    ws.send(JSON.stringify(payload))
                } catch (e) {
                    ws.send(
                        JSON.stringify({
                            type: "feature_error",
                            index: i,
                            message: e?.message ?? String(e),
                        })
                    )
                }

                i++
            })

            pipeline
                .on('end', () => {
                    running = false
                    ws.send(JSON.stringify({ type: "status", message: "completed" }))
                })
                .on("error", (err) => {
                    running = false
                    if (String(err?.code) == "ERR_STREAM_PREMATURE_CLOSE") {
                        ws.send(JSON.stringify({ type: "status", message: "stopped" }))
                        return
                    }
                    ws.send(
                        JSON.stringify({ type: "error", message: err?.message ?? String(err) })
                    )
                })

            return
        }

        if (msg.type == "stop") {
            if (pipeline) {
                pipeline.destroy()
            }
            pipeline = null
            running = false
            ws.send(JSON.stringify({ type: "status", message: "stopped" }))
            return
        }

        ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }))
    })

    ws.on("close", () => {
        console.log("client disconnected")
        if (pipeline) {
            pipeline.destroy()
        }
    })
})
