// import { data } from "./tessellate_geojson.js";
import { transform } from "./algorithm/transform.js";
import { mat4, vec3 } from "../node_modules/gl-matrix/esm/index.js";
// import { type } from "os";

"use strict";
let canvas
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
        data: null,
        buffer: {},
        bindGroup: {},
        bindGroupLayout: {},
        bufferLayout: {
            vertex: {}
        },
        pipelineLayout: null,
        renderPipeline: {}
    }

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
            GPUResources.bindGroupLayout.composite = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {},
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {},
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
    let matrix = {}
    {
        /* === Model Data === */
        // fetch data (websocket)
        const ws = new WebSocket("ws://localhost:8080")

        ws.onopen = () => log.textContent += "connected\n"
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data)
            if (msg.type == "feature") {
                log.textContent += `#${msg.index} ${msg.name}\n`
            } else {
                log.textContent += `[${msg.type}] ${msg.message ?? ""}\n`
            }
        }

        document.getElementById("startBtn").onclick = () => {
            ws.send(JSON.stringify({ type: "start", limit: 50, sample: 5 }))
        }

        document.getElementById("stopBtn").onclick = () => {
            ws.send(JSON.stringify({ type: "stop" }))
        }

        if (GPUResources.data) {
            GPUResources.data.buildings.forEach((node) => {
                node.parts.forEach((part) => {
                    let temp_data = {}
                    part.buffer = {}

                    temp_data.vertex = new Float32Array(part.data)
                    part.buffer.vertex = device.createBuffer({
                        label: `Vertex Buffer for ${node.name}`,
                        size: temp_data.vertex.byteLength,
                        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                    })
                    device.queue.writeBuffer(part.buffer.vertex, 0, temp_data.vertex)

                    temp_data.normal = new Float32Array(temp_data.vertex.length)
                    part.buffer.normal = device.createBuffer({
                        label: `Normal Buffer for ${node.name}`,
                        size: temp_data.normal.byteLength,
                        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                    })
                    device.queue.writeBuffer(part.buffer.normal, 0, temp_data.normal)

                    temp_data.indices = new Uint32Array(part.indices)
                    part.buffer.index = device.createBuffer({
                        label: `Index Buffer for ${node.name}`,
                        size: temp_data.indices.byteLength,
                        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
                    })
                    device.queue.writeBuffer(part.buffer.index, 0, temp_data.indices)
                    part.indexCount = temp_data.indices.length
                })
            })
        }

        /* === Camera/Transform Data === */
        let fov, aspect, near, far
        {
            {
                fov = 30 * Math.PI / 180
                aspect = canvas.width / canvas.height
                near = 1
                far = 1000
                matrix.projection = mat4.create()
                mat4.perspective(matrix.projection, fov, aspect, near, far)
            }
            let dist, eye, target, up
            {
                dist = Math.max(GPUResources.data?.size ?? 0) * 2
                console.log(`dist: ${dist}`)
                eye = [0, 0, -dist]
                target = [0, 0, 0]
                up = [0, 1, 0]
                matrix.view = mat4.create()
                mat4.lookAt(matrix.view, eye, target, up)
            }
            let center
            {
                matrix.transform = mat4.create()
                center = GPUResources.data?.center.map(value => -value) ?? [0, 0, 0]
                mat4.translate(matrix.transform, matrix.transform, center)
            }
            console.log(`eye: ${eye}, center: ${center}, dist: ${vec3.distance(eye, center)}, near: ${near}`)

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
            vertex2: `./shader/vertex2.wgsl`,
            composite: `./shader/composite.wgsl`
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
        shader.module.vertex2 = device.createShaderModule({
            label: `Vertex Shader Module 2`,
            code: await fetch(shader.path.vertex2)
                .then(res => res.ok ? res.text() : ``)
                .catch(() => ``),
        })
        shader.module.composite = device.createShaderModule({
            label: `Composite Shader Module`,
            code: await fetch(shader.path.composite)
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
            sampleCount: 4,
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
        GPUResources.bindGroup.composite = device.createBindGroup({
            layout: GPUResources.bindGroupLayout.composite,
            entries: [
                {
                    binding: 0,
                    resource: texture.colorResolved.createView(),
                },
                {
                    binding: 1,
                    resource: texture.alphaResolved.createView(),
                }
            ]
        })
    }

    {
        GPUResources.pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [
                GPUResources.bindGroupLayout.global,
                GPUResources.bindGroupLayout.model,
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
                targets: [
                    {
                        format: format_canvas,
                        blend: {
                            color: {
                                srcFactor: `one`,
                                dstFactor: `zero`,
                                operation: `add`,
                            },
                            alpha: {
                                srcFactor: `one`,
                                dstFactor: `one-minus-src-alpha`,
                                operation: `add`,
                            }
                        }
                    },
                    {
                        format: `rgba16float`,
                        blend: {
                            color: {
                                srcFactor: `one`,
                                dstFactor: `zero`,
                                operation: `add`,
                            },
                            alpha: {
                                srcFactor: `one`,
                                dstFactor: `one-minus-src-alpha`,
                                operation: `add`,
                            }
                        }
                    }
                ]
            },
            depthStencil: {
                format: `depth24plus`,
                depthWriteEnabled: false,
                depthCompare: `less`,
            },
            multisample: {
                count: 4,
            },
        })

        GPUResources.renderPipeline.composite = device.createRenderPipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [GPUResources.bindGroupLayout.composite],
            }),
            vertex: {
                module: shader.module.vertex2,
                entryPoint: `vertexMain`,
            },
            fragment: {
                module: shader.module.composite,
                entryPoint: `compositeMain`,
                targets: [{
                    format: format_canvas,
                }]
            },
            primitive: {
                topology: `triangle-list`,
            }
        })
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

        document.body.addEventListener('mousemove', (e) => {
            if (lastX !== null) {
                const dx = e.clientX - lastX;
                pending += dx;

                kick();
            }
            lastX = e.clientX;
        });

        document.body.addEventListener('mouseleave', () => {
            lastX = null; // 防止回到页面时第一下跳变
        });

        window.addEventListener(`wheel`, (event) => {
            deltaAngle -= event.deltaY * scrollSpeed
            deltaAngle = Math.max(rangeAngle[0], Math.min(rangeAngle[1], deltaAngle))
        })
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
        let encoder, renderPass, compositePass
        encoder = device.createCommandEncoder()
        renderPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: texture.MSAA.createView(),
                    resolveTarget: texture.colorResolved.createView(),
                    loadOp: `clear`,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                    storeOp: `store`,
                },
                {
                    view: texture.alphaAccumulated.createView(),
                    resolveTarget: texture.alphaResolved.createView(),
                    loadOp: `clear`,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                    storeOp: `store`,
                }
            ],
            depthStencilAttachment: {
                view: texture.depth.createView(),
                depthLoadOp: `clear`,
                depthClearValue: 1.0,
                depthStoreOp: `store`,
            }
        })

        renderPass.setPipeline(GPUResources.renderPipeline.model)
        renderPass.setBindGroup(0, GPUResources.bindGroup.global)
        // renderPass.setBindGroup(1, GPUResources.bindGroup.model)

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

        for (const node of GPUResources.data.buildings) {
            if (!node?.parts) continue

            for (const part of node.parts) {
                if (!part?.buffer?.vertex || !part?.buffer?.normal || !part?.buffer?.index || !part?.indexCount) continue
                renderPass.setVertexBuffer(0, part.buffer.vertex)
                renderPass.setVertexBuffer(1, part.buffer.normal)
                renderPass.setIndexBuffer(part.buffer.index, `uint32`)
                renderPass.drawIndexed(part.indexCount, 1, 0, 0, 0)

            }
        }

        renderPass.end()

        compositePass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: `clear`,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                storeOp: `store`,
            }]
        })

        compositePass.setPipeline(GPUResources.renderPipeline.composite)
        compositePass.setBindGroup(0, GPUResources.bindGroup.composite)
        compositePass.draw(6, 1, 0, 0)
        compositePass.end()

        device.queue.submit([encoder.finish()])
    }

    // === Render ===
    let frame, lastTime, deltaTime
    lastTime = performance.now()
    frame = async (now) => {
        deltaTime = (now - lastTime) / 1000
        lastTime = now
        wheelResistance()
        render(deltaTime)
        requestAnimationFrame(frame)
    }
    // frame()
})