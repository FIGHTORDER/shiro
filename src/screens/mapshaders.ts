/**
 * The two shaders the 3D map view draws with, kept as data so they can be
 * compiled and checked without mounting a component.
 *
 * Height arrives already scaled to 0..1 and is lifted in the vertex stage, so
 * the same mesh serves every setting of the height control. The normal is
 * divided by the same lift, because scaling only y tilts a surface and the
 * shading has to follow.
 */

export const VERT: string = [
  "attribute vec3 a_pos;",
  "attribute vec3 a_normal;",
  "attribute vec2 a_uv;",
  "uniform mat4 u_mvp;",
  "uniform float u_lift;",
  "varying vec2 v_uv;",
  "varying vec3 v_normal;",
  "varying float v_height;",
  "void main() {",
  "  vec3 p = vec3(a_pos.x, a_pos.y * u_lift, a_pos.z);",
  "  v_uv = a_uv;",
  "  v_normal = normalize(vec3(a_normal.x, a_normal.y / max(u_lift, 0.001), a_normal.z));",
  "  v_height = a_pos.y;",
  "  gl_Position = u_mvp * vec4(p, 1.0);",
  "}",
].join("\n");

export const FRAG: string = [
  "precision mediump float;",
  "uniform sampler2D u_colour;",
  "uniform float u_water;",
  "uniform float u_showWater;",
  "varying vec2 v_uv;",
  "varying vec3 v_normal;",
  "varying float v_height;",
  "void main() {",
  "  vec3 base = texture2D(u_colour, v_uv).rgb;",
  "  vec3 n = normalize(v_normal);",
  "  vec3 sun = normalize(vec3(0.45, 0.8, 0.35));",
  "  float lambert = max(dot(n, sun), 0.0);",
  "  vec3 lit = base * (0.55 + 0.65 * lambert);",
  "  if (u_showWater > 0.5 && v_height < u_water) {",
  "    float depth = clamp((u_water - v_height) * 5.0, 0.0, 0.75);",
  "    lit = mix(lit, vec3(0.13, 0.32, 0.52), 0.45 + depth * 0.4);",
  "  }",
  "  gl_FragColor = vec4(lit, 1.0);",
  "}",
].join("\n");
