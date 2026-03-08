/*
struct FSIn {
    @location(0) normal : vec3 < f32>,
    @location(1) @interpolate(flat) id : u32,
};

struct FSOut {
    @location(0) color : vec4 < f32>,
};

struct Interaction {
    id_selected : u32,
    _pad0 : u32,
    _pad1 : u32,
    _pad2 : u32,
};

@group(0) @binding(2)
var<uniform> interaction : Interaction;

@fragment
fn fragmentMain(input : FSIn) -> FSOut {
    var out : FSOut;
    let red = vec4 < f32 > (0.75, 0.12, 0.12, 1.0);
    let yellow = vec4 < f32 > (0.95, 0.75, 0.18, 1.0);
    if (interaction.id_selected != 0u && input.id == interaction.id_selected)
    {
        out.color = vec4 < f32 > (0.75, 0.12, 0.12, 1.0);
    } else {
        out.color = vec4 < f32 > (0.95, 0.75, 0.18, 1.0);
    }
    let n = normalize(input.normal);
    let lightDir = normalize(vec3 < f32 > (-1, -1, 1));
    let diff = max(dot(n, lightDir), 0.0);
    let ambient = 0.2;
    let lit = ambient + diff;
    out.color = vec4(out.color.rgb * lit, out.color.a);
    return out;
}
*/

struct FSIn {
    @location(0) normal : vec3 < f32>,
    @location(1) @interpolate(flat) id : u32,
};

struct FSOut {
    @location(0) color : vec4 < f32>,
};

struct Interaction {
    id_selected : u32,
    _pad0 : u32,
    _pad1 : u32,
    _pad2 : u32,
};

@group(0) @binding(2)
var<uniform> interaction : Interaction;

@fragment
fn fragmentMain(input : FSIn) -> FSOut {
    var out : FSOut;

    let red = vec3 < f32 > (0.75, 0.12, 0.12);
    let yellow = vec3 < f32 > (0.95, 0.75, 0.18);
    let orange = vec3 <f32> (0.94510, 0.60000, 0.34510);
    let blue = vec3 <f32> (0.25098, 0.55686, 0.79608);

    var baseColor : vec3 < f32>;
    if (interaction.id_selected != 0u && input.id == interaction.id_selected)
    {
        baseColor = orange;
    } else {
        baseColor = blue;
    }

    let n = normalize(input.normal);

    //主方向光（太阳）
    let lightDir = normalize(vec3 < f32 > (-0.7, -0.6, 0.9));
    let diff = max(dot(n, lightDir), 0.0);

    //天空光：朝上的面更亮
    let sky = 0.35 + 0.35 * max(n.z, 0.0);

    //地面反射光：朝下或侧面的面也不要太死黑
    let bounce = 0.12 * max(-n.z, 0.0);

    //半兰伯特，让阴影区别太黑
    let softDiff = diff * 0.65 + 0.35;

    //伪高光：不需要 viewDir，先做个轻微的太阳高光
    let halfDir = normalize(lightDir + vec3 < f32 > (0.0, 0.0, 1.0));
    let spec = pow(max(dot(n, halfDir), 0.0), 24.0) * 0.18;

    //合成
    let lighting = sky + bounce + diff * 0.55;

    //稍微压一下过曝
    let color = baseColor * lighting + vec3 < f32 > (spec);

    out.color = vec4 < f32 > (color, 1.0);
    return out;
}
