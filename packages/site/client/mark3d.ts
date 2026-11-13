// ── [PCODE-452 | S15 | v0.1.0] Landing page: cinematic arrival of the 3D mark, framed and timed ──
// ── [PCODE-451 | S15 | v0.1.0] Landing page: steady server-room loop, 3D Orqiva mark in the finale ──
//    Why:  the finale's centrepiece: the Orqiva mark as a real 3D object, in our own WebGL2. The ring is
//          a torus whose tube is thickest at the lower left, as in the drawn mark (src/logo.ts), coloured
//          indigo → violet → magenta around it; the coral node is a sphere riding the ring, and the ring
//          is cut away around it as the logo knocks out a gap. When the section arrives the ring turns
//          in from edge-on, the node sets off on its orbit and a light sweeps the surface; then it idles
//          and follows the pointer. It only renders while on screen; paused or with reduced motion it
//          holds one finished frame. Without WebGL2 the SVG mark stays.

type M4 = Float32Array;

const mul = (a: M4, b: M4): M4 => {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      m[c * 4 + r] = s;
    }
  return m;
};
const ident = (): M4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const rotX = (a: number): M4 => {
  const m = ident();
  m[5] = Math.cos(a);
  m[6] = Math.sin(a);
  m[9] = -Math.sin(a);
  m[10] = Math.cos(a);
  return m;
};
const rotY = (a: number): M4 => {
  const m = ident();
  m[0] = Math.cos(a);
  m[2] = -Math.sin(a);
  m[8] = Math.sin(a);
  m[10] = Math.cos(a);
  return m;
};
const scaleM = (s: number): M4 => {
  const m = ident();
  m[0] = s;
  m[5] = s;
  m[10] = s;
  return m;
};
const perspective = (fov: number, aspect: number, near: number, far: number): M4 => {
  const f = 1 / Math.tan(fov / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
};
/** The camera looks down -z from (0, 0, dist). */
const view = (dist: number): M4 => {
  const m = ident();
  m[14] = -dist;
  return m;
};
const apply = (m: M4, p: [number, number, number]): [number, number, number] => [
  (m[0] ?? 0) * p[0] + (m[4] ?? 0) * p[1] + (m[8] ?? 0) * p[2] + (m[12] ?? 0),
  (m[1] ?? 0) * p[0] + (m[5] ?? 0) * p[1] + (m[9] ?? 0) * p[2] + (m[13] ?? 0),
  (m[2] ?? 0) * p[0] + (m[6] ?? 0) * p[1] + (m[10] ?? 0) * p[2] + (m[14] ?? 0),
];
// [PCODE-452 | S15 | v0.1.0] easing curves for the choreography; each is flat at its ends, so the
// motion has no jumps in speed
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const inOut = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const outQuart = (t: number): number => 1 - Math.pow(1 - clamp01(t), 4);
const outBack = (t: number): number => {
  if (t <= 0) return 0;
  const x = clamp01(t) - 1;
  return 1 + 2.2 * x * x * x + 1.2 * x * x;
};
const rotZ = (a: number): M4 => {
  const m = ident();
  m[0] = Math.cos(a);
  m[1] = Math.sin(a);
  m[4] = -Math.sin(a);
  m[5] = Math.cos(a);
  return m;
};

// the logo's colours (src/logo.ts)
const COLOURS = `
const vec3 MAGENTA = vec3(0.635, 0.169, 0.694);
const vec3 VIOLET = vec3(0.463, 0.318, 0.929);
const vec3 INDIGO = vec3(0.247, 0.165, 0.847);
const vec3 CORAL = vec3(0.996, 0.392, 0.373);
`;

const RING_VS = `#version 300 es
in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_vp;
out vec3 v_p;
out vec3 v_n;
out float v_a;
void main() {
  float a = a_uv.x * 6.2831853;
  float b = a_uv.y * 6.2831853;
  // thickest at the lower left (225°), thinnest at the upper right, as in the drawn mark
  float r = 0.215 + 0.085 * cos(a - 3.927);
  vec3 dir = vec3(cos(a), sin(a), 0.0);
  vec3 n = dir * cos(b) + vec3(0.0, 0.0, 1.0) * sin(b);
  vec4 p = u_model * vec4(dir + n * r, 1.0);
  v_p = p.xyz;
  v_n = mat3(u_model) * n;
  v_a = a;
  gl_Position = u_vp * p;
}`;

const RING_FS = `#version 300 es
precision highp float;
in vec3 v_p;
in vec3 v_n;
in float v_a;
uniform vec3 u_eye;
uniform vec3 u_node;
uniform float u_nodeR;
uniform float u_sweep;
uniform float u_fade;
out vec4 o;
${COLOURS}
vec3 ringColour(float a) {
  float d = degrees(a);
  if (d < 120.0) return mix(MAGENTA, VIOLET, d / 120.0);
  if (d < 225.0) return mix(VIOLET, INDIGO, (d - 120.0) / 105.0);
  if (d < 345.0) return mix(INDIGO, MAGENTA, (d - 225.0) / 120.0);
  return MAGENTA;
}
void main() {
  // the ring is cut away around the node, as the logo knocks out a gap
  if (distance(v_p, u_node) < u_nodeR * 1.6) discard;
  vec3 n = normalize(v_n);
  vec3 v = normalize(u_eye - v_p);
  vec3 l = normalize(vec3(-0.5, 0.8, 0.9));
  vec3 base = ringColour(v_a);
  float diff = max(dot(n, l), 0.0);
  float spec = pow(max(dot(n, normalize(l + v)), 0.0), 70.0);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 c = base * (0.32 + 0.8 * diff) + vec3(1.0) * spec * 0.6 + mix(base, vec3(0.86, 0.82, 1.0), 0.55) * fres * 0.7;
  // a light sweeping across the surface
  float s = exp(-pow((v_p.x * 0.8 + v_p.y * 0.55 - u_sweep) * 3.2, 2.0));
  c += vec3(1.0, 0.92, 1.0) * s * (0.18 + 0.6 * spec + 0.4 * fres);
  o = vec4(c * u_fade, u_fade);
}`;

const NODE_VS = `#version 300 es
in vec3 a_n;
uniform vec3 u_node;
uniform float u_nodeR;
uniform mat4 u_vp;
out vec3 v_n;
out vec3 v_p;
void main() {
  v_n = a_n;
  v_p = u_node + a_n * u_nodeR;
  gl_Position = u_vp * vec4(v_p, 1.0);
}`;

const NODE_FS = `#version 300 es
precision highp float;
in vec3 v_n;
in vec3 v_p;
uniform vec3 u_eye;
uniform float u_fade;
out vec4 o;
${COLOURS}
void main() {
  vec3 n = normalize(v_n);
  vec3 v = normalize(u_eye - v_p);
  vec3 l = normalize(vec3(-0.5, 0.8, 0.9));
  float diff = max(dot(n, l), 0.0);
  float spec = pow(max(dot(n, normalize(l + v)), 0.0), 50.0);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.0);
  vec3 c = CORAL * (0.45 + 0.7 * diff) + vec3(1.0) * spec * 0.7 + vec3(1.0, 0.7, 0.6) * fres * 0.35;
  o = vec4(c * u_fade, u_fade);
}`;

const GLOW_VS = `#version 300 es
in vec2 a_c;
uniform vec3 u_node;
uniform float u_size;
uniform mat4 u_vp;
out vec2 v_c;
void main() {
  v_c = a_c;
  vec4 p = u_vp * vec4(u_node, 1.0);
  p.xy += a_c * u_size * p.w;
  gl_Position = p;
}`;

const GLOW_FS = `#version 300 es
precision highp float;
in vec2 v_c;
uniform float u_alpha;
out vec4 o;
${COLOURS}
void main() {
  float g = exp(-dot(v_c, v_c) * 4.5) * u_alpha;
  o = vec4(CORAL * g, 0.0);
}`;

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type);
    if (!s) throw new Error('shader');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

