struct FSIn {
    @location(0) nrm : vec3 < f32>,
};

struct FSOut {
    @location(0) color : vec4 < f32>,
};

@fragment
fn fragmentMain(input : FSIn) -> FSOut {
    var out : FSOut;
    out.color = vec4 < f32 > (1.0, 0.0, 0.0, 1.0);
    return out;
}
