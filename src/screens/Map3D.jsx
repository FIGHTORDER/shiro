import React from "react";

import { aspectFromImage, buildMesh } from "./mapmesh.ts";
import { FRAG, VERT } from "./mapshaders.ts";
import { profileOf } from "./mapwater.ts";

/* An orbit view of a Zero-K map, built from the two pictures the site already
   publishes: the heightmap for shape and the minimap for colour.

   The heightmap is 8-bit and JPEG compressed, so this is good enough to see
   whether a pass is really a pass and not good enough to judge a small step.
   It also carries no vertical scale, because Zero-K publishes no elmo range,
   so the height control is the honest answer rather than a guess presented as
   a fact. */

const GRID_MAX = 192;

// ------------------------------------------------------------------- math ---

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const d = near - far;
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / d, -1, 0, 0, (2 * far * near) / d, 0];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function lookAt(eye, at, up) {
  const z = norm(sub(eye, at));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ];
}

function mul(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  }
  return o;
}

// ------------------------------------------------------------------ build ---

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode the image"));
    img.src = src;
  });
}

/* Read the heightmap back as numbers. A data URL counts as same-origin, so the
   canvas is not tainted and getImageData is allowed. Fetching these straight
   from zero-k.info would taint it, which is why the bytes come through Rust. */
function heightsFrom(img, cols, rows) {
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cols, rows);
  const px = ctx.getImageData(0, 0, cols, rows).data;
  const h = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) h[i] = px[i * 4] / 255;
  return h;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || "shader failed to compile");
  }
  return s;
}

// -------------------------------------------------------------- component ---

/* Zero-K has one true height for a map - terrain is not something a player
   scales - so there is nothing here for a viewer to choose. This is the
   flattest setting the old HEIGHT slider could reach, which issue #15 found
   renders the majority of maps the way they actually play. */
const LIFT = 0.05;