function buffer(
  gl: WebGL2RenderingContext,
  p: WebGLProgram,
  name: string,
  data: number[],
  size: number,
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, name);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

export interface Mark3d {
  /** [PCODE-452 | S15 | v0.1.0] begin the arrival (once), when the mark is fully in view */
  play(): void;
  /** keep animating while it is on screen */
  setRunning(on: boolean): void;
  /** moving pictures on or off (the page's pause button, reduced motion) */
  setMotion(on: boolean): void;
  setPointer(x: number, y: number): void;
}

export function createMark3d(canvas: HTMLCanvasElement, motion: boolean): Mark3d | null {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
  });
  if (!gl) return null;
  let ringP: WebGLProgram;
  let nodeP: WebGLProgram;
  let glowP: WebGLProgram;
  try {
    ringP = program(gl, RING_VS, RING_FS);
    nodeP = program(gl, NODE_VS, NODE_FS);
    glowP = program(gl, GLOW_VS, GLOW_FS);
  } catch {
    return null;
  }

  // the ring: a (u, v) grid; the node: a sphere of normals; the glow: one quad
  const SU = 180;
  const SV = 28;
  const uv: number[] = [];
  for (let i = 0; i < SU; i++)
    for (let j = 0; j < SV; j++) {
      const u0 = i / SU;
      const u1 = (i + 1) / SU;
      const v0 = j / SV;
      const v1 = (j + 1) / SV;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
  const ringVao = gl.createVertexArray();
  gl.bindVertexArray(ringVao);
  buffer(gl, ringP, 'a_uv', uv, 2);
  const ringCount = uv.length / 2;

  const sphere: number[] = [];
  const LAT = 24;
  const LON = 36;
  const pt = (la: number, lo: number): number[] => {
    const t = (la / LAT) * Math.PI;
    const f = (lo / LON) * Math.PI * 2;
    return [Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f)];
  };
  for (let i = 0; i < LAT; i++)
    for (let j = 0; j < LON; j++)
      sphere.push(
        ...pt(i, j),
        ...pt(i + 1, j),
        ...pt(i + 1, j + 1),
        ...pt(i, j),
        ...pt(i + 1, j + 1),
        ...pt(i, j + 1),
      );
  const nodeVao = gl.createVertexArray();
  gl.bindVertexArray(nodeVao);
  buffer(gl, nodeP, 'a_n', sphere, 3);
  const nodeCount = sphere.length / 3;

  const glowVao = gl.createVertexArray();
  gl.bindVertexArray(glowVao);
  buffer(gl, glowP, 'a_c', [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1], 2);
  gl.bindVertexArray(null);

  const u = (p: WebGLProgram, n: string): WebGLUniformLocation | null =>
    gl.getUniformLocation(p, n);
  // [PCODE-452 | S15 | v0.1.0] the camera stands back far enough that the ring never touches the
  // frame, even while its near side turns towards the camera
  const EYE: [number, number, number] = [0, 0, 6.2];
  const NODE_R = 0.2;
  const END = 99;

  let running = false;
  let moving = motion;
  let raf = 0;
  let last = 0;
  /** seconds since the arrival began; -1 before it */
  let clock = -1;
  /** where the node is on the ring; its speed eases in, so it never jumps */
  let nodeAngle = Math.PI / 4;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };

  const draw = (t: number): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // [PCODE-452 | S15 | v0.1.0] the arrival, as one choreography (seconds since it began):
    // 0–0.9 fade up from darkness, far and edge-on; 0.15–3.35 one long ease-in-out turn to face the
    // visitor, a roll unwinding and a dolly forward; 2.3–3 the node pops onto the ring with a flash;
    // 2.6–3.8 one glint across the surface; from 3.2 the orbit and a slow breath ease in
    const fade = smooth(t / 0.9);
    const turn = inOut((t - 0.15) / 3.2);
    const dolly = outQuart(t / 3.4);
    const breath = smooth((t - 3.4) / 2);
    const yaw =
      mix(1.38, -0.2, turn) + breath * 0.07 * Math.sin((t - 3.4) * 0.4) + pointer.sx * 0.18;
    const pitch =
      mix(0.62, 0.15, turn) + breath * 0.04 * Math.sin((t - 3.4) * 0.31) - pointer.sy * 0.12;
    const roll = mix(0.55, 0, turn);
    const model = mul(rotZ(roll), mul(rotY(yaw), mul(rotX(pitch), scaleM(mix(0.62, 1, dolly)))));
    const vp = mul(perspective(0.6, w / h, 0.1, 30), view(EYE[2]));
    // the node rides the ring from where it sits in the drawn mark (45°)
    const pop = outBack((t - 2.3) / 0.7);
    const nodeR = NODE_R * Math.max(0, pop);
    const flash = Math.exp(-Math.pow(t - 2.6, 2) / 0.05);
    const node = apply(model, [Math.cos(nodeAngle), Math.sin(nodeAngle), 0]);
    // one glint after the node arrives, then again every seven seconds
    const phase = t < 2.6 ? -1 : ((t - 2.6) % 7) / 1.2;
    const sweep = phase >= 0 && phase < 1 ? mix(-1.9, 1.9, inOut(phase)) : -4;

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(ringP);
    gl.uniformMatrix4fv(u(ringP, 'u_model'), false, model);
    gl.uniformMatrix4fv(u(ringP, 'u_vp'), false, vp);
    gl.uniform3fv(u(ringP, 'u_eye'), EYE);
    gl.uniform3fv(u(ringP, 'u_node'), node);
    gl.uniform1f(u(ringP, 'u_nodeR'), Math.min(NODE_R, Math.max(nodeR, 0.0001)));
    gl.uniform1f(u(ringP, 'u_sweep'), sweep);
    gl.uniform1f(u(ringP, 'u_fade'), fade);
    gl.bindVertexArray(ringVao);
    gl.drawArrays(gl.TRIANGLES, 0, ringCount);

    if (nodeR > 0.001) {
      gl.useProgram(nodeP);
      gl.uniform3fv(u(nodeP, 'u_node'), node);
      gl.uniform1f(u(nodeP, 'u_nodeR'), nodeR);
      gl.uniformMatrix4fv(u(nodeP, 'u_vp'), false, vp);
      gl.uniform3fv(u(nodeP, 'u_eye'), EYE);
      gl.uniform1f(u(nodeP, 'u_fade'), fade);
      gl.bindVertexArray(nodeVao);
      gl.drawArrays(gl.TRIANGLES, 0, nodeCount);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(glowP);
      gl.uniform3fv(u(glowP, 'u_node'), node);
      gl.uniform1f(u(glowP, 'u_size'), 0.2 + flash * 0.22);
      gl.uniform1f(u(glowP, 'u_alpha'), fade * (0.5 * Math.min(1, nodeR / NODE_R) + flash * 0.9));
      gl.uniformMatrix4fv(u(glowP, 'u_vp'), false, vp);
      gl.bindVertexArray(glowVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  };

  const frame = (now: number): void => {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (moving && clock >= 0 && clock < END) {
      clock += dt;
      // the orbit's speed eases in from standstill
      nodeAngle += 0.5 * smooth((clock - 3.2) / 1.8) * dt;
    }
    const k = 1 - Math.pow(0.004, dt);
    pointer.sx += (pointer.x - pointer.sx) * k;
    pointer.sy += (pointer.y - pointer.sy) * k;
    if (clock >= 0) draw(clock);
    if (running && moving && clock >= 0) raf = requestAnimationFrame(frame);
    else last = 0;
  };
  const kick = (): void => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  return {
    play() {
      if (clock >= 0) return;
      clock = moving ? 0 : END;
      kick();
    },
    setRunning(on) {
      running = on;
      if (on) kick();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      }
    },
    setMotion(on) {
      moving = on;
      // paused before or during the arrival: the finished frame
      if (!on && clock >= 0) clock = END;
      kick();
    },
    setPointer(x, y) {
      pointer.x = Math.min(1, Math.max(-1, x));
      pointer.y = Math.min(1, Math.max(-1, y));
      if (running) kick();
    },
  };
}
