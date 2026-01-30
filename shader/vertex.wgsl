struct Camera {
    proj: mat4x4<f32>,
    view: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera : Camera;

struct World {
    m: mat4x4<f32>,
};

@group(0) @binding(1) var<storage, read> world : World;

struct VSIn {
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
};

struct VSOut {
    @builtin(position) clipPos : vec4<f32>,
    @location(0) nrm : vec3<f32>,
};

@vertex
fn vertexMain(input: VSIn) -> VSOut {
    var out: VSOut;

    let wp = world.m * vec4<f32>(input.position, 1.0);
    out.clipPos = camera.proj * camera.view *wp;

    out.nrm = normalize((world.m * vec4<f32>(input.normal, 0.0)).xyz);

    return out;
}