export default function Map3D({
  heightmap, minimap, aspect, water = 0, showWater = false,
  onProfile,
}) {
  const canvasRef = React.useRef(null);
  const camRef = React.useRef({ yaw: -0.6, pitch: 0.85, dist: 2.2 });
  const liveRef = React.useRef({ water, showWater });
  const [error, setError] = React.useState(null);
  const [ready, setReady] = React.useState(false);
  /* A driver reset, a laptop switching GPUs, or the browser reclaiming a
     context takes every buffer, texture and program with it. Bumping this
     re-runs the build effect, which is the only way back. */
  const [lost, setLost] = React.useState(false);
  const [rebuild, setRebuild] = React.useState(0);

  liveRef.current = { water, showWater };

  React.useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let cleanup = () => {};
    setError(null);
    setReady(false);

    /* Registered before anything is built, so a loss during the build is
       caught too. Without preventDefault the browser will not even try to
       restore the context. */
    const canvasNow = canvasRef.current;
    const onLost = e => {
      e.preventDefault();
      cancelAnimationFrame(frame);
      frame = 0;
      setReady(false);
      setLost(true);
    };
    const onRestored = () => {
      setLost(false);
      setRebuild(n => n + 1);
    };
    canvasNow?.addEventListener("webglcontextlost", onLost);
    canvasNow?.addEventListener("webglcontextrestored", onRestored);

    (async () => {
      const canvas = canvasRef.current;
      if (!canvas || !heightmap || !minimap) return;

      let hImg, cImg;
      try {
        [hImg, cImg] = await Promise.all([loadImage(heightmap), loadImage(minimap)]);
      } catch {
        if (!cancelled) setError("The map images could not be decoded.");
        return;
      }
      if (cancelled) return;

      const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
      if (!gl) {
        setError("This computer has no WebGL, so the 3D view cannot draw.");
        return;
      }
      // Nothing built on a dead context survives; wait for the restore instead.
      if (gl.isContextLost()) return;

      const cols = Math.max(2, Math.min(GRID_MAX, hImg.naturalWidth));
      const rows = Math.max(2, Math.min(GRID_MAX, hImg.naturalHeight));
      /* The catalogue is the better source, but a map found by live search has
         no dimensions. The published picture carries the squared ratio, so its
         square root is the real footprint. */
      const shape = aspect ?? aspectFromImage(hImg.naturalWidth, hImg.naturalHeight);
      const heights = heightsFrom(hImg, cols, rows);
      /* Reported once per heightmap, not per frame: the caller uses it to say
         what the waterline actually floods. */
      if (onProfile) onProfile(profileOf(heights));
      const mesh = buildMesh(heights, cols, rows, shape);
      const wide = mesh.idx instanceof Uint32Array;
      if (wide && !gl.getExtension("OES_element_index_uint")) {
        setError("This graphics driver cannot draw a mesh this size.");
        return;
      }

      let prog;
      try {
        prog = gl.createProgram();
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(prog) || "program failed to link");
        }
      } catch {
        setError("The 3D view could not start on this graphics driver.");
        return;
      }
      gl.useProgram(prog);

      const attach = (data, size, name) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        return b;
      };
      attach(mesh.pos, 3, "a_pos");
      attach(mesh.nrm, 3, "a_normal");
      attach(mesh.uv, 2, "a_uv");

      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, cImg);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const uMvp = gl.getUniformLocation(prog, "u_mvp");
      const uLift = gl.getUniformLocation(prog, "u_lift");
      const uWater = gl.getUniformLocation(prog, "u_water");
      const uShowWater = gl.getUniformLocation(prog, "u_showWater");
      gl.uniform1i(gl.getUniformLocation(prog, "u_colour"), 0);
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0.055, 0.063, 0.078, 1);

      setReady(true);

      const draw = () => {
        /* Belt and braces for the event handler: every GL call on a lost
           context is a silent no-op, so a loop that kept rescheduling would
           burn a frame callback every 16ms against a frozen picture. */
        if (gl.isContextLost()) return;
        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const { yaw, pitch, dist } = camRef.current;
        const eye = [
          Math.cos(pitch) * Math.sin(yaw) * dist,
          Math.sin(pitch) * dist,
          Math.cos(pitch) * Math.cos(yaw) * dist,
        ];
        gl.uniformMatrix4fv(uMvp, false,
          mul(perspective(Math.PI / 4, w / h, 0.01, 100), lookAt(eye, [0, 0, 0], [0, 1, 0])));
        gl.uniform1f(uLift, LIFT);
        gl.uniform1f(uWater, liveRef.current.water);
        gl.uniform1f(uShowWater, liveRef.current.showWater ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawElements(gl.TRIANGLES, mesh.idx.length,
          wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);

      cleanup = () => {
        cancelAnimationFrame(frame);
        gl.deleteTexture(tex);
        gl.deleteBuffer(ib);
        gl.deleteProgram(prog);
      };
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      canvasNow?.removeEventListener("webglcontextlost", onLost);
      canvasNow?.removeEventListener("webglcontextrestored", onRestored);
      cleanup();
    };
  }, [heightmap, minimap, aspect, rebuild]);

  const drag = React.useRef(null);

  const onDown = e => {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = e => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    const c = camRef.current;
    c.yaw -= dx * 0.008;
    c.pitch = Math.max(0.08, Math.min(1.5, c.pitch + dy * 0.006));
  };
  const onUp = e => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onWheel = e => {
    const c = camRef.current;
    c.dist = Math.max(0.7, Math.min(5, c.dist + Math.sign(e.deltaY) * 0.18));
  };

  if (error) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
        padding: "var(--sp-5)", textAlign: "center", background: "var(--surface-sunken)",
        font: "var(--text-ui-sm)", color: "var(--text-low)" }}>
        {error}
      </div>
    );
  }

  /* The canvas stays mounted while the context is gone: `webglcontextrestored`
     is delivered to that element, and unmounting it would mean never hearing
     the one event that brings the view back. */
  return (
    <>
      <canvas ref={canvasRef}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onPointerCancel={onUp} onWheel={onWheel}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
          display: "block", cursor: "grab", touchAction: "none",
          opacity: ready && !lost ? 1 : 0, transition: "opacity 160ms ease" }} />
      {lost && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
          padding: "var(--sp-5)", textAlign: "center", background: "var(--surface-sunken)",
          font: "var(--text-ui-sm)", color: "var(--text-low)" }}>
          The graphics driver dropped the 3D view. Waiting for it to come back.
        </div>
      )}
    </>
  );
}
