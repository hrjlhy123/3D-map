import fs from "fs";

import streamChain from "stream-chain";
const { chain } = streamChain

import streamJson from "stream-json";
const { parser } = streamJson

import pickPkg from "stream-json/filters/Pick.js";
const { pick } = pickPkg

import streamArrayPkg from "stream-json/streamers/StreamArray.js";
const { streamArray } = streamArrayPkg

import { geojsonToIndices } from "../algorithm/function/earcut.js";

const GEOJSON_PATH = "../data/gis_osm_buildings_a_free_1.geojson"
const LIMIT = 50
const results = []

let i = 0

const pipeline = chain([
    fs.createReadStream(GEOJSON_PATH),
    parser(),
    pick({ filter: "features" }),
    streamArray(),
])

pipeline.on("data", ({ value: feature }) => {
    if (i >= LIMIT) {
        pipeline.destroy();

        console.log("=== first 5 earcut results ===");
        console.dir(results, { depth: null });

        return;
    }

    try {
        const parts = geojsonToIndices(feature)

        if (i < 5) {
            results.push({
                index: i,
                name: feature.properties?.name ?? "(no name)",
                type: feature.geometry?.type,
                parts
            })
        }

        const verts = parts.reduce((s, p) => s + p.data.length / 2, 0)
        const tris = parts.reduce((s, p) => s + p.indices.length / 3, 0)

        console.log(
            `#${i + 1} ${feature.properties?.name ?? "(no name)"} | v=${verts} t=${tris}`
        )
    } catch (e) {
        console.error(`#${i} ERROR`, e.message)
    }

    i++
})
    .on("end", () => {
        console.log("done");
    })
    .on("error", (err) => {
        if (String(err?.code) === "ERR_STREAM_PREMATURE_CLOSE") return;
        console.error("Stream error:", err);
    })