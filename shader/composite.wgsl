@group(0) @binding(0) var colorTex : texture_2d<f32>;
@group(0) @binding(1) var alphaTex : texture_2d<f32>; // useless

@fragment
fn compositeMain(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let dim = vec2<f32>(textureDimensions(colorTex));
    let xy = vec2<i32>(uv * dim);

    let c = textureLoad(colorTex, xy, 0);
    return vec4<f32>(c.rgb, 1.0);
}