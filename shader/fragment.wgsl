struct FSIn {
    @location(0) normal : vec3 < f32>,
    @location(1) @interpolate(flat) id: u32,
};

struct FSOut {
    @location(0) color : vec4 < f32>,
};

struct Interaction {
    id_selected: u32, 
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(2)
var<uniform> interaction: Interaction;

@fragment
fn fragmentMain(input : FSIn) -> FSOut {
    var out : FSOut;
    let red = vec4 < f32 > (0.75,0.12,0.12, 1.0);
    let yellow = vec4 < f32 > (0.95,0.75,0.18, 1.0);
    if (interaction.id_selected != 0u && input.id == interaction.id_selected) {
        out.color = vec4 < f32 > (0.75,0.12,0.12, 1.0);
    } else {
        out.color = vec4 < f32 > (0.95,0.75,0.18, 1.0);
    }
    let n = normalize(input.normal);
    let lightDir = normalize(vec3<f32>(1, 1, -1));
    let diff = max(dot(n, lightDir), 0.0);
    let ambient = 0.2;
    out.color = out.color * (ambient + diff);
    //out.color = vec4 < f32 > (1.0, 1.0, 0.0, 1.0);
    return out;
}
