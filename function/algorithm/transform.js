import { mat4, vec3 } from "../../node_modules/gl-matrix/esm/index.js";

export function transform(matrix, center, angles, translation) {
    const T_center = mat4.create();   // 把原点移到 center
    const T_center_inv = mat4.create(); // 把原点移回
    const T_translate = mat4.create(); // 额外平移
    const RX = mat4.create();
    const RY = mat4.create();
    const RZ = mat4.create();
    const R = mat4.create();

    // 平移到旋转中心
    mat4.translate(T_center, T_center, center);
    mat4.translate(T_center_inv, T_center_inv, vec3.negate([], center));

    // 旋转矩阵
    mat4.fromXRotation(RX, angles[0]);
    mat4.fromYRotation(RY, angles[1]);
    mat4.fromZRotation(RZ, angles[2]);

    mat4.multiply(R, RX, RY);
    mat4.multiply(R, R, RZ);

    // 平移矩阵
    mat4.translate(T_translate, T_translate, translation);

    // 合成矩阵: T_translate * T_center * R * T_center_inv
    mat4.identity(matrix);
    mat4.multiply(matrix, matrix, T_translate);
    mat4.multiply(matrix, matrix, T_center);
    mat4.multiply(matrix, matrix, R);
    mat4.multiply(matrix, matrix, T_center_inv);

    return matrix;
}