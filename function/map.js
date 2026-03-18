// import { text } from "./stream/consumers";
import { mat4, vec3 } from "../node_modules/gl-matrix/esm/index.js";

"use strict";
let canvas, ready = {
    GPU: false,
    stream: false,
    buildings: false
}
window.addEventListener(`DOMContentLoaded`, async () => {
    /* == Initialization == */
    let context, adapter, device, format_canvas, alphaMode
    let fov, aspect, near, far
    let resize, resizeCamera
    format_canvas = navigator.gpu.getPreferredCanvasFormat()
    alphaMode = `premultiplied`
    {
        {
            navigator.gpu ?? (() => {
                throw new Error(`WebGPU not supported`)
            })()

            canvas = document.querySelector(`canvas#building`) ?? (() => {
                throw new Error(`Could not access canvas`)
            })()

            context = canvas.getContext(`webgpu`) ?? (() => {
                throw new Error(`Could not obtain WebGPU context for canvas`)
            })()

            adapter = await navigator.gpu.requestAdapter() ?? (() => {
                throw new Error(`Could not obtain GPU adapter`)
            })()

            device = await adapter.requestDevice({
                requiredLimits: {
                    maxBufferSize: 536870912, // 512MB
                },
            }) ?? (() => {
                throw new Error(`Could not create GPU device`)
            })()
        }

        console.log(`Supported features:`)
        for (const feature of adapter.features) {
            console.log(` ->`, feature)
        }
    }

    /* == Data Preprocessing == */
    let GPUResources = {
        data: {
            pending: [],
            rendering: {
                vertex: [],
                indices: [],
                vertexByteOffset: 0,
                indexByteOffset: 0,
                vertexIdByteOffset: 0,
            },
        },
        buffer: {},
        bindGroup: {},
        bindGroupLayout: {},
        bufferLayout: {
            vertex: {}
        },
        pipelineLayout: null,
        renderPipeline: {},
    }

    {
        // buffer
        {
            GPUResources.buffer.camera = device.createBuffer({
                size: 128, // 2 x mat4x4 = 2 x 64 bytes
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
            GPUResources.buffer.transform = device.createBuffer({
                size: 64, // 1 x mat4x4 = 64 bytes
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            })
            GPUResources.buffer.identity = device.createBuffer({
                size: 64, // 1 x mat4x4 = 64 bytes
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
            GPUResources.buffer.vertex = device.createBuffer({
                size: 536870912, // 512MB x 1024 x 1024
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            })
            GPUResources.buffer.indices = device.createBuffer({
                size: 134217728, // 128MB x 1024 x 1024
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            })
            GPUResources.buffer.interaction = device.createBuffer({
                size: 16, // 4 * u32
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            })
            GPUResources.buffer.vertexId = device.createBuffer({
                size: 134217728, // 128MB x 1024 x 1024
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            GPUResources.buffer.hover = device.createBuffer({
                size: 256, // ✅ 1x1 + bytesPerRow=256 的最小安全值
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            })
        }

        // debug
        {
            const d = 20.0; // 20 meters

            const debugPos_and_debugNrm = new Float32Array([
                -d, -d, 0.0, 0, 0, 1,
                d, -d, 0.0, 0, 0, 1,
                0, d, 0.0, 0, 0, 1,
            ]);

            GPUResources.buffer.debugPos_and_debugNrm = device.createBuffer({
                size: debugPos_and_debugNrm.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(GPUResources.buffer.debugPos_and_debugNrm, 0, debugPos_and_debugNrm);

            const debugIds = new Uint32Array([0, 0, 0]);
            GPUResources.buffer.debugId = device.createBuffer({
                size: debugIds.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(GPUResources.buffer.debugId, 0, debugIds);
        }

        // bindGroupLayout
        {
            GPUResources.bindGroupLayout.global = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.VERTEX,
                        buffer: { type: `uniform` },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.VERTEX,
                        buffer: { type: `read-only-storage` },
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.FRAGMENT,
                        buffer: { type: `uniform` },
                    },
                ]
            })
            GPUResources.bindGroupLayout.model = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.VERTEX,
                        buffer: { type: `uniform` }
                    }
                ]
            })
            GPUResources.bindGroupLayout.node = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.VERTEX,
                        buffer: { type: `uniform` }
                    }
                ]
            })
        }

        // bindGroup
        {
            GPUResources.bindGroup.global = device.createBindGroup({
                layout: GPUResources.bindGroupLayout.global,
                entries: [
                    {
                        binding: 0,
                        resource: {
                            buffer: GPUResources.buffer.camera,
                        }
                    },
                    {
                        binding: 1,
                        resource: {
                            buffer: GPUResources.buffer.transform,
                        }
                    },
                    {
                        binding: 2,
                        resource: {
                            buffer: GPUResources.buffer.interaction,
                        }
                    }
                ]
            })
            GPUResources.bindGroup.identity = device.createBindGroup({
                layout: GPUResources.bindGroupLayout.model,
                entries: [
                    {
                        binding: 0,
                        resource: {
                            buffer: GPUResources.buffer.identity,
                        }
                    }
                ]
            })
        }

        // bufferLayout
        {
            GPUResources.bufferLayout.vertex = {
                position: {
                    arrayStride: 24, // 3 x 4 x 2 bytes = 24 bytes
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: `float32x3`,
                        },
                        {
                            shaderLocation: 1,
                            offset: 12,
                            format: `float32x3`,
                        }
                    ]
                },
                id_building: {
                    arrayStride: 4,
                    attributes: [
                        {
                            shaderLocation: 2,
                            offset: 0,
                            format: `uint32`
                        }
                    ]
                }
            }
        }

        /* == Texture == */
        var texture = {
            MSAA: null,
            colorAccumulated: null,
            colorResolved: null,
            depth: null,
            alphaAccumulated: null,
            alphaResolved: null,
            hover: null,
        }
        {
            texture.MSAA = device.createTexture({
                size: [canvas.width, canvas.height],
                format: format_canvas,
                sampleCount: 4,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            })
            texture.colorAccumulated = device.createTexture({
                size: [canvas.width, canvas.height],
                format: format_canvas,
                sampleCount: 4,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            })
            texture.colorResolved = device.createTexture({
                size: [canvas.width, canvas.height],
                format: format_canvas,
                sampleCount: 1,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            })
            // texture.depth = device.createTexture({
            //     size: [canvas.width, canvas.height],
            //     format: `depth24plus`,
            //     sampleCount: 1,
            //     usage: GPUTextureUsage.RENDER_ATTACHMENT,
            // })
            texture.alphaAccumulated = device.createTexture({
                size: [canvas.width, canvas.height],
                format: `rgba16float`,
                sampleCount: 4,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            })
            texture.alphaResolved = device.createTexture({
                size: [canvas.width, canvas.height],
                format: `rgba16float`,
                sampleCount: 1,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            })
            texture.hover = device.createTexture({
                size: [canvas.width, canvas.height],
                format: `r32uint`,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
            })
        }

        /* == Window Resize == */
        {
            resize = () => {
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
                const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));

                if (canvas.width === w && canvas.height === h) return;

                canvas.width = w;
                canvas.height = h;

                context.configure({
                    device: device,
                    format: format_canvas,
                    alphaMode: alphaMode,
                    size: [canvas.width, canvas.height],
                });
                console.log(`Canvas size:`, canvas.width, `x`, canvas.height)

                function createDepthTexture(device, canvas) {
                    return device.createTexture({
                        size: [canvas.width, canvas.height, 1],
                        format: 'depth24plus',
                        usage: GPUTextureUsage.RENDER_ATTACHMENT,
                    });
                }

                // 初始化时
                texture.depth = createDepthTexture(device, canvas);

                // 如果你有 resize() / configure() 逻辑：每次更新 canvas.width/height 后都要：
                texture.depth?.destroy?.();
                texture.depth = createDepthTexture(device, canvas);

                if (fov && aspect && near && far) {
                    console.log(`fov: ${fov}, aspect: ${aspect}, near: ${near}, far: ${far}`)
                    resizeCamera(fov, aspect, near, far)
                }

                const w2 = canvas.width;
                const h2 = canvas.height;

                // depth
                if (texture.depth) texture.depth.destroy();
                texture.depth = device.createTexture({
                    size: [w2, h2],
                    format: "depth24plus",
                    usage: GPUTextureUsage.RENDER_ATTACHMENT,
                });

                // pick r32uint
                if (texture.hover) texture.hover.destroy();
                texture.hover = device.createTexture({
                    size: [w2, h2],
                    format: "r32uint",
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
                });
            }
            addEventListener('resize', resize)
            resize()
        }
    }



    /* == Data Writing == */
    let matrix = {}, data_deploy, stats = {
        received: 0,
        processed: 0,
        lastIndex: -1,
        errors: 0,
    }, bbox = {
        minLon: null,
        minLat: null,
        maxLon: null,
        maxLat: null
    }

    const ws = new WebSocket("ws://localhost:8080")
    {
        /* === Model Data === */
        // fetch data (websocket)

        ws.onopen = () => log.textContent += "connected\n"

        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);

            if (msg.type === "feature") {
                // 兼容旧协议（如果你还会混发）
                handleFeature(msg);
                flushPoolToPending(false);
                return;
            }

            if (msg.type === "batch") {
                const features = msg.features || [];
                // 可选：你原本有 layer，这里也能用 msg.layer 做分层过滤/分桶
                for (let i = 0; i < features.length; i++) {
                    handleFeature(features[i]);
                }

                // ✅ 关键：batch 只 flush 一次（别每条 flush）
                flushPoolToPending(false);
                ready.stream = true;
                return;
            }

            if (msg.type === "done" || msg.type === "file_end") {
                // 结束前最后 flush 一次，避免池子里还有剩余
                flushPoolToPending(true);
                console.log("Stream done", { received: stats.received, lastIndex: stats.lastIndex });
                return;
            }
        };

        function handleFeature(f) {
            // console.log("feature osm =", f?.id?.osm, "parts =", f?.parts?.length);
            f._d2 = buildingDist2(f);
            pool.push(f);

            stats.received++;
            stats.lastIndex = f.index ?? stats.lastIndex;
        }
        // Preprocess data
        //// Pool sort (center-first rendering)
        let centerLon, centerLat
        console.log(`centerLon: ${centerLon}, centerLat: ${centerLat}`)

        const POOL_TARGET = 10_000_000;     // 池子凑到多少个 building 就 flush 一次（你可调 300~3000）
        const POOL_MAX_HOLD_MS = 4_000;  // 最多憋多久就必须 flush（避免“憋很久一坨”）

        let pool = [];
        let poolLastFlush = performance.now();

        function buildingDist2(msg) {
            const p0 = msg?.parts?.[0];
            const data = p0?.data;
            if (!data || data.length < 2 || centerLon == null || centerLat == null) {
                return Number.POSITIVE_INFINITY;
            }

            const lon = data[0];
            const lat = data[1];

            const latRad = centerLat * Math.PI / 180;

            // 度 -> 米
            const latRef = centerLat ?? lat0;
            const metersPerDegLon = 111412.84 * Math.cos(latRef * Math.PI / 180)
                - 93.5 * Math.cos(3 * latRef * Math.PI / 180);
            const metersPerDegLat = 111132.92
                - 559.82 * Math.cos(2 * latRef * Math.PI / 180)
                + 1.175 * Math.cos(4 * latRef * Math.PI / 180);

            const dxMeters = (lon - centerLon) * metersPerDegLon * Math.cos(latRad);
            const dyMeters = (lat - centerLat) * metersPerDegLat;

            return dxMeters * dxMeters + dyMeters * dyMeters;
        }

        function flushPoolToPending(force = false) {
            const now = performance.now();
            const tooLong = (now - poolLastFlush) > POOL_MAX_HOLD_MS;

            if (!force && pool.length < POOL_TARGET && !tooLong) return;

            // sort: near -> far
            pool.sort((a, b) => a._d2 - b._d2);

            GPUResources.data.pending.push(...pool);

            pool = [];
            poolLastFlush = now;
        }
        //// 2D building
        //// only one layer (z = z0), no walls, no ground, no normals.
        const part_flat = (part, z0 = 0) => {
            if (!Array.isArray(part.data) || part.data.length < 6) {
                throw new Error(`part.data must contain at least 3 points (>= 6 numbers).`)
            }
            if (!Array.isArray(part.indices) || part.indices.length < 3) {
                throw new Error(`part.indices must contain at least 1 triangle (>= 3 numbers).`)
            }

            const vertexCount = Math.floor(part.data.length / 2)

            const positions_and_normals = new Float32Array(vertexCount * 6)
            for (let i = 0; i < vertexCount; i++) {
                const lon = part.data[i * 2 + 0];
                const lat = part.data[i * 2 + 1];

                const ecef = lonLatHeightToECEF(lon, lat, z0);
                const [x, y, z] = ecefToENU(ecef, enuFrame);

                const o = i * 6
                positions_and_normals[o + 0] = x
                positions_and_normals[o + 1] = y
                positions_and_normals[o + 2] = z
                positions_and_normals[o + 3] = 0
                positions_and_normals[o + 4] = 0
                positions_and_normals[o + 5] = 1
            }

            // 直接复用 earcut 的三角形索引
            // const indices = new Uint32Array(part.indices)

            return {
                positions_and_normals,
                indices: new Uint32Array(part.indices),
                meta: {
                    vertexCount: vertexCount,
                    triangleCount: part.indices.length / 3,
                    z0,
                    mode: "flat",
                }
            }
        }

        // 3D Building DNA
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
        const lerp = (a, b, t) => a + (b - a) * t

        const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
        const cross3 = (ax, ay, az, bx, by, bz) => [
            ay * bz - az * by,
            az * bx - ax * bz,
            ax * by - ay * bx,
        ]
        const norm3 = (x, y, z) => {
            const len = Math.hypot(x, y, z)
            if (len < 1e-12) return [0, 0, 1]
            return [x / len, y / len, z / len]
        }
        const norm2 = (x, y) => {
            const len = Math.hypot(x, y)
            if (len < 1e-12) return [0, 0]
            return [x / len, y / len]
        }
        const lerp3 = (a, b, t) => [
            lerp(a[0], b[0], t),
            lerp(a[1], b[1], t),
            lerp(a[2], b[2], t),
        ]

        const hashString32 = (str) => {
            let h = 2166136261 >>> 0
            for (let i = 0; i < str.length; i++) {
                h ^= str.charCodeAt(i)
                h = Math.imul(h, 16777619)
            }
            h ^= h >>> 13
            h = Math.imul(h, 1274126177)
            h ^= h >>> 16
            return h >>> 0
        }

        const seeded01 = (seed, tag = 0) => {
            let h = seed >>> 0
            h ^= Math.imul((tag + 1) >>> 0, 1597334677) >>> 0
            h ^= h >>> 15
            h = Math.imul(h, 2246822519)
            h ^= h >>> 13
            h = Math.imul(h, 3266489917)
            h ^= h >>> 16
            return (h >>> 0) / 4294967295
        }

        // random point in quad interior, kept away from boundary
        function safePointInQuad(a, b, c, d, seedA, seedB, margin = 0.30) {
            const u = lerp(margin, 1 - margin, seeded01(seedA, 11))
            const v = lerp(margin, 1 - margin, seeded01(seedB, 12))
            const ab = lerp3(a, b, u)
            const dc = lerp3(d, c, u)
            return lerp3(ab, dc, v)
        }

        function createBuildingStyle(building, fallbackHeight = 15) {
            const key = (building?.id?.osm ?? building?.id?.h3 ?? `gpu_${Math.random()}`).toString()
            const seed = hashString32(key)

            const rawHeight =
                Number(building?.height) ||
                Number(building?.properties?.height) ||
                Number(building?.properties?.['building:height']) ||
                0

            const rawLevels =
                Number(building?.properties?.levels) ||
                Number(building?.properties?.['building:levels']) ||
                0

            let height = rawHeight
            if (!(height > 0)) {
                if (rawLevels > 0) height = rawLevels * 3.2
                else height = lerp(8, 34, seeded01(seed, 1))
            }

            height = clamp(height * lerp(0.9, 1.2, seeded01(seed, 2)), 6, 60)

            return {
                seed,
                height,
                wallDepth: lerp(0.2, 0.4, seeded01(seed, 3)),
            }
        }

        function part_extrude(part, styleOrHeight = 15) {
            if (!Array.isArray(part.data) || part.data.length < 6) {
                throw new Error(`part.data must contain at least 3 points (>= 6 numbers).`)
            }
            if (!Array.isArray(part.indices) || part.indices.length < 3) {
                throw new Error(`part.indices must contain at least 1 triangle (>= 3 numbers).`)
            }

            const STYLE = (typeof styleOrHeight === "number")
                ? {
                    seed: 1,
                    height: styleOrHeight,
                    wallDepth: 0.45,
                }
                : styleOrHeight

            const height = STYLE.height
            const vertexCount = Math.floor(part.data.length / 2)

            const positions_and_normals = []
            const indices = []

            const vertex_push = (x, y, z, nx, ny, nz) => {
                const index = positions_and_normals.length / 6
                positions_and_normals.push(x, y, z, nx, ny, nz)
                return index
            }

            const triangle_push_flat = (a, b, c) => {
                const ab = sub3(b, a)
                const ac = sub3(c, a)
                let [nx, ny, nz] = cross3(
                    ab[0], ab[1], ab[2],
                    ac[0], ac[1], ac[2]
                )
                    ;[nx, ny, nz] = norm3(nx, ny, nz)

                const ia = vertex_push(a[0], a[1], a[2], nx, ny, nz)
                const ib = vertex_push(b[0], b[1], b[2], nx, ny, nz)
                const ic = vertex_push(c[0], c[1], c[2], nx, ny, nz)
                indices.push(ia, ib, ic)
            }

            const triangle_push_flat_rev = (a, b, c) => {
                triangle_push_flat(a, c, b)
            }

            const ringENU = []
            for (let i = 0; i < vertexCount; i++) {
                const lon = part.data[i * 2 + 0]
                const lat = part.data[i * 2 + 1]
                const ecef = lonLatHeightToECEF(lon, lat, 0)
                const [x, y, z] = ecefToENU(ecef, enuFrame)
                ringENU.push([x, y, z])
            }

            // =========================
            // ROOF (original, no random point)
            // =========================
            for (let k = 0; k < part.indices.length; k += 3) {
                const ia = part.indices[k + 0]
                const ib = part.indices[k + 1]
                const ic = part.indices[k + 2]

                const a = [ringENU[ia][0], ringENU[ia][1], height]
                const b = [ringENU[ib][0], ringENU[ib][1], height]
                const c = [ringENU[ic][0], ringENU[ic][1], height]

                triangle_push_flat(a, b, c)
            }

            // =========================
            // GROUND
            // =========================
            for (let k = 0; k < part.indices.length; k += 3) {
                const ia = part.indices[k + 0]
                const ib = part.indices[k + 1]
                const ic = part.indices[k + 2]

                const a = [ringENU[ia][0], ringENU[ia][1], 0]
                const b = [ringENU[ib][0], ringENU[ib][1], 0]
                const c = [ringENU[ic][0], ringENU[ic][1], 0]

                triangle_push_flat_rev(a, b, c)
            }

            // =========================
            // WALLS: one safe random point per quad
            // =========================
            const holeStarts = Array.isArray(part.holes) ? part.holes : []
            const ringStarts = [0, ...holeStarts]
            const ringEnds = [...holeStarts, vertexCount]

            for (let r = 0; r < ringStarts.length; r++) {
                const start = ringStarts[r]
                const end = ringEnds[r]
                if (end - start < 3) continue

                for (let i = start; i < end; i++) {
                    const j = (i + 1 < end) ? (i + 1) : start

                    const p0 = ringENU[i]
                    const p1 = ringENU[j]

                    const a = [p0[0], p0[1], 0]
                    const b = [p1[0], p1[1], 0]
                    const c = [p1[0], p1[1], height]
                    const d = [p0[0], p0[1], height]

                    const dx = p1[0] - p0[0]
                    const dy = p1[1] - p0[1]
                    const edgeLen = Math.hypot(dx, dy)
                    if (edgeLen < 1e-6) continue

                    const [nx, ny] = norm2(dy, -dx)

                    const p = safePointInQuad(
                        a, b, c, d,
                        STYLE.seed + 4000 + i * 17 + r * 131,
                        STYLE.seed + 5000 + i * 19 + r * 137,
                        0.30
                    )

                    const depth = Math.min(STYLE.wallDepth, edgeLen * 0.28)
                    const bump = depth * lerp(0.85, 1.10, seeded01(STYLE.seed, 6000 + i * 23 + r * 149))
                    const sign = seeded01(STYLE.seed, 7000 + i * 29 + r * 151) > 0.5 ? 1 : -1

                    p[0] += nx * bump * sign
                    p[1] += ny * bump * sign

                    // one point per wall quad -> 4 triangles
                    triangle_push_flat(a, b, p)
                    triangle_push_flat(b, c, p)
                    triangle_push_flat(c, d, p)
                    triangle_push_flat(d, a, p)
                }
            }

            return {
                positions_and_normals: new Float32Array(positions_and_normals),
                indices: new Uint32Array(indices),
                meta: {
                    vertexCount: positions_and_normals.length / 6,
                    triangleCount: indices.length / 3,
                    height,
                    mode: "extrude_faceted_walls_only",
                    seed: STYLE.seed,
                }
            }
        }

        // Building ID
        let gpuCounter = 0, nextId = 1;                 // 0 留给“空地”
        const keyToId = new Map();      // "238093236" 或 "gpu_0" -> u32 id

        // 输入 feature.id.osm（可能是 null/""）
        // 输出一个字符串 key：要么 "238093236" 要么 "gpu_0"
        function key_building_get(osmId) {
            const s = (osmId ?? "").toString().trim();
            if (s) return s;
            return `gpu_${gpuCounter++}`;
        }

        function id_building_get_create(key) {
            let id = keyToId.get(key);
            if (id) return id;
            id = nextId++;
            keyToId.set(key, id);
            return id;
        }
        // Deploy data
        let BUILDING_MODE = "extrude";
        data_deploy = (device) => {
            flushPoolToPending(false);
            const BUDGET_MS = 16.0 // ?ms / frame to avoid lag
            const t0 = performance.now()

            while (GPUResources.data.pending.length) {
                if (performance.now() - t0 > BUDGET_MS) {
                    break;
                }

                const building = GPUResources.data.pending.shift()

                // flat/extrude
                if (BUILDING_MODE === "flat") {
                    building.parts = building.parts.map(p => part_flat(p, 0))
                } else if (BUILDING_MODE === "extrude") {
                    // building.parts = building.parts.map(p => part_extrude(p, 15))
                    const style = createBuildingStyle(building, 15)
                    building.parts = building.parts.map(p => part_extrude(p, style))
                }

                const key_building = key_building_get(building?.id?.osm)
                // console.log(`building:`, building)
                // console.log("building.id =", building?.id);
                const id_building = id_building_get_create(key_building)

                for (const part of building.parts) {
                    // const idArray = new Uint32Array(part.meta.vertexCount)
                    const vertexCountReal = (part.positions_and_normals.byteLength / 24) | 0;
                    const idArray = new Uint32Array(vertexCountReal)
                    const indexArray = new Uint32Array(part.indices.length)
                    idArray.fill(id_building)

                    for (let i = 0; i < part.indices.length; i++) {
                        indexArray[i] = part.indices[i] + (GPUResources.data.rendering.vertexByteOffset / 24) | 0
                    }

                    device.queue.writeBuffer(
                        GPUResources.buffer.vertex,
                        GPUResources.data.rendering.vertexByteOffset,
                        part.positions_and_normals
                    )
                    const vc = part.positions_and_normals.length / 24; // 24 bytes per vertex = 6 floats
                    if (part.meta?.vertexCount !== undefined && part.meta.vertexCount !== vertexCountReal) {
                        console.warn("vertexCount mismatch", vertexCountReal, part.meta.vertexCount, part.meta);
                    }
                    device.queue.writeBuffer(
                        GPUResources.buffer.vertexId,
                        GPUResources.data.rendering.vertexIdByteOffset,
                        idArray
                    )
                    device.queue.writeBuffer(
                        GPUResources.buffer.indices,
                        GPUResources.data.rendering.indexByteOffset,
                        indexArray
                    )

                    GPUResources.data.rendering.vertexByteOffset += part.positions_and_normals.byteLength
                    GPUResources.data.rendering.vertexIdByteOffset += idArray.byteLength
                    GPUResources.data.rendering.indexByteOffset += indexArray.byteLength
                }

                stats.processed++;
            }

            if (!ready.buildings) {
                ready.buildings = true
                console.log(`Start rendering!`)
            }
        }

        /* === Camera/Transform Data === */
        {
            {
                fov = 30 * Math.PI / 180
                aspect = canvas.width / canvas.height
                near = 0.1;
                far = 60000.0;
                matrix.projection = mat4.create()
                mat4.perspectiveZO(matrix.projection, fov, aspect, near, far)
                resizeCamera = (fov, aspect, near, far) => {
                    aspect = canvas.width / canvas.height;
                    mat4.perspectiveZO(matrix.projection, fov, aspect, near, far)

                    device.queue.writeBuffer(GPUResources.buffer.camera, 0, matrix.projection);
                }
            }
            let dist, eye, target, up
            {
                dist = 20000
                console.log(`dist: ${dist}`)
                eye = [0, 0, -dist]
                target = [0, 0, 0]
                up = [0, 1, 0]
                matrix.view = mat4.create()
                mat4.lookAt(matrix.view, eye, target, up)
            }
            {
                window.lonLatHeightToECEF = (lonDeg, latDeg, h = 0) => {

                    const lon = lonDeg * Math.PI / 180;
                    const lat = latDeg * Math.PI / 180;

                    const a = 6378137.0;                 // semi-major axis
                    const e2 = 6.69437999014e-3;         // eccentricity squared

                    const sinLat = Math.sin(lat);
                    const cosLat = Math.cos(lat);
                    const cosLon = Math.cos(lon);
                    const sinLon = Math.sin(lon);

                    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);

                    const x = (N + h) * cosLat * cosLon;
                    const y = (N + h) * cosLat * sinLon;
                    const z = (N * (1 - e2) + h) * sinLat;

                    return [x, y, z];
                }

                window.makeENUFrame = (lonDeg, latDeg, h = 0) => {
                    const origin = lonLatHeightToECEF(lonDeg, latDeg, h);

                    const lon = lonDeg * Math.PI / 180;
                    const lat = latDeg * Math.PI / 180;

                    const sinLon = Math.sin(lon), cosLon = Math.cos(lon);
                    const sinLat = Math.sin(lat), cosLat = Math.cos(lat);

                    // E, N, U basis in ECEF
                    const east = [-sinLon, cosLon, 0];
                    const north = [-sinLat * cosLon, -sinLat * sinLon, cosLat];
                    const up = [cosLat * cosLon, cosLat * sinLon, sinLat];

                    return { origin, east, north, up };
                };

                window.ecefToENU = (ecef, frame) => {
                    const dx = ecef[0] - frame.origin[0];
                    const dy = ecef[1] - frame.origin[1];
                    const dz = ecef[2] - frame.origin[2];

                    return [
                        dx * frame.east[0] + dy * frame.east[1] + dz * frame.east[2],   // x = east
                        dx * frame.north[0] + dy * frame.north[1] + dz * frame.north[2],  // y = north
                        dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2],     // z = up
                    ];
                };
            }
            let center
            const lon0 = -122.29499816894531;
            const lat0 = 47.575477600097656;

            window.centerECEF = lonLatHeightToECEF(lon0, lat0, 0);
            window.enuFrame = makeENUFrame(lon0, lat0, 0);
            {
                matrix.transform = mat4.create()
                center = [0, 0, 0];
            }
            console.log(`eye: ${eye}, center: ${center}, dist: ${vec3.distance(eye, center)}, near: ${near}`)

            // Calculate the bbox
            {
                const halfHeightWorld = Math.tan(fov / 2) * dist;
                const halfWidthWorld = halfHeightWorld * aspect;

                const latRef = centerLat ?? lat0;
                const metersPerDegLat = 111132.92
                    - 559.82 * Math.cos(2 * latRef * Math.PI / 180)
                    + 1.175 * Math.cos(4 * latRef * Math.PI / 180);

                const metersPerDegLon = 111412.84 * Math.cos(latRef * Math.PI / 180)
                    - 93.5 * Math.cos(3 * latRef * Math.PI / 180);

                const halfLon = halfWidthWorld / metersPerDegLon;
                const halfLat = halfHeightWorld / metersPerDegLat;

                const SAFETY = 1.0;

                bbox = {
                    minLon: lon0 - halfLon * SAFETY,
                    maxLon: lon0 + halfLon * SAFETY,
                    minLat: lat0 - halfLat * SAFETY,
                    maxLat: lat0 + halfLat * SAFETY,
                };

                console.log(`bbox:`, bbox);
            }

            {
                centerLon = (bbox.minLon + bbox.maxLon) / 2;
                centerLat = (bbox.minLat + bbox.maxLat) / 2;
            }

            {
                device.queue.writeBuffer(GPUResources.buffer.camera, 0, matrix.projection)
                device.queue.writeBuffer(GPUResources.buffer.camera, 64, matrix.view)
            }
        }
    }

    /* == Shader == */
    let shader = {
        path: {
            vertex: `./shader/vertex.wgsl`,
            fragment: `./shader/fragment.wgsl`,
            interaction: `./shader/interaction.wgsl`,
        },
        module: {}
    }
    {
        shader.module.vertex = device.createShaderModule({
            label: `Vertex Shader Module`,
            code: await fetch(shader.path.vertex)
                .then(res => res.ok ? res.text() : ``)
                .catch(() => ``),
        })
        shader.module.fragment = device.createShaderModule({
            label: `Fragment Shader Module`,
            code: await fetch(shader.path.fragment)
                .then(res => res.ok ? res.text() : ``)
                .catch(() => ``),
        })

        shader.module.interaction = device.createShaderModule({
            label: `Interaction Shader Module`,
            code: await fetch(shader.path.interaction)
                .then(res => res.ok ? res.text() : ``)
                .catch(() => ``),
        })
    }

    {
        GPUResources.pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [
                GPUResources.bindGroupLayout.global,
            ]
        })
    }

    {
        GPUResources.renderPipeline.model = device.createRenderPipeline({
            layout: GPUResources.pipelineLayout,
            vertex: {
                module: shader.module.vertex,
                entryPoint: `vertexMain`,
                buffers: [
                    GPUResources.bufferLayout.vertex.position,
                    GPUResources.bufferLayout.vertex.id_building,
                ]
            },
            fragment: {
                module: shader.module.fragment,
                entryPoint: `fragmentMain`,
                targets: [{ format: format_canvas }]
            },
            primitive: {
                topology: `triangle-list`,
                frontFace: 'ccw',   // ✅ 关键
                cullMode: 'back',
            },
            depthStencil: {
                format: `depth24plus`,
                depthWriteEnabled: true,
                depthCompare: `less`,
            },
            multisample: {
                count: 1
            },
        })
        GPUResources.renderPipeline.interaction = device.createRenderPipeline({
            layout: GPUResources.pipelineLayout,
            vertex: {
                module: shader.module.interaction,
                entryPoint: `vertexMain`,
                buffers: [
                    GPUResources.bufferLayout.vertex.position,
                    GPUResources.bufferLayout.vertex.id_building,
                ]
            },
            fragment: {
                module: shader.module.interaction,
                entryPoint: `fragmentMain`,
                targets: [{
                    format: `r32uint`
                }]
            },
            primitive: {
                topology: `triangle-list`,
                frontFace: 'ccw',   // ✅ 关键
                cullMode: 'back',
            },
            depthStencil: {
                format: `depth24plus`,
                depthWriteEnabled: true,
                depthCompare: `less`,
            }
        })
    }

    {
        ready.GPU = true
    }



    /* == Environmental Rendering (fast optical-flow-like version) == */
    {
        const video = document.getElementById('source_sky');
        const canvas = document.getElementById('sky');
        const ctx = canvas.getContext('2d');

        // ===== 参数 =====
        const VIDEO_RATE = 0.1;
        const OUTPUT_FPS = 30;

        // 用很小的图做流场估计（几千像素级）
        const EST_W = 96;
        const EST_H = 54;

        // 用中低分辨率做插帧，然后再放大到全屏
        const INTERP_W = 320;
        const INTERP_H = 180;

        // 稀疏流场网格
        const FLOW_COLS = 12;
        const FLOW_ROWS = 7;

        // block matching 参数
        const SEARCH_RADIUS = 4;
        const PATCH_RADIUS = 2;

        // =================

        const smallCanvas = document.createElement('canvas');
        const smallCtx = smallCanvas.getContext('2d', { willReadFrequently: true });

        const interpCanvas = document.createElement('canvas');
        const interpCtx = interpCanvas.getContext('2d');

        const outCanvas = document.createElement('canvas');
        const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });

        let frameA = null;   // INTERP_W x INTERP_H 的 RGBA
        let frameB = null;
        let lumA = null;     // EST_W x EST_H 的亮度
        let lumB = null;

        let flowField = null;       // 当前段目标流场
        let smoothFlowField = null; // 平滑后的流场

        let segStartPerf = 0;
        let segDurationMs = 100;
        let lastMediaTime = -1;

        let ready = false;
        let lastRenderNow = 0;

        let skyEl = null;
        let blockerEl = null;
        let buildingEl = null;

        function resize2() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            smallCanvas.width = EST_W;
            smallCanvas.height = EST_H;

            interpCanvas.width = INTERP_W;
            interpCanvas.height = INTERP_H;

            outCanvas.width = INTERP_W;
            outCanvas.height = INTERP_H;

            ctx.imageSmoothingEnabled = true;
            interpCtx.imageSmoothingEnabled = true;
            outCtx.imageSmoothingEnabled = true;
            smallCtx.imageSmoothingEnabled = true;
        }

        resize2();
        window.addEventListener('resize', resize2);

        skyEl = document.querySelector('#sky');
        blockerEl = document.querySelector('#blocker');
        window.groundEl = document.querySelector('#ground');
        buildingEl = document.querySelector('#building');

        let pitch_old = window.pitch;
        let zoom_old = window.zoom;
        let _pitch = window.pitch ?? 0;
        let _zoom = window.zoom ?? 0;

        Object.defineProperty(window, "pitch", {
            get() {
                return _pitch;
            },
            set(v) {
                _pitch = v;
                if (v !== pitch_old) {
                    adjust_clarity(v);
                    adjust_horizon(v);
                    pitch_old = v;
                }
            }
        });

        Object.defineProperty(window, "zoom", {
            get() {
                return _zoom;
            },
            set(v) {
                _zoom = v;
                if (v !== zoom_old) {
                    adjust_opacity(v);
                    zoom_old = v;
                }
            }
        });

        function adjust_clarity(pitch) {
            const MAX_BLUR = 0.2;
            const MIN_BLUR = 0.5;
            let blur;

            if (pitch >= -0.38) {
                if (pitch <= 0) {
                    blur = MAX_BLUR - (pitch + 0.38) / 0.38 * MAX_BLUR;
                } else {
                    blur = (pitch / 0.06) * (MIN_BLUR * 0.5);
                }
                blur = Math.max(0, Math.min(MAX_BLUR, blur));
            } else {
                blur = MAX_BLUR;
            }

            buildingEl.style.filter = `blur(${blur}px)`;
        }


        function adjust_horizon(pitch) {
            const PITCH_MIN1 = -1.15;
            const PITCH_MIN2 = -0.38;
            const PITCH_MAX = 0.06;

            if (pitch == PITCH_MIN1) {
                // groundEl.style.transform = `rotateX(${24.1}deg) scale(${1.8})`;
                groundEl.style.setProperty('--rx', `${24.1}deg`);
                groundEl.style.setProperty('--s', `${1.8}`);
                skyEl.style.display = 'none';
                blockerEl.style.display = 'none';
                return;
            }

            // ===== pitch 太低时隐藏 sky =====
            if (pitch < PITCH_MIN2) {
                skyEl.style.display = 'none';
                blockerEl.style.display = 'none';
                groundEl.style.top = `${-100}%`;
                // return;
            } else {
                skyEl.style.display = 'initial';
                blockerEl.style.display = 'initial';
                // ===== horizon =====
                let horizon;
                if (pitch <= 0) {
                    horizon = (pitch + 0.38) / 0.38 * 0.47;
                } else {
                    horizon = Math.pow(pitch / 0.06, 2) * 0.35 + 0.47;
                }
                skyEl.style.height = `${horizon * 100}%`;
                blockerEl.style.height = `${horizon * 100}%`;
                groundEl.style.top = `${horizon * 100 - 100}%`;
            }


            // ===== ground transform 随 pitch 变化 =====
            const t = Math.max(0, Math.min(1, (pitch - PITCH_MIN1) / (PITCH_MAX - PITCH_MIN1)));

            const rotateX = 24.1 + t * 45;
            const scale = 3 + t * .5;
            // const scale = 1;

            // groundEl.style.transformOrigin = 'bottom center';
            // groundEl.style.transform = `rotateX(${rotateX}deg) scale(${scale})`;
            groundEl.style.setProperty('--rx', `${rotateX}deg`);
            groundEl.style.setProperty('--s', `${scale}`);
        }

        function adjust_opacity(zoom) {
            const ZOOM_FADE_START = 150;
            const ZOOM_FADE_END = 50; // 你可以改这个值，决定多久从 0 渐变到 1

            // ===== ground opacity 随 zoom 变化 =====
            let groundOpacity;

            if (zoom >= ZOOM_FADE_START) {
                groundOpacity = 0;
            } else if (zoom <= ZOOM_FADE_END) {
                groundOpacity = 1;
            } else {
                groundOpacity =
                    (ZOOM_FADE_START - zoom) / (ZOOM_FADE_START - ZOOM_FADE_END);
            }

            groundEl.style.opacity = groundOpacity;
        }

        function captureInterpFrame() {
            interpCtx.clearRect(0, 0, INTERP_W, INTERP_H);
            interpCtx.drawImage(video, 0, 0, INTERP_W, INTERP_H);
            return new Uint8ClampedArray(
                interpCtx.getImageData(0, 0, INTERP_W, INTERP_H).data
            );
        }

        function captureLumaSmall() {
            smallCtx.clearRect(0, 0, EST_W, EST_H);
            smallCtx.drawImage(video, 0, 0, EST_W, EST_H);
            const rgba = smallCtx.getImageData(0, 0, EST_W, EST_H).data;

            const lum = new Float32Array(EST_W * EST_H);
            for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
                lum[i] = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
            }
            return lum;
        }

        function clamp(v, min, max) {
            return v < min ? min : v > max ? max : v;
        }

        function sampleBilinearRGBA(frame, w, h, x, y, c) {
            x = clamp(x, 0, w - 1);
            y = clamp(y, 0, h - 1);

            const x0 = x | 0;
            const y0 = y | 0;
            const x1 = Math.min(w - 1, x0 + 1);
            const y1 = Math.min(h - 1, y0 + 1);

            const fx = x - x0;
            const fy = y - y0;

            const i00 = (y0 * w + x0) * 4 + c;
            const i10 = (y0 * w + x1) * 4 + c;
            const i01 = (y1 * w + x0) * 4 + c;
            const i11 = (y1 * w + x1) * 4 + c;

            const v00 = frame[i00];
            const v10 = frame[i10];
            const v01 = frame[i01];
            const v11 = frame[i11];

            const v0 = v00 + (v10 - v00) * fx;
            const v1 = v01 + (v11 - v01) * fx;
            return v0 + (v1 - v0) * fy;
        }

        function estimatePatchShift(a, b, w, h, cx, cy) {
            let bestDx = 0;
            let bestDy = 0;
            let bestScore = Infinity;

            for (let oy = -SEARCH_RADIUS; oy <= SEARCH_RADIUS; oy++) {
                for (let ox = -SEARCH_RADIUS; ox <= SEARCH_RADIUS; ox++) {
                    let score = 0;
                    let count = 0;

                    for (let py = -PATCH_RADIUS; py <= PATCH_RADIUS; py++) {
                        for (let px = -PATCH_RADIUS; px <= PATCH_RADIUS; px++) {
                            const x1 = cx + px;
                            const y1 = cy + py;
                            const x2 = x1 + ox;
                            const y2 = y1 + oy;

                            if (
                                x1 < 0 || x1 >= w || y1 < 0 || y1 >= h ||
                                x2 < 0 || x2 >= w || y2 < 0 || y2 >= h
                            ) continue;

                            const l1 = a[y1 * w + x1];
                            const l2 = b[y2 * w + x2];
                            score += Math.abs(l1 - l2);
                            count++;
                        }
                    }

                    if (count > 0) {
                        score /= count;
                        if (score < bestScore) {
                            bestScore = score;
                            bestDx = ox;
                            bestDy = oy;
                        }
                    }
                }
            }

            return { dx: bestDx, dy: bestDy };
        }

        function estimateFlowField(a, b) {
            const field = new Float32Array(FLOW_COLS * FLOW_ROWS * 2);

            for (let gy = 0; gy < FLOW_ROWS; gy++) {
                for (let gx = 0; gx < FLOW_COLS; gx++) {
                    const cx = Math.round((gx / (FLOW_COLS - 1)) * (EST_W - 1));
                    const cy = Math.round((gy / (FLOW_ROWS - 1)) * (EST_H - 1));

                    const shift = estimatePatchShift(a, b, EST_W, EST_H, cx, cy);

                    const idx = (gy * FLOW_COLS + gx) * 2;
                    field[idx] = shift.dx * (INTERP_W / EST_W);
                    field[idx + 1] = shift.dy * (INTERP_H / EST_H);
                }
            }

            // 简单平滑一下流场，减少抖动
            const smoothed = new Float32Array(field.length);
            for (let gy = 0; gy < FLOW_ROWS; gy++) {
                for (let gx = 0; gx < FLOW_COLS; gx++) {
                    let sumX = 0;
                    let sumY = 0;
                    let count = 0;

                    for (let oy = -1; oy <= 1; oy++) {
                        for (let ox = -1; ox <= 1; ox++) {
                            const nx = gx + ox;
                            const ny = gy + oy;
                            if (nx < 0 || nx >= FLOW_COLS || ny < 0 || ny >= FLOW_ROWS) continue;

                            const nidx = (ny * FLOW_COLS + nx) * 2;
                            sumX += field[nidx];
                            sumY += field[nidx + 1];
                            count++;
                        }
                    }

                    const idx = (gy * FLOW_COLS + gx) * 2;
                    smoothed[idx] = sumX / count;
                    smoothed[idx + 1] = sumY / count;
                }
            }

            return smoothed;
        }

        function sampleFlow(field, x, y) {
            const fx = (x / (INTERP_W - 1)) * (FLOW_COLS - 1);
            const fy = (y / (INTERP_H - 1)) * (FLOW_ROWS - 1);

            const x0 = Math.floor(fx);
            const y0 = Math.floor(fy);
            const x1 = Math.min(FLOW_COLS - 1, x0 + 1);
            const y1 = Math.min(FLOW_ROWS - 1, y0 + 1);

            const tx = fx - x0;
            const ty = fy - y0;

            const i00 = (y0 * FLOW_COLS + x0) * 2;
            const i10 = (y0 * FLOW_COLS + x1) * 2;
            const i01 = (y1 * FLOW_COLS + x0) * 2;
            const i11 = (y1 * FLOW_COLS + x1) * 2;

            const dx0 = field[i00] + (field[i10] - field[i00]) * tx;
            const dx1 = field[i01] + (field[i11] - field[i01]) * tx;
            const dy0 = field[i00 + 1] + (field[i10 + 1] - field[i00 + 1]) * tx;
            const dy1 = field[i01 + 1] + (field[i11 + 1] - field[i01 + 1]) * tx;

            return {
                dx: dx0 + (dx1 - dx0) * ty,
                dy: dy0 + (dy1 - dy0) * ty
            };
        }

        function buildInterpolatedFrame(now) {
            if (!ready || !frameA || !frameB || !smoothFlowField) return null;

            const out = new Uint8ClampedArray(INTERP_W * INTERP_H * 4);

            let t = (now - segStartPerf) / Math.max(1, segDurationMs);
            t = clamp(t, 0, 1);

            // smoothstep，过渡更柔和
            t = t * t * (3 - 2 * t);

            for (let y = 0; y < INTERP_H; y++) {
                for (let x = 0; x < INTERP_W; x++) {
                    const dst = (y * INTERP_W + x) * 4;
                    const f = sampleFlow(smoothFlowField, x, y);

                    const ax = f.dx * t;
                    const ay = f.dy * t;
                    const bx = f.dx * (t - 1);
                    const by = f.dy * (t - 1);

                    for (let c = 0; c < 3; c++) {
                        const va = sampleBilinearRGBA(frameA, INTERP_W, INTERP_H, x - ax, y - ay, c);
                        const vb = sampleBilinearRGBA(frameB, INTERP_W, INTERP_H, x - bx, y - by, c);
                        const v = va * (1 - t) + vb * t;
                        out[dst + c] = v < 0 ? 0 : v > 255 ? 255 : v;
                    }

                    out[dst + 3] = 255;
                }
            }

            return out;
        }

        function drawFrame(frame) {
            if (!frame) return;

            outCtx.putImageData(new ImageData(frame, INTERP_W, INTERP_H), 0, 0);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(outCanvas, 0, 0, canvas.width, canvas.height);
        }

        function resetWithCurrentFrame() {
            const full = captureInterpFrame();
            const small = captureLumaSmall();

            frameA = new Uint8ClampedArray(full);
            frameB = new Uint8ClampedArray(full);
            lumA = new Float32Array(small);
            lumB = new Float32Array(small);

            flowField = new Float32Array(FLOW_COLS * FLOW_ROWS * 2);
            smoothFlowField = new Float32Array(FLOW_COLS * FLOW_ROWS * 2);

            segStartPerf = performance.now();
            segDurationMs = 100;
            ready = true;
        }

        function onVideoFrame(now, metadata) {
            const mediaTime = metadata.mediaTime;

            if (lastMediaTime >= 0 && mediaTime < lastMediaTime) {
                resetWithCurrentFrame();
                lastMediaTime = mediaTime;
                video.requestVideoFrameCallback(onVideoFrame);
                return;
            }

            const full = captureInterpFrame();
            const small = captureLumaSmall();

            if (!ready) {
                frameA = new Uint8ClampedArray(full);
                frameB = new Uint8ClampedArray(full);
                lumA = new Float32Array(small);
                lumB = new Float32Array(small);

                flowField = new Float32Array(FLOW_COLS * FLOW_ROWS * 2);
                smoothFlowField = new Float32Array(FLOW_COLS * FLOW_ROWS * 2);

                segStartPerf = performance.now();
                segDurationMs = 100;
                ready = true;
            } else {
                const dtSec = lastMediaTime >= 0 ? (mediaTime - lastMediaTime) : 0.1;
                segDurationMs = Math.max(1, dtSec * 1000 / VIDEO_RATE);

                frameA = frameB;
                lumA = lumB;

                frameB = new Uint8ClampedArray(full);
                lumB = new Float32Array(small);

                flowField = estimateFlowField(lumA, lumB);

                // 时间上也平滑一点，避免相邻段突变
                if (!smoothFlowField || smoothFlowField.length !== flowField.length) {
                    smoothFlowField = new Float32Array(flowField);
                } else {
                    for (let i = 0; i < flowField.length; i++) {
                        smoothFlowField[i] = smoothFlowField[i] * 0.4 + flowField[i] * 0.6;
                    }
                }

                segStartPerf = performance.now();
            }

            lastMediaTime = mediaTime;
            video.requestVideoFrameCallback(onVideoFrame);
        }

        function renderLoop(now) {
            if (!lastRenderNow) lastRenderNow = now;

            const dt = now - lastRenderNow;
            if (dt >= 1000 / OUTPUT_FPS) {
                lastRenderNow = now;

                if (ready) {
                    const frame = buildInterpolatedFrame(now);
                    drawFrame(frame);
                }
            }

            requestAnimationFrame(renderLoop);
        }

        async function start() {
            try {
                video.muted = true;
                video.loop = true;
                video.playsInline = true;
                video.preload = 'auto';
                video.playbackRate = VIDEO_RATE;

                await video.play();

                resetWithCurrentFrame();
                video.requestVideoFrameCallback(onVideoFrame);
                requestAnimationFrame(renderLoop);
            } catch (err) {
                console.error('start failed:', err);
            }
        }

        start();
    }

    /* == Camera Controller == */
    (() => {
        // -------- State --------
        let yaw = 0;
        window.pitch = -1.15;
        window.zoom = 1400;
        let panX = 0, panY = 0;

        // 鼠标在 canvas 上的像素位置（用于“按鼠标位置缩放”）
        let lastMousePx = canvas.width * 0.5;
        let lastMousePy = canvas.height * 0.5;

        // -------- Limits --------
        const MIN_ZOOM = 10;
        const MAX_ZOOM = 19300;
        const VIEW_CHANGE_ZOOM = 150; // 从这里开始视角变化，同时停止跟随鼠标缩放

        const MIN_PITCH = -1.15; // 远处俯视
        const MAX_PITCH = 0.06;  // 如果你要 10°，改成 Math.PI / 18

        const PAN_SENS = 1.0;
        const WHEEL_ZOOM_K = 0.0005;

        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const lerp = (a, b, t) => a + (b - a) * t;

        function easeInOut(t) {
            return t * t * (3 - 2 * t);
        }

        function pitchFromZoom(zoomValue) {
            if (zoomValue > VIEW_CHANGE_ZOOM) return MIN_PITCH;

            const t = 1 - (zoomValue - MIN_ZOOM) / (VIEW_CHANGE_ZOOM - MIN_ZOOM);
            const k = easeInOut(clamp(t, 0, 1));

            return lerp(MIN_PITCH, MAX_PITCH, k);
        }

        function fovFromPitch(pitchValue) {
            const BASE_FOV = 30 * Math.PI / 180;
            const TELE_FOV = 9 * Math.PI / 180;

            if (pitchValue < 0) return BASE_FOV;

            const t = clamp(pitchValue / MAX_PITCH, 0, 1);
            const k = easeInOut(t);

            return lerp(BASE_FOV, TELE_FOV, k);
        }

        function panScale() {
            const t = clamp((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM), 0, 1);
            return lerp(0.15, 12.0, t);
        }

        function solveCameraState(zoomValue, panXValue, panYValue) {
            const pitchValue = pitchFromZoom(zoomValue);
            const fovValue = fovFromPitch(pitchValue);

            const up = [0, 0, 1];
            const anchor = [panXValue, panYValue, 0];
            const lookAhead = 60.0;

            let eye, target;

            if (pitchValue < 0) {
                const eyeHeight = Math.max(2.0, Math.sin(-pitchValue) * zoomValue);
                const eyeBack = Math.max(0.0, Math.cos(-pitchValue) * zoomValue);

                eye = [
                    anchor[0],
                    anchor[1] - eyeBack,
                    anchor[2] + eyeHeight
                ];

                target = [
                    anchor[0],
                    anchor[1] + lookAhead,
                    anchor[2] + lookAhead * Math.tan(pitchValue * 0.35)
                ];
            } else {
                const tHead = clamp(pitchValue / MAX_PITCH, 0, 1);
                const kHead = easeInOut(tHead);

                const FIXED_EYE_HEIGHT = 2.0;
                const eyeBackHead = lerp(20.0, 70.0, kHead);

                eye = [
                    anchor[0],
                    anchor[1] - eyeBackHead,
                    anchor[2] + FIXED_EYE_HEIGHT
                ];

                target = [
                    eye[0],
                    eye[1] + lookAhead,
                    eye[2] + lookAhead * Math.tan(pitchValue)
                ];
            }

            return { pitchValue, fovValue, eye, target, up };
        }

        function unprojectPoint(px, py, ndcZ, invVP) {
            const x = (px / canvas.width) * 2 - 1;
            const y = 1 - (py / canvas.height) * 2;

            const v = [x, y, ndcZ, 1];

            const out = [
                invVP[0] * v[0] + invVP[4] * v[1] + invVP[8] * v[2] + invVP[12] * v[3],
                invVP[1] * v[0] + invVP[5] * v[1] + invVP[9] * v[2] + invVP[13] * v[3],
                invVP[2] * v[0] + invVP[6] * v[1] + invVP[10] * v[2] + invVP[14] * v[3],
                invVP[3] * v[0] + invVP[7] * v[1] + invVP[11] * v[2] + invVP[15] * v[3],
            ];

            const w = out[3];
            if (Math.abs(w) < 1e-8) return null;

            return [out[0] / w, out[1] / w, out[2] / w];
        }

        function screenToGround(px, py, zoomValue, panXValue, panYValue) {
            const { fovValue, eye, target, up } = solveCameraState(zoomValue, panXValue, panYValue);

            const proj = mat4.create();
            mat4.perspectiveZO(proj, fovValue, canvas.width / canvas.height, near, far);

            const view = mat4.create();
            mat4.lookAt(view, eye, target, up);

            const vp = mat4.create();
            mat4.multiply(vp, proj, view);

            const invVP = mat4.create();
            if (!mat4.invert(invVP, vp)) return null;

            const pNear = unprojectPoint(px, py, 0, invVP);
            const pFar = unprojectPoint(px, py, 1, invVP);
            if (!pNear || !pFar) return null;

            const dir = [
                pFar[0] - pNear[0],
                pFar[1] - pNear[1],
                pFar[2] - pNear[2]
            ];

            if (Math.abs(dir[2]) < 1e-6) return null;

            const t = -pNear[2] / dir[2];
            if (!Number.isFinite(t)) return null;

            return [
                pNear[0] + dir[0] * t,
                pNear[1] + dir[1] * t,
                0
            ];
        }

        function zoomAtMouse(deltaY) {
            const oldZoom = zoom;
            let newZoom = oldZoom / Math.exp(deltaY * WHEEL_ZOOM_K);
            newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);

            // 只有“纯俯视阶段”才按鼠标位置缩放
            // 一旦开始视角变化（zoom <= 150），就原地变焦
            if (oldZoom > VIEW_CHANGE_ZOOM && newZoom > VIEW_CHANGE_ZOOM) {
                const before = screenToGround(lastMousePx, lastMousePy, oldZoom, panX, panY);

                zoom = newZoom;

                const after = screenToGround(lastMousePx, lastMousePy, zoom, panX, panY);

                if (before && after) {
                    panX += before[0] - after[0];
                    panY += before[1] - after[1];
                }
            } else {
                zoom = newZoom;
            }
        }

        // ===== Orbit / cinematic mode =====
        const ORBIT_PITCH = -0.7;           // 斜向下俯视，可改：-0.6 ~ -0.9
        const ORBIT_FOV = 24 * Math.PI / 180;
        const ORBIT_HEIGHT_FACTOR = 2.16;    // 基于当前 zoom 估算 orbit 半径
        const ORBIT_RADIUS_FACTOR = 2.7;
        const ORBIT_ROT_SPEED = 0.03;        // rad/s
        const ORBIT_TRANSITION_MS = 2000;

        let orbitMode = false;
        let orbitSavedState = null;

        let orbitCenter = [0, 0, 0];
        let orbitAngle = 0;
        let orbitRadius = 1000;
        let orbitHeight = 700;

        let orbitTransition = null;
        // 结构：
        // {
        //   active: true,
        //   startTime,
        //   duration,
        //   from: { eye, target, fov, pitch },
        //   to:   { eye, target, fov, pitch },
        //   onDone: fn | null
        // }

        function smooth01(t) {
            t = clamp(t, 0, 1);
            return t * t * (3 - 2 * t);
        }

        function lerp3(a, b, t) {
            return [
                lerp(a[0], b[0], t),
                lerp(a[1], b[1], t),
                lerp(a[2], b[2], t),
            ];
        }

        function getNormalCameraState(zoomValue, panXValue, panYValue) {
            const pitchValue = pitchFromZoom(zoomValue);
            const fovValue = fovFromPitch(pitchValue);

            const up = [0, 0, 1];
            const anchor = [panXValue, panYValue, 0];
            const lookAhead = 60.0;

            let eye, target;

            if (pitchValue < 0) {
                const eyeHeight = Math.max(2.0, Math.sin(-pitchValue) * zoomValue);
                const eyeBack = Math.max(0.0, Math.cos(-pitchValue) * zoomValue);

                eye = [
                    anchor[0],
                    anchor[1] - eyeBack,
                    anchor[2] + eyeHeight
                ];

                target = [
                    anchor[0],
                    anchor[1] + lookAhead,
                    anchor[2] + lookAhead * Math.tan(pitchValue * 0.35)
                ];
            } else {
                const tHead = clamp(pitchValue / MAX_PITCH, 0, 1);
                const kHead = easeInOut(tHead);

                const FIXED_EYE_HEIGHT = 2.0;
                const eyeBackHead = lerp(20.0, 75.0, kHead);

                eye = [
                    anchor[0],
                    anchor[1] - eyeBackHead,
                    anchor[2] + FIXED_EYE_HEIGHT
                ];

                target = [
                    eye[0],
                    eye[1] + lookAhead,
                    eye[2] + lookAhead * Math.tan(pitchValue)
                ];
            }

            return {
                eye,
                target,
                up,
                fov: fovValue,
                pitch: pitchValue
            };
        }

        function getOrbitState(angleValue) {
            const eye = [
                orbitCenter[0] + Math.cos(angleValue) * orbitRadius,
                orbitCenter[1] + Math.sin(angleValue) * orbitRadius,
                orbitCenter[2] + orbitHeight
            ];

            return {
                eye,
                target: [...orbitCenter],
                up: [0, 0, 1],
                fov: ORBIT_FOV,
                pitch: ORBIT_PITCH
            };
        }

        function startCameraTransition(fromState, toState, onDone = null, duration = ORBIT_TRANSITION_MS) {
            orbitTransition = {
                active: true,
                startTime: performance.now(),
                duration,
                from: fromState,
                to: toState,
                onDone
            };
        }

        function sampleCameraState(now) {
            // orbit 模式本体
            let baseState;
            if (orbitMode) {
                baseState = getOrbitState(orbitAngle);
            } else {
                baseState = getNormalCameraState(zoom, panX, panY);
            }

            // 如果没有过渡，直接返回
            if (!orbitTransition || !orbitTransition.active) {
                return baseState;
            }

            const tRaw = (now - orbitTransition.startTime) / orbitTransition.duration;
            const t = smooth01(tRaw);

            const mixed = {
                eye: lerp3(orbitTransition.from.eye, orbitTransition.to.eye, t),
                target: lerp3(orbitTransition.from.target, orbitTransition.to.target, t),
                up: [0, 0, 1],
                fov: lerp(orbitTransition.from.fov, orbitTransition.to.fov, t),
                pitch: lerp(orbitTransition.from.pitch, orbitTransition.to.pitch, t),
            };

            if (tRaw >= 1) {
                const done = orbitTransition.onDone;
                orbitTransition = null;
                if (done) done();
            }

            return mixed;
        }

        function enterOrbitMode() {
            if (orbitMode || orbitTransition) return;

            const map = document.querySelector(`#map`)

            map.classList.add(`layout_2`)

            if (zoom < 200) zoom = 200;

            // 保存恢复用状态
            orbitSavedState = {
                zoom,
                panX,
                panY,
                yawCss
            };

            // 以屏幕中心打地面的点作为旋转中心
            const groundHit = screenToGround(
                canvas.width * 0.5,
                canvas.height * 0.5,
                zoom,
                panX,
                panY
            );

            orbitCenter = groundHit ?? [panX, panY, 0];

            // 用当前 normal camera 估算进入姿态
            const fromState = getNormalCameraState(zoom, panX, panY);

            // 让 orbit 起始角度和当前视角有一点连续性
            orbitAngle = Math.atan2(
                fromState.eye[1] - orbitCenter[1],
                fromState.eye[0] - orbitCenter[0]
            );

            orbitRadius = Math.max(40, zoom * ORBIT_RADIUS_FACTOR);
            orbitHeight = Math.max(20, zoom * ORBIT_HEIGHT_FACTOR);

            const toState = getOrbitState(orbitAngle);

            startCameraTransition(fromState, toState, () => {
                orbitMode = true;
            });
        }

        function exitOrbitMode() {
            if ((!orbitMode && !orbitTransition) || !orbitSavedState) return;

            map.classList.remove(`layout_2`)

            // 如果已经在 orbit，就从当前 orbit 姿态退回
            const fromState = orbitTransition?.active
                ? sampleCameraState(performance.now())
                : getOrbitState(orbitAngle);

            const restore = orbitSavedState;

            // 先恢复逻辑状态，但视觉上仍通过 transition 平滑过去
            zoom = restore.zoom;
            panX = restore.panX;
            panY = restore.panY;
            yawCss = restore.yawCss ?? 0;
            updateGroundTransform(pitch, yawCss);

            const toState = getNormalCameraState(zoom, panX, panY);

            orbitMode = false;

            startCameraTransition(fromState, toState, () => {
                orbitSavedState = null;
            });
        }

        window.toggleOrbitMode = () => {
            if (orbitMode) {
                exitOrbitMode();
            } else {
                enterOrbitMode();
            }
        }

        // -------- Event --------
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        function updateGroundTransform(pitch, yawCss) {
            groundEl.style.setProperty('--rz', `${yawCss}deg`);
        }

        let yawCss = 0;
        let isDraggingYaw = false;
        let dragStartX = 0;
        let yawStart = 0;

        canvas.addEventListener("mousedown", (e) => {
            // 左键或中键开始拖动
            if (e.button === 0 || e.button === 1) {
                isDraggingYaw = true;
                dragStartX = e.clientX;
                yawStart = yawCss;
            }
        });

        window.addEventListener("mouseup", () => {
            isDraggingYaw = false;
        });

        canvas.addEventListener("mousemove", (e) => {
            const r = canvas.getBoundingClientRect();
            const sx = (e.clientX - r.left) / r.width;
            const sy = (e.clientY - r.top) / r.height;

            lastMousePx = sx * canvas.width;
            lastMousePy = sy * canvas.height;

            // 左键 / 中键拖动平移
            if (e.buttons === 1 || e.buttons === 4 && !orbitMode) {
                const s = panScale();
                panX -= e.movementX * PAN_SENS * s;
                panY += e.movementY * PAN_SENS * s;
            }

            // 左键 / 中键按下后，根据相对水平位移旋转 ground
            if (isDraggingYaw && (e.buttons === 1 || e.buttons === 4) && !orbitMode) {
                const dx = e.clientX - dragStartX;

                // 向右拖 = 逆时针；向左拖 = 顺时针
                yawCss = yawStart - dx * 0.1;

                updateGroundTransform(pitch, yawCss);
            }
        });

        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();

            if (orbitMode) return;

            const r = canvas.getBoundingClientRect();
            const sx = (e.clientX - r.left) / r.width;
            const sy = (e.clientY - r.top) / r.height;

            lastMousePx = sx * canvas.width;
            lastMousePy = sy * canvas.height;

            zoomAtMouse(e.deltaY);

            console.log(
                "zoom:", zoom,
                "pitch:", pitchFromZoom(zoom),
                "panX:", panX,
                "panY:", panY
            );

            // Control KPI/chart variables
            updateDashboardFromZoom(zoom);
        }, { passive: false });

        // -------- Reset --------
        const resetBtn = document.getElementById("resetBtn");
        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                orbitMode = false;
                orbitTransition = null;
                orbitSavedState = null;

                yaw = 0;
                yawCss = 0;
                updateGroundTransform(MIN_PITCH, yawCss);

                pitch = MIN_PITCH;
                zoom = 1400;
                panX = 0;
                panY = 0;
                lastMousePx = canvas.width * 0.5;
                lastMousePy = canvas.height * 0.5;
                adjust_horizon(-1.15);
            });
        }

        // -------- Apply to GPU --------
        window.camera = (mat4, GPUResources, device, matrix) => {
            const now = performance.now();

            // orbit 模式下自动旋转
            if (orbitMode && !orbitTransition) {
                orbitAngle += deltaTime * ORBIT_ROT_SPEED;
            }

            const cam = sampleCameraState(now);

            pitch = cam.pitch;

            const currentAspect = canvas.width / canvas.height;
            mat4.perspectiveZO(matrix.projection, cam.fov, currentAspect, near, far);
            device.queue.writeBuffer(GPUResources.buffer.camera, 0, matrix.projection);

            matrix.view = mat4.create();
            mat4.lookAt(matrix.view, cam.eye, cam.target, cam.up);
            device.queue.writeBuffer(GPUResources.buffer.camera, 64, matrix.view);

            matrix.world = mat4.create();
            mat4.multiply(matrix.world, matrix.world, matrix.transform);
            device.queue.writeBuffer(GPUResources.buffer.transform, 0, matrix.world);
        };
    })();

    /* == Interaction == */
    let mouseX = 0, mouseY = 0, id_last_hover = 0
    {
        canvas.addEventListener("mousemove", (e) => {
            const r = canvas.getBoundingClientRect();
            mouseX = (e.clientX - r.left) / r.width;
            mouseY = (e.clientY - r.top) / r.height;
            // console.log(`mouseX: ${mouseX}, mouseY: ${mouseY}`)
        })

        let id_selected = 0;
        const interactionU32 = new Uint32Array(4)
        const hover = async (px, py) => {
            if (GPUResources.data.rendering.indexByteOffset <= 0) {
                id_selected = 0;
                device.queue.writeBuffer(GPUResources.buffer.interaction, 0, new Uint32Array([id_selected, 0, 0, 0]));
                return;
            }

            const encoder = device.createCommandEncoder()

            const renderPass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: texture.hover.createView(),
                    loadOp: `clear`,
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    storeOp: `store`,
                }],
                depthStencilAttachment: {
                    view: texture.depth.createView(),
                    depthLoadOp: `clear`,
                    depthClearValue: 1.0,
                    depthStoreOp: `store`,
                }
            })

            renderPass.setPipeline(GPUResources.renderPipeline.interaction)
            renderPass.setBindGroup(0, GPUResources.bindGroup.global)
            renderPass.setVertexBuffer(0, GPUResources.buffer.vertex)
            renderPass.setVertexBuffer(1, GPUResources.buffer.vertexId)
            renderPass.setIndexBuffer(GPUResources.buffer.indices, `uint32`)
            renderPass.drawIndexed(GPUResources.data.rendering.indexByteOffset / 4, 1, 0, 0, 0);
            renderPass.end()

            encoder.copyTextureToBuffer(
                {
                    texture: texture.hover,
                    origin: { x: px, y: py }
                },
                {
                    buffer: GPUResources.buffer.hover,
                    bytesPerRow: 256
                },
                {
                    width: 1,
                    height: 1,
                    depthOrArrayLayers: 1
                }
            )

            device.queue.submit([encoder.finish()])
            await GPUResources.buffer.hover.mapAsync(GPUMapMode.READ)
            const copy = GPUResources.buffer.hover.getMappedRange(0, 4)
            id_selected = new Uint32Array(copy)[0] >>> 0
            GPUResources.buffer.hover.unmap()
            interactionU32[0] = id_selected;
            device.queue.writeBuffer(GPUResources.buffer.interaction, 0, interactionU32);

            id_last_hover = id_selected
            return id_selected
        }

        window.interaction = async (time) => {

            if (mouseX < 0 || mouseX > 1 || mouseY < 0 || mouseY > 1) {
                interactionU32[0] = 0;
                device.queue.writeBuffer(GPUResources.buffer.interaction, 0, interactionU32);
                return;
            }

            const px = Math.floor(mouseX * canvas.width)
            const py = Math.floor(mouseY * canvas.height)

            const id = await hover(px, py)

            const data_interaction = new Uint32Array(4)
            data_interaction[0] = id
            // console.log(`id: ${id}`)
            device.queue.writeBuffer(GPUResources.buffer.interaction, 0, data_interaction)
        }
    }

    /* == Render Loop == */
    const render = () => {
        if (!ready.GPU || !ready.buildings) return
        let encoder, renderPass
        encoder = device.createCommandEncoder()

        renderPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: context.getCurrentTexture().createView(),
                    loadOp: "clear",
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    storeOp: "store",
                }
            ],
            depthStencilAttachment: {
                view: texture.depth.createView(),
                depthLoadOp: `clear`,
                depthClearValue: 1.0,
                depthStoreOp: `store`,
            }
        });

        renderPass.setPipeline(GPUResources.renderPipeline.model)
        renderPass.setBindGroup(0, GPUResources.bindGroup.global)

        // debug triangle
        renderPass.setVertexBuffer(0, GPUResources.buffer.debugPos_and_debugNrm)
        renderPass.setVertexBuffer(1, GPUResources.buffer.debugId);

        renderPass.draw(3, 1, 0, 0)

        if (PAUSE_RENDER == false && GPUResources.data.rendering.indexByteOffset > 0) {
            renderPass.setVertexBuffer(0, GPUResources.buffer.vertex)
            renderPass.setVertexBuffer(1, GPUResources.buffer.vertexId)
            renderPass.setIndexBuffer(GPUResources.buffer.indices, `uint32`)
            if (!window.__once) {
                window.__once = true;
                console.log("indexByteOffset=", GPUResources.data.rendering.indexByteOffset);
                console.log("indexCount=", (GPUResources.data.rendering.indexByteOffset / 4) | 0);
                console.log("vertexByteOffset=", GPUResources.data.rendering.vertexByteOffset);
                console.log("vertexIdByteOffset=", GPUResources.data.rendering.vertexIdByteOffset);
            }
            renderPass.drawIndexed(GPUResources.data.rendering.indexByteOffset / 4, 1, 0, 0, 0)
        }

        renderPass.end()

        device.queue.submit([encoder.finish()])
    }


    /* == FPS statistics == */
    let fps = 0
    let frameCount = 0
    let fpsTime = performance.now()
    let FPS = (now) => {
        frameCount++
        if (now - fpsTime > 1000) {
            fps = frameCount
            frameCount = 0
            fpsTime = now
        }
        const vertexMB = (GPUResources.data.rendering.vertexByteOffset / 1048576).toFixed(1)
        const indexMB = (GPUResources.data.rendering.indexByteOffset / 1048576).toFixed(1)
        log.textContent =
            `FPS: ${fps}
Delta: ${(deltaTime * 1000).toFixed(2)} ms
Buildings: ${GPUResources.data.rendering.indexByteOffset / 12}
Received: ${stats.received}
Pending: ${GPUResources.data.pending.length}
Processed: ${stats.processed}
VertexMB: ${vertexMB} MB
IndexMB: ${indexMB} MB`
    }


    // === Render ===
    let frame, lastTime, deltaTime, PAUSE_RENDER = false, STARTED = false
    lastTime = performance.now()
    frame = async (now) => {
        deltaTime = (now - lastTime) / 1000
        lastTime = now
        if (!PAUSE_RENDER) {
            data_deploy(device)
            camera(mat4, GPUResources, device, matrix)
            await interaction(deltaTime)
            render(deltaTime)
            FPS(now)
        }
        requestAnimationFrame(frame)
    }
    // frame()


    // Page
    const btn = document.querySelector('#startBtn');
    const bar = document.querySelector('#progress');
    console.log(btn, bar);
    btn.addEventListener("click", () => {
        const start = performance.now();
        const duration = 1000;

        const progressbar = (now) => {

            const t = (now - start) / duration;
            const progress = Math.min(t, 1);

            bar.style.width = (progress * 100) + "%";

            if (progress < 1) {
                requestAnimationFrame(progressbar);
            }
        }

        requestAnimationFrame(progressbar);

        // 真正开始流和渲染
        ws.send(JSON.stringify({
            type: "start",
            bbox: bbox,
            layer: "gis_osm_buildings_a_free_1",
            res: 7
        }))
        console.log("bbox:", bbox)

        PAUSE_RENDER = false

        // 只在第一次点击时启动 RAF 循环
        if (!STARTED) {
            STARTED = true
            lastTime = performance.now()
            requestAnimationFrame(frame)
        }
    })

    document.getElementById("stopBtn").onclick = () => {
        ws.send(JSON.stringify({ type: "stop" }))
        PAUSE_RENDER = true
    }


})