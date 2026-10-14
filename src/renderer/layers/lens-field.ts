/**
 * Optional WebGL2 liquid field behind the shell.
 *
 * Glass carries the controls, liquid shows continuous change, and light shows
 * state. That split is adapted from Lens (透镜) by DayDreamInAReverie:
 * https://github.com/ruiqichenbiec/design-systems
 * Copyright (c) 2026 DayDreamInAReverie. MIT. Provided as-is; the author no
 * longer maintains it. This shader is original Tide code. The Lens repository
 * is not copied here. If WebGL2 is missing or a frame runs long, the canvas
 * is removed and the CSS wash remains.
 */

const VERT = `#version 300 es
void main() {
  vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform float uPhase;
uniform float uDusk;
uniform vec2 uRes;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float p = uPhase;
  vec2 warp = uv + 0.018 * vec2(sin(uv.y * 7.0 + p * 6.283), cos(uv.x * 6.0 - p * 6.283));
  vec2 a = vec2(0.2 + p * 0.26, 0.74 - p * 0.1);
  vec2 b = vec2(0.76 - p * 0.2, 0.3 + p * 0.16);
  float da = length((warp - a) * vec2(1.2, 1.0));
  float db = length((warp - b) * vec2(1.0, 1.25));
  vec3 tideA = vec3(0.11, 0.52, 0.51);
  vec3 tideB = vec3(0.16, 0.30, 0.58);
  vec3 duskA = vec3(0.70, 0.40, 0.26);
  vec3 duskB = vec3(0.48, 0.18, 0.28);
  vec3 ca = mix(tideA, duskA, uDusk);
  vec3 cb = mix(tideB, duskB, uDusk);
  vec3 base = mix(vec3(0.027, 0.055, 0.08), vec3(0.09, 0.04, 0.055), uDusk);
  vec3 color = base;
  color = mix(color, ca, smoothstep(0.58, 0.0, da));
  color = mix(color, cb, smoothstep(0.52, 0.0, db) * 0.85);
  float sheen = smoothstep(0.62, 0.0, length(uv - vec2(0.18 + p * 0.08, 0.16)));
  color += mix(vec3(0.75, 0.92, 0.95), vec3(1.0, 0.86, 0.72), uDusk) * sheen * 0.09;
  outColor = vec4(color, 1.0);
}`;

export interface LensField {
  canvas: HTMLCanvasElement;
  draw: (phase: number, dusk: boolean) => boolean;
  resize: () => void;
  destroy: () => void;
}

export function mountLensField(root: HTMLElement): LensField | null {
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement("canvas");
  } catch {
    return null;
  }
  canvas.className = "lens-field";
  canvas.setAttribute("aria-hidden", "true");
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
  } catch {
    gl = null;
  }
  if (!gl) return null;

  const program = link(gl, VERT, FRAG);
  if (!program) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }

  const phaseLoc = gl.getUniformLocation(program, "uPhase");
  const duskLoc = gl.getUniformLocation(program, "uDusk");
  const resLoc = gl.getUniformLocation(program, "uRes");
  let dead = false;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
    const width = Math.max(2, Math.floor(root.clientWidth * ratio * 0.5));
    const height = Math.max(2, Math.floor(root.clientHeight * ratio * 0.5));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const draw = (phase: number, dusk: boolean): boolean => {
    if (!gl || gl.isContextLost()) return false;
    const started = performance.now();
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.uniform1f(phaseLoc, Number.isFinite(phase) ? phase : 0.5);
    gl.uniform1f(duskLoc, dusk ? 1 : 0);
    gl.uniform2f(resLoc, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return performance.now() - started < 12;
  };

  const destroy = () => {
    if (dead) return;
    dead = true;
    canvas.remove();
    const context = gl;
    gl = null;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  };

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    destroy();
  });

  return { canvas, draw, resize, destroy };
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram | null {
  const program = gl.createProgram();
  const vs = shader(gl, gl.VERTEX_SHADER, vert);
  const fs = shader(gl, gl.FRAGMENT_SHADER, frag);
  if (!program || !vs || !fs) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "position");
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  return program;
}

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const item = gl.createShader(type);
  if (!item) return null;
  gl.shaderSource(item, source);
  gl.compileShader(item);
  if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
    gl.deleteShader(item);
    return null;
  }
  return item;
}
