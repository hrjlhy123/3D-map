import { mat4, vec3 } from "../node_modules/gl-matrix/esm/index.js";

"use strict";
let canvas, ready = {
    GPU: false,
    stream: false,
    buildings: false
}
window.addEventListener(`DOMContentLoaded`, async () => {
    /* == Initialization == */
    let context, adapter, device, format_canvas, alphaMode, devicePixelRatio

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

        {
            format_canvas = navigator.gpu.getPreferredCanvasFormat()
            alphaMode = `premultiplied`
            devicePixelRatio = window.devicePixelRatio || 1
            canvas.width = canvas.clientWidth * devicePixelRatio
            canvas.height = canvas.clientHeight * devicePixelRatio
            console.log(`Canvas size:`, canvas.width, `x`, canvas.height)
        }

        context.configure({
            device: device,
            format: format_canvas,
            alphaMode: alphaMode,
            size: [canvas.width, canvas.height],
        })
    }

    /* == Data Preprocessing == */
    let GPUResources = {
        data: {
            pending: [],
            rendering: [],
        },
        buffer: {},
        bindGroup: {},
        bindGroupLayout: {},
        bufferLayout: {
            vertex: {}
        },
        pipelineLayout: null,
        renderPipeline: {}
    }

    const SCALE = 100000.0;
    {
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
        }

        {
            const lon0 = -122.29499816894531;
            const lat0 = 47.575477600097656;

            const invScale = 1.0 / SCALE;  // 0.00001

            const baseX = lon0 * invScale;
            const baseY = lat0 * invScale;

            const d = invScale;

            const debugPos = new Float32Array([
                baseX - d, baseY - d, 0.0,
                baseX + d, baseY - d, 0.0,
                baseX, baseY + d, 0.0,
            ]);

            // const debugPos = new Float32Array([
            //     lon0 - d, lat0 - d, 0,
            //     lon0 + d, lat0 - d, 0,
            //     lon0, lat0 + d, 0
            // ]);

            const debugNrm = new Float32Array([
                0, 0, 1,
                0, 0, 1,
                0, 0, 1,
            ])

            GPUResources.buffer.debugPos = device.createBuffer({
                size: debugPos.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            })
            device.queue.writeBuffer(GPUResources.buffer.debugPos, 0, debugPos)

            GPUResources.buffer.debugNrm = device.createBuffer({
                size: debugNrm.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            })
            device.queue.writeBuffer(GPUResources.buffer.debugNrm, 0, debugNrm)
        }
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
                    }
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

        {
            GPUResources.bufferLayout.vertex.position = {
                arrayStride: 12, // 3 x 4 bytes = 12 bytes
                attributes: [
                    {
                        shaderLocation: 0,
                        offset: 0,
                        format: `float32x3`,
                    }
                ]
            }
            GPUResources.bufferLayout.vertex.normal = {
                arrayStride: 12, // 3 x 4 bytes = 12 bytes
                attributes: [
                    {
                        shaderLocation: 1,
                        offset: 0,
                        format: `float32x3`,
                    }
                ]
            }
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
    };
    {
        /* === Model Data === */
        // fetch data (websocket)
        const ws = new WebSocket("ws://localhost:8080")

        ws.onopen = () => log.textContent += "connected\n"

        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data)

            if (msg.type == `feature`) {
                // GPUResources.data.push(msg)
                GPUResources.data.pending.push(msg)
                stats.received++;
                stats.lastIndex = msg.index ?? stats.lastIndex;
                ready.stream = true
                return
            }

            if (msg.type == `done`) {
                console.log(`GPUResources.data.rendering:`, GPUResources.data.rendering)
                console.log("Stream done", { received: stats.received, lastIndex: stats.lastIndex });
                return
            }
        }

        setInterval(() => {
            console.log("[progress]", {
                received: stats.received,
                pending: GPUResources.data.pending.length,
                rendering: GPUResources.data.rendering.length,
                processed: stats.processed,
                errors: stats.errors,
                lastIndex: stats.lastIndex,
            });
        }, 1000);

        document.getElementById("startBtn").onclick = () => {
            ws.send(JSON.stringify({ type: "start", bbox: bbox, limit: +1000000000, sample: +1000000000 }))
        }

        document.getElementById("stopBtn").onclick = () => {
            ws.send(JSON.stringify({ type: "stop" }))
        }
        // Preprocess data (height)
        const part_extrude = (part, height) => {
            if (!Array.isArray(part.data) || part.data.length < 6) {
                throw new Error(`part.data must contain at least 3 points (>= 6 numbers).`)
            }
            if (!Array.isArray(part.indices) || part.indices.length < 3) {
                throw new Error(`part.indices must contain at least 1 triangle (>= 3 numbers).`)
            }
            const n = Math.floor(part.data.length / 2)

            // Normalize 2D vector (x, y). If too small, return (0, 0).
            const norm2 = (x, y) => {
                const len = Math.hypot(x, y)
                if (len < 1e-12) return [0, 0]
                return [x / len, y / len]
            }

            const positions = []
            const normals = []
            const indices = []

            const vertex_push = (x, y, z, nx, ny, nz) => {
                const index = positions.length / 3
                positions.push(x, y, z)
                normals.push(nx, ny, nz)
                return index
            }

            // ROOF vertices (shared)
            const roofBase = 0
            for (let i = 0; i < n; i++) {
                const x = part.data[i * 2 + 0]
                const y = part.data[i * 2 + 1]
                vertex_push(x, y, height, 0, 0, 1)
            }

            // GROUND vertices (shared, optional)
            const groundBase = positions.length / 3
            for (let i = 0; i < n; i++) {
                const x = part.data[i * 2 + 0]
                const y = part.data[i * 2 + 1]
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
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n
                const xi = part.data[i * 2 + 0]
                const yi = part.data[i * 2 + 1]
                const xj = part.data[j * 2 + 0]
                const yj = part.data[j * 2 + 1]

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
                positions: new Float32Array(positions),
                normals: new Float32Array(normals),
                indices: new Uint32Array(indices),
                meta: {
                    vertexCount: positions.length / 3,
                    triangleCount: indices.length / 3,
                    height
                }
            }
        }

        // Deploy data
        data_deploy = (device, maxPerFrame = 100000) => {
            for (let i = 0; i < maxPerFrame && GPUResources.data.pending.length; i++) {
                const building = GPUResources.data.pending.shift()

                // extrude
                building.parts = building.parts.map(p => part_extrude(p, 15))

                for (const part of building.parts) {
                    part.buffer = {}

                    part.buffer.vertex = device.createBuffer({
                        label: `Vertex Buffer for ${building.name}`,
                        size: part.positions.byteLength,
                        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                    })
                    device.queue.writeBuffer(part.buffer.vertex, 0, part.positions)

                    part.buffer.normal = device.createBuffer({
                        label: `Normal Buffer for ${building.name}`,
                        size: part.normals.byteLength,
                        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                    })
                    device.queue.writeBuffer(part.buffer.normal, 0, part.normals)

                    part.buffer.index = device.createBuffer({
                        label: `Index Buffer for ${building.name}`,
                        size: part.indices.byteLength,
                        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
                    })
                    device.queue.writeBuffer(part.buffer.index, 0, part.indices)

                    part.indexCount = part.indices.length
                }

                GPUResources.data.rendering.push(building)

                if (!ready.buildings) {
                    ready.buildings = true
                    console.log(`Start rendering!`)
                }

                stats.processed++;
            }
        }

        /* === Camera/Transform Data === */
        let fov, aspect, near, far
        {
            {
                fov = 30 * Math.PI / 180
                aspect = canvas.width / canvas.height
                near = 0.00001;
                far = 60000.0;
                matrix.projection = mat4.create()
                mat4.perspective(matrix.projection, fov, aspect, near, far)
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
            let center
            const lon0 = -122.29499816894531;
            const lat0 = 47.575477600097656;
            {
                matrix.transform = mat4.create()
                // const fallbackCenter = [-122.29499816894531, 47.575477600097656, 0]
                // center = fallbackCenter.map(v => -v)
                center = [-lon0, -lat0, 0.0]
                // mat4.translate(matrix.transform, matrix.transform, center)
                mat4.scale(matrix.transform, matrix.transform, [SCALE, SCALE, 1.0])
                // mat4.translate(matrix.transform, matrix.transform, center);
                mat4.translate(matrix.transform, matrix.transform, center)
            }
            console.log(`eye: ${eye}, center: ${center}, dist: ${vec3.distance(eye, center)}, near: ${near}`)

            // Calculate the bbox
            {
                const halfHeightWorld = Math.tan(fov / 2) * dist
                const halfWidthWorld = halfHeightWorld * aspect

                const halfLon = halfWidthWorld / SCALE
                const halfLat = halfHeightWorld / SCALE

                const SAFETY = 1.0

                bbox = {
                    minLon: lon0 - halfLon * SAFETY,
                    maxLon: lon0 + halfLon * SAFETY,
                    minLat: lat0 - halfLat * SAFETY,
                    maxLat: lat0 + halfLat * SAFETY,
                }

                console.log(`bbox:`, bbox)
            }

            {
                device.queue.writeBuffer(GPUResources.buffer.camera, 0, matrix.projection)
                device.queue.writeBuffer(GPUResources.buffer.camera, 64, matrix.view)
                device.queue.writeBuffer(GPUResources.buffer.transform, 0, matrix.transform)
            }
        }
    }

    /* == Shader == */
    let shader = {
        path: {
            vertex: `./shader/vertex.wgsl`,
            fragment: `./shader/fragment.wgsl`,
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
    }

    /* == Texture == */
    let texture = {
        MSAA: null,
        colorAccumulated: null,
        colorResolved: null,
        depth: null,
        alphaAccumulated: null,
        alphaResolved: null
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
        texture.depth = device.createTexture({
            size: [canvas.width, canvas.height],
            format: `depth24plus`,
            sampleCount: 1,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })
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
                    GPUResources.bufferLayout.vertex.normal
                ]
            },
            fragment: {
                module: shader.module.fragment,
                entryPoint: `fragmentMain`,
                targets: [{ format: format_canvas }]
            },
            multisample: {
                count: 1
            },
        })

        ready.GPU = true
    }

    // === Bind Mouse Control ===
    let yaw, deltaAngle, scrollSpeed, rangeAngle, rotateGlobal
    let lastX = null;
    deltaAngle = 0
    scrollSpeed = 0.01
    rangeAngle = [-10, 10]
    {
        yaw = 0
        canvas.addEventListener(`mousemove`, (e) => {
            if (e.buttons == 1) {
                yaw += e.movementX * 0.005
                // console.log(`yaw:`, yaw)
            }
        })

        // 把所有鼠标位移统一进队列，逐帧消化
        let pending = 0;
        let animating = false;

        const speed = 0.00035;   // 像素 → 弧度 的比例
        const maxPerFrame = 75;  // 每帧最多消化多少像素（平滑关键参数）
        const minYaw = 0;
        const maxYaw = Math.PI / 6;

        function clamp(v, lo, hi) {
            return Math.max(lo, Math.min(hi, v));
        }

        function step() {
            if (Math.abs(pending) < 0.01) { // 足够小就停
                pending = 0;
                animating = false;
                return;
            }

            // 本帧拿一小口像素量来转
            const take = Math.sign(pending) * Math.min(Math.abs(pending), maxPerFrame);
            pending -= take;

            // 方向：向右移动 → yaw 减小（你之前的反向规则）
            yaw -= take * speed;
            yaw = clamp(yaw, minYaw, maxYaw);

            requestAnimationFrame(step);
        }

        function kick() {
            if (!animating) {
                animating = true;
                requestAnimationFrame(step);
            }
        }
    }
    const wheelResistance = () => {
        if (Math.abs(deltaAngle) < 0.01) {
            deltaAngle = 0
            return
        }
        deltaAngle *= 0.95  // 每帧逐渐衰减
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
        });

        renderPass.setPipeline(GPUResources.renderPipeline.model)
        renderPass.setBindGroup(0, GPUResources.bindGroup.global)

        // debug triangle
        renderPass.setVertexBuffer(0, GPUResources.buffer.debugPos)
        renderPass.setVertexBuffer(1, GPUResources.buffer.debugNrm)
        renderPass.draw(3, 1, 0, 0)

        matrix.identity = mat4.create()
        mat4.identity(matrix.identity)

        // Mouse Control
        {
            rotateGlobal = mat4.create()
            mat4.fromYRotation(rotateGlobal, yaw)
            matrix.world = mat4.create()
            mat4.multiply(matrix.world, rotateGlobal, matrix.transform)
            device.queue.writeBuffer(GPUResources.buffer.transform, 0, matrix.world)
        }

        for (const building of GPUResources.data.rendering) {
            if (!building?.parts) continue

            for (const part of building.parts) {
                if (!part?.buffer?.vertex || !part?.buffer?.normal || !part?.buffer?.index || !part?.indexCount) continue
                renderPass.setVertexBuffer(0, part.buffer.vertex)
                renderPass.setVertexBuffer(1, part.buffer.normal)
                renderPass.setIndexBuffer(part.buffer.index, `uint32`)
                renderPass.drawIndexed(part.indexCount, 1, 0, 0, 0)
            }
            // console.log("[draw]", building.name)
        }

        renderPass.end()

        device.queue.submit([encoder.finish()])
    }

    // === Render ===
    let frame, lastTime, deltaTime
    lastTime = performance.now()
    frame = async (now) => {
        deltaTime = (now - lastTime) / 1000
        lastTime = now
        data_deploy(device, 10)

        wheelResistance()
        render(deltaTime)

        requestAnimationFrame(frame)
    }
    frame()
})