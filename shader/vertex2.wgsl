struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vid: u32) -> VSOut {
    var out: VSOut;

    let pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),

        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0),
    );

    let p = pos[vid];
    out.pos = vec4<f32>(p, 0.0, 1.0);

    // NDC [-1, 1] -> UV [0, 1]
    out.uv = (p * 0.5) + vec2<f32>(0.5, 0.5);

    return out;
}