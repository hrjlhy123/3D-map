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

            canvas = document.querySelector(`canvas`) ?? (() => {
                throw new Error(`Could not access canvas`)
            })()

            context = canvas.getContext(`webgpu`) ?? (() => {
                throw new Error(`Could not obtain WebGPU context for canvas`)
            })()

            adapter = await navigator.gpu.requestAdapter() ?? (() => {
                throw new Error(`Could not obtain GPU adapter`)
            })()

            device = await adapter.requestDevice() ?? (() => {
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
                size: 268435456, // 256MB x 1024 x 1024
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
                size: 67108864, // 64MB x 1024 x 1024
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

        const POOL_TARGET = 100_000_000;     // 池子凑到多少个 building 就 flush 一次（你可调 300~3000）
        const POOL_MAX_HOLD_MS = 1_000;  // 最多憋多久就必须 flush（避免“憋很久一坨”）

        let pool = [];
        let poolLastFlush = performance.now();

        // function buildingDist2(msg) {
        //     // msg.parts: [ {data:[lon,lat,...], holes, indices}, ... ]
        //     const p0 = msg?.parts?.[0];
        //     const data = p0?.data;
        //     if (!data || data.length < 2) return Number.POSITIVE_INFINITY;
        //     const lon = data[0], lat = data[1];
        //     const dx = lon - centerLon;
        //     const dy = lat - centerLat;
        //     return dx * dx + dy * dy;
        // }
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
                // positions_and_normals[o + 0] = lon
                // positions_and_normals[o + 1] = lat
                // positions_and_normals[o + 2] = z0
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
        //// 3D building
        const part_extrude = (part, height) => {
            if (!Array.isArray(part.data) || part.data.length < 6) {
                throw new Error(`part.data must contain at least 3 points (>= 6 numbers).`)
            }
            if (!Array.isArray(part.indices) || part.indices.length < 3) {
                throw new Error(`part.indices must contain at least 1 triangle (>= 3 numbers).`)
            }
            const vertexCount = Math.floor(part.data.length / 2)

            // Normalize 2D vector (x, y). If too small, return (0, 0).
            const norm2 = (x, y) => {
                const len = Math.hypot(x, y)
                if (len < 1e-12) return [0, 0]
                return [x / len, y / len]
            }

            const positions_and_normals = []
            const indices = []

            const vertex_push = (x, y, z, nx, ny, nz) => {
                const index = positions_and_normals.length / 6
                positions_and_normals.push(x, y, z, nx, ny, nz)
                return index
            }

            const ringENU = [];
            for (let i = 0; i < vertexCount; i++) {
                const lon = part.data[i * 2 + 0];
                const lat = part.data[i * 2 + 1];
                const ecef = lonLatHeightToECEF(lon, lat, 0);
                const [x, y, z] = ecefToENU(ecef, enuFrame);
                ringENU.push([x, y, z]);
            }

            // ROOF vertices (shared)
            const roofBase = 0
            for (let i = 0; i < vertexCount; i++) {
                const x = ringENU[i][0]
                const y = ringENU[i][1]
                vertex_push(x, y, height, 0, 0, 1)
            }

            // GROUND vertices (shared, optional)
            const groundBase = positions_and_normals.length / 6
            for (let i = 0; i < vertexCount; i++) {
                const x = ringENU[i][0]
                const y = ringENU[i][1]
                vertex_push(x, y, 0, 0, 0, -1)
            }

            // ROOF indices
            for (let k = 0; k < part.indices.length; k += 3) {
                indices.push(
                    roofBase + part.indices[k + 0],
                    roofBase + part.indices[k + 1],
                    roofBase + part.indices[k + 2]
                )
            }

            // GROUND indices
            for (let k = 0; k < part.indices.length; k += 3) {
                const a = groundBase + part.indices[k + 0]
                const b = groundBase + part.indices[k + 1]
                const c = groundBase + part.indices[k + 2]
                indices.push(a, c, b)
            }

            // WALLS (outer ring only)
            for (let i = 0; i < vertexCount; i++) {
                const j = (i + 1) % vertexCount
                const xi = ringENU[i][0]
                const yi = ringENU[i][1]
                const xj = ringENU[j][0]
                const yj = ringENU[j][1]

                const dx = xj - xi
                const dy = yj - yi
                // Because OUTER ring is CCW, outward normal for an edge (dx, dy) is (dy, -dx).
                const [nx, ny] = norm2(dy, -dx)

                const bi = vertex_push(xi, yi, 0, nx, ny, 0)
                const bj = vertex_push(xj, yj, 0, nx, ny, 0)
                const tj = vertex_push(xj, yj, height, nx, ny, 0)
                const ti = vertex_push(xi, yi, height, nx, ny, 0)

                indices.push(bi, bj, tj)
                indices.push(bi, tj, ti)
            }

            return {
                positions_and_normals: new Float32Array(positions_and_normals),
                indices: new Uint32Array(indices),
                meta: {
                    vertexCount: positions_and_normals.length / 6,
                    triangleCount: indices.length / 3,
                    height
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
            const BUDGET_MS = 24.0 // ?ms / frame to avoid lag
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
                    building.parts = building.parts.map(p => part_extrude(p, 15))
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

        setInterval(() => {
            console.log("[progress]", {
                received: stats.received,
                pending: GPUResources.data.pending.length,
                processed: stats.processed,
                errors: stats.errors,
                lastIndex: stats.lastIndex,
            });
        }, 1000);

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
                        -(dx * frame.east[0] + dy * frame.east[1] + dz * frame.east[2]),   // x = east
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
                frontFace: 'cw',   // ✅ 关键
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
                frontFace: 'cw',   // ✅ 关键
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

    // /* == Camera Controller == */
    // // (yaw/pitch/zoom/pan)
    // // 左键拖动：yaw/pitch
    // // 中键(滚轮按下)拖动：平移（屏幕上下左右）
    // // 滚轮：缩放（zoom = 相机距离）
    // // Reset 按钮：恢复默认
    // (() => {
    //     // -------- State --------
    //     let yaw = 0;
    //     let pitch = -0.25;
    //     let zoom = 19300;
    //     let panX = 0, panY = 0;

    //     // -------- Limits --------
    //     const MIN_PITCH = -Math.PI / 2 + 0.05;
    //     const MAX_PITCH = Math.PI / 2 - 0.05;
    //     const MIN_ZOOM = 25;
    //     const MAX_ZOOM = 19300;

    //     const ROT_SENS = 0.005;   // 旋转灵敏度：越大越敏感
    //     const PAN_SENS = 16.0;       // 平移灵敏度：越大平移越快（你现在快就继续减小）
    //     const ZOOM_SENS = 4.0;  // 缩放灵敏度：越大缩放越快

    //     // zoom 自适应缩放倍率
    //     // zoom 小 = 更近（放大）=> scale 小（更慢）
    //     // zoom 大 = 更远（缩小）=> scale 大（更快）
    //     const ZOOM_REF = 800;
    //     const SCALE_MIN = 0.15;
    //     const SCALE_MAX = 2.0;

    //     const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    //     function zoomScale() {
    //         // 放大(zoom大) => scale小(更慢)
    //         // 缩小(zoom小) => scale大(更快)
    //         // console.log(`zoom:`, zoom)
    //         let t = Math.max(0, Math.min(1,
    //             (zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)
    //         ));
    //         return 1.0 + (0.05 - 1.0) * t;
    //     }

    //     // -------- Event --------
    //     canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    //     canvas.addEventListener("mousemove", (e) => {
    //         if (e.buttons === 1) {
    //             // // 左键：旋转
    //             // yaw += e.movementX * ROT_SENS;
    //             // pitch -= e.movementY * ROT_SENS;
    //             // pitch = clamp(pitch, MIN_PITCH, MAX_PITCH);
    //         } else if (e.buttons === 4 || e.buttons === 1) {
    //             // 中键：平移（屏幕空间）
    //             const s = zoomScale();                // 随 zoom 自动缩放速度
    //             // panX += e.movementX * PAN_SENS * s;
    //             // panY += e.movementY * PAN_SENS * s;  // 方向不对就把负号去掉或反过来
    //             panX += e.movementX * PAN_SENS;
    //             panY += e.movementY * PAN_SENS;
    //         }
    //     });

    //     canvas.addEventListener("wheel", (e) => {
    //         e.preventDefault();
    //         zoom += -e.deltaY * ZOOM_SENS;
    //         zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);

    //         console.log(`zoom:`, zoom,
    //             `\ne.deltaY:`, e.deltaY,
    //             `\nZOOM_SENS:`, ZOOM_SENS,
    //         )
    //     }, { passive: false });

    //     // -------- Reset --------
    //     const resetBtn = document.getElementById("resetCamBtn");
    //     if (resetBtn) {
    //         resetBtn.addEventListener("click", () => {
    //             yaw = 0; pitch = -0.25; zoom = 800; panX = 0; panY = 0;
    //         });
    //     }

    //     // -------- Apply to GPU --------
    //     window.camera = (mat4, GPUResources, device, matrix) => {
    //         const eye = [panX, panY, -zoom];
    //         const target = [panX, panY, 0];
    //         const up = [0, 1, 0];

    //         matrix.view = mat4.create();
    //         mat4.lookAt(matrix.view, eye, target, up);

    //         device.queue.writeBuffer(GPUResources.buffer.camera, 64, matrix.view);

    //         matrix.world = mat4.create(); // 保持 identity
    //         mat4.multiply(matrix.world, matrix.world, matrix.transform);
    //         device.queue.writeBuffer(GPUResources.buffer.transform, 0, matrix.world);
    //     };
    // })();

    /* == Camera Controller == */
    (() => {
        // -------- State --------
        let yaw = 0;
        let pitch = -1.15;
        let zoom = 19300;
        let panX = 0, panY = 0;

        // 鼠标在 canvas 上的像素位置（用于“按鼠标位置缩放”）
        let lastMousePx = canvas.width * 0.5;
        let lastMousePy = canvas.height * 0.5;

        // -------- Limits --------
        const MIN_ZOOM = 10;
        const MAX_ZOOM = 19300;
        const VIEW_CHANGE_ZOOM = 150; // 从这里开始视角变化，同时停止跟随鼠标缩放

        const MIN_PITCH = -1.15; // 远处俯视
        const MAX_PITCH = 0.06;  // 约 2.3°；如果你要 10°，改成 Math.PI / 18

        const PAN_SENS = 1.0;
        const WHEEL_ZOOM_K = 0.0015;

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

        function autoPitchFromZoom() {
            return pitchFromZoom(zoom);
        }

        function fovFromPitch(pitchValue) {
            const BASE_FOV = 30 * Math.PI / 180;
            const TELE_FOV = 9 * Math.PI / 180;

            if (pitchValue < 0) return BASE_FOV;

            const t = clamp(pitchValue / MAX_PITCH, 0, 1);
            const k = easeInOut(t);

            return lerp(BASE_FOV, TELE_FOV, k);
        }

        function autoFovFromZoom() {
            return fovFromPitch(pitch);
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
                console.log(`大`)
            }
        }

        // -------- Event --------
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        canvas.addEventListener("mousemove", (e) => {
            const r = canvas.getBoundingClientRect();
            const sx = (e.clientX - r.left) / r.width;
            const sy = (e.clientY - r.top) / r.height;

            lastMousePx = sx * canvas.width;
            lastMousePy = sy * canvas.height;
        });

        canvas.addEventListener("mousemove", (e) => {
            if (e.buttons === 4 || e.buttons === 1) {
                const s = panScale();
                panX -= e.movementX * PAN_SENS * s;
                panY += e.movementY * PAN_SENS * s;
            }
        });

        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();

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
        }, { passive: false });

        // -------- Reset --------
        const resetBtn = document.getElementById("resetCamBtn");
        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                yaw = 0;
                pitch = MIN_PITCH;
                zoom = 800;
                panX = 0;
                panY = 0;
                lastMousePx = canvas.width * 0.5;
                lastMousePy = canvas.height * 0.5;
            });
        }

        // -------- Apply to GPU --------
        window.camera = (mat4, GPUResources, device, matrix) => {
            pitch = autoPitchFromZoom();

            const currentFov = autoFovFromZoom();
            const currentAspect = canvas.width / canvas.height;

            mat4.perspectiveZO(matrix.projection, currentFov, currentAspect, near, far);
            device.queue.writeBuffer(GPUResources.buffer.camera, 0, matrix.projection);

            const up = [0, 0, 1];
            const anchor = [panX, panY, 0];
            const lookAhead = 60.0;

            let eye, target;

            if (pitch < 0) {
                const eyeHeight = Math.max(2.0, Math.sin(-pitch) * zoom);
                const eyeBack = Math.max(0.0, Math.cos(-pitch) * zoom);

                eye = [
                    anchor[0],
                    anchor[1] - eyeBack,
                    anchor[2] + eyeHeight
                ];

                target = [
                    anchor[0],
                    anchor[1] + lookAhead,
                    anchor[2] + lookAhead * Math.tan(pitch * 0.35)
                ];
            } else {
                const tHead = clamp(pitch / MAX_PITCH, 0, 1);
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
                    eye[2] + lookAhead * Math.tan(pitch)
                ];
            }

            matrix.view = mat4.create();
            mat4.lookAt(matrix.view, eye, target, up);
            device.queue.writeBuffer(GPUResources.buffer.camera, 64, matrix.view);

            matrix.world = mat4.create();
            mat4.multiply(matrix.world, matrix.world, matrix.transform);
            device.queue.writeBuffer(GPUResources.buffer.transform, 0, matrix.world);
        };
    })();
    
    /* == Interaction == */
    let mouseX = 0, mouseY = 0, hovered = 0, id_last_hover = 0, pending = false
    {
        canvas.addEventListener("mousemove", (e) => {
            const r = canvas.getBoundingClientRect();
            mouseX = (e.clientX - r.left) / r.width;
            mouseY = (e.clientY - r.top) / r.height;
            // console.log(`mouseX: ${mouseX}, mouseY: ${mouseY}`)
        })

        canvas.addEventListener('mouseleave', () => {
            hovered = 0;
        });

        let id_selected = 0;
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
            const interactionU32 = new Uint32Array(4)
            interactionU32[0] = id_selected;
            device.queue.writeBuffer(GPUResources.buffer.interaction, 0, interactionU32);

            id_last_hover = id_selected
            // pending = false
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
                    clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
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

    // === Render ===
    let frame, lastTime, deltaTime, PAUSE_RENDER = false
    lastTime = performance.now()
    frame = async (now) => {
        deltaTime = (now - lastTime) / 1000
        lastTime = now
        data_deploy(device)
        camera(mat4, GPUResources, device, matrix);
        await interaction(deltaTime)
        render(deltaTime)
        requestAnimationFrame(frame)
    }
    frame()


    // Page
    document.getElementById("startBtn").onclick = () => {
        ws.send(JSON.stringify({
            type: "start",
            bbox: bbox,
            layer: "gis_osm_buildings_a_free_1",
            res: 7
        }))
        PAUSE_RENDER = false
    }

    document.getElementById("stopBtn").onclick = () => {
        ws.send(JSON.stringify({ type: "stop" }))
        PAUSE_RENDER = true
    }
})