struct Camera {
    proj: mat4x4<f32>,
    view: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> world: mat4x4<f32>;

struct VSIn {
    @location(0) pos: vec3<f32>,
    @location(1) nrm: vec3<f32>,
    @location(2) id: u32,
};

struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) nrm: vec3<f32>,
    @location(1) @interpolate(flat) id: u32,
};

@vertex
fn vertexMain(input: VSIn) -> VSOut {
    var out: VSOut;
    let p = world * vec4<f32>(input.pos, 1.0);
    out.position = camera.proj * camera.view * p;
    out.id = input.id;
    return out;
}

@fragment
fn fragmentMain(input: VSOut) -> @location(0) u32 {
    return input.id;
}