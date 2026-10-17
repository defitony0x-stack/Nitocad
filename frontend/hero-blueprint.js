/* NitoCAD hero: a blueprint that draws itself stroke by stroke, then lifts into a solid.
   Two swappable scenes (airplane, house). Uses the same three.js build the page already
   loads through its import map, so it adds no new network dependency.
   Pauses when off-screen or in a background tab, and respects prefers-reduced-motion. */
import * as THREE from "three";

const stage = document.getElementById("bpStage");
const host = stage && stage.querySelector(".bp-canvas");
if (stage && host) boot();

function boot() {
  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (err) {
    stage.classList.add("bp-off");
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; renderer.localClippingEnabled = true;
  host.appendChild(renderer.domElement);
  stage.classList.add("bp-live");

  const COL = { line: 0xbfd3f2, lineSolid: 0x3a4658, dim: 0xff8f5e, grid: 0xc9a24b };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1.25, 0.1, 400);
  const envTex = (() => { const c = document.createElement("canvas"); c.width = 256; c.height = 128; const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, "#7fa8e6"); gr.addColorStop(0.46, "#e9eef5"); gr.addColorStop(0.5, "#8a8f98"); gr.addColorStop(1, "#2b313b"); g.fillStyle = gr; g.fillRect(0, 0, 256, 128); g.fillStyle = "#fff"; g.fillRect(150, 14, 56, 26); const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t; })();
  scene.environment = envTex; scene.environmentIntensity = 0.7;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1b3358, 0.55));
  const rim = new THREE.DirectionalLight(0x9fc3ff, 0.6); rim.position.set(-8, 4, -6); scene.add(rim);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(6, 10, 8);
  scene.add(sun);

  /* ---------- geometry helpers ---------- */
  const xf = (arr, m) => {
    const out = new Float32Array(arr.length), v = new THREE.Vector3();
    for (let i = 0; i < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(m);
      out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z;
    }
    return out;
  };
  const cat = (...as) => {
    const out = new Float32Array(as.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of as) { out.set(a, o); o += a.length; }
    return out;
  };
  const edgeSeg = (geo, m, ang) => {
    const e = new THREE.EdgesGeometry(geo, ang);
    const a = e.attributes.position.array.slice();
    e.dispose();
    return xf(a, m);
  };
  const polyShape = (pts) => {
    const s = new THREE.Shape();
    pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
    s.closePath();
    return s;
  };
  const rectPts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const rectPath = (x0, y0, x1, y1) => polyShape(rectPts(x0, y0, x1, y1));
  const extrude = (shape, depth) =>
    new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });

  const mat = (color, max = 1, o = {}) => {
    const key = o._share ? [color, max, o.r, o.m, o.em, o.flat].join("|") : null;
    if (key && MATC.has(key)) return MATC.get(key);
    const gl = GLOSSY.has(color);
    const m = new THREE.MeshStandardMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0,
      roughness: gl ? 0.08 : (o.r == null ? 0.72 : o.r), metalness: gl ? 0.4 : (o.m || 0),
      vertexColors: !!(o.paint || o.vc), map: o.map || null, flatShading: !!o.flat, emissive: o.em || 0x000000,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    m.envMapIntensity = gl ? 1.6 : 1;
    m.userData.max = max;
    if (key) MATC.set(key, m);
    return m;
  };

  function mk(name, geo, color, o = {}) {
    if (o.paint) paintGeo(geo, o.paint);
    const T = o.tex === undefined ? TEXBY.get(color) : o.tex;
    const mesh = new THREE.Mesh(geo, mat(color, o.max == null ? 1 : o.max, Object.assign({}, o, { _share: !(T || o.paint || o.vc || o.map || o.anim) })));
    if (o.anim) mesh.userData.anim = o.anim;
    if (T) {
      const pr = geo.parameters, bx = pr && pr.width != null, m = mesh.material;
      m.map = rep(T.t, bx ? Math.max(pr.width, pr.depth || 0) / T.w : 1 / T.w, bx ? Math.max(pr.height, pr.depth || 0) / T.h : 1 / T.h);
      if (T.bump) { m.bumpMap = m.map; m.bumpScale = 1.5; }
    }
    if (o.dress) mesh.userData.dress = true;
    if (o.pos) mesh.position.set(o.pos[0], o.pos[1], o.pos[2]);
    if (o.rot) mesh.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
    if (o.scl) mesh.scale.set(o.scl[0], o.scl[1], o.scl[2]);
    mesh.updateMatrix();
    let seg = o.seg ? o.seg(mesh.matrix) : o.dress ? new Float32Array(0) : edgeSeg(geo, mesh.matrix, o.angle == null ? 28 : o.angle);
    if (o.extra) seg = cat(seg, o.extra);
    return { name, mesh, seg, dress: !!o.dress };
  }

  // Station rings plus longitudinal lines, the way a lofted fuselage is drawn.
  function latheLines(ctrl, sm, nLong) {
    const out = [], N = 28, TAU = Math.PI * 2;
    const push = (ax, ay, az, bx, by, bz) => out.push(ax, ay, az, bx, by, bz);
    for (const c of ctrl) {
      if (c[0] < 0.03) continue;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU;
        push(c[0] * Math.cos(a0), c[1], c[0] * Math.sin(a0), c[0] * Math.cos(a1), c[1], c[0] * Math.sin(a1));
      }
    }
    for (let j = 0; j < nLong; j++) {
      const a = (j / nLong) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i < sm.length - 1; i++) {
        push(sm[i].x * ca, sm[i].y, sm[i].x * sa, sm[i + 1].x * ca, sm[i + 1].y, sm[i + 1].x * sa);
      }
    }
    return new Float32Array(out);
  }
  function lathePart(name, ctrl, color, o = {}) {
    const sm = new THREE.SplineCurve(ctrl.map((c) => new THREE.Vector2(c[0], c[1])))
      .getPoints(o.res || 36).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
    const geo = new THREE.LatheGeometry(sm, o.segs || 32);
    return mk(name, geo, color, Object.assign({}, o, { seg: (m) => xf(latheLines(ctrl, sm, o.long || 10), m) }));
  }

  // Engineering-style dimension line with end ticks.
  function dim(a, b, t, tick) {
    tick = tick || 0.32;
    const p = (v, s) => [v[0] + t[0] * tick * s, v[1] + t[1] * tick * s, v[2] + t[2] * tick * s];
    return new Float32Array([].concat(a, b, p(a, -1), p(a, 1), p(b, -1), p(b, 1)));
  }

  /* ---------- shared helpers for the detailed scenes ---------- */
  const lerpAt = (pts, k) => {
    // pts: [[t, v], ...] sorted by t. Piecewise-linear lookup.
    if (k <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (k <= pts[i][0]) {
        const a = pts[i - 1], b = pts[i];
        return a[1] + (b[1] - a[1]) * ((k - a[0]) / (b[0] - a[0] || 1));
      }
    }
    return pts[pts.length - 1][1];
  };

  // Many small quads (windows) merged into one mesh. rects: [cx, cy, cz, w, h, nx] with the
  // quad lying in a plane of constant z (nx = 0) or constant x (nx = 1), facing sign s.
  function quadBatch(rects) {
    const pos = [], idx = [], out = [];
    rects.forEach((r, i) => {
      const [cx, cy, cz, w, h, axis] = r;
      let a, b, c, d;
      if (axis === 0) {
        a = [cx - w / 2, cy - h / 2, cz]; b = [cx + w / 2, cy - h / 2, cz];
        c = [cx + w / 2, cy + h / 2, cz]; d = [cx - w / 2, cy + h / 2, cz];
      } else {
        a = [cx, cy - h / 2, cz - w / 2]; b = [cx, cy - h / 2, cz + w / 2];
        c = [cx, cy + h / 2, cz + w / 2]; d = [cx, cy + h / 2, cz - w / 2];
      }
      pos.push(...a, ...b, ...c, ...d);
      const o = i * 4;
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      out.push(...a, ...b, ...b, ...c, ...c, ...d, ...d, ...a);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return { geo: g, seg: new Float32Array(out) };
  }

  // A wing-like slab from a planform polygon [x, z] (z = span). Thickness hangs below the plane.
  function planform(pts, thick) {
    return extrude(polyShape(pts), thick);
  }

  /* ---------- realism helpers: textures, painted vertices, lofted airfoils, merged boxes ---------- */
  const TEXBY = new Map(), GLOSSY = new Set(), MATC = new Map();
  const rnd = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const mkTex = (w, h, draw) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  const rep = (t, u, v) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(u, v); return c; };
  const BLOB = mkTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, "rgba(0,0,0,.9)"); r.addColorStop(0.55, "rgba(0,0,0,.55)"); r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  BLOB.wrapS = BLOB.wrapT = THREE.ClampToEdgeWrapping;
  const paintGeo = (geo, fn) => {
    const p = geo.attributes.position, c = new Float32Array(p.count * 3), k = new THREE.Color();
    for (let i = 0; i < p.count; i++) { k.set(fn(p.getX(i), p.getY(i), p.getZ(i))); c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
    geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  };
  // Many boxes merged into one geometry. list: [cx, cy, cz, w, h, d]
  function boxes(list) {
    const pos = [], nor = [], uv = [], idx = [];
    list.forEach(([cx, cy, cz, w, h, d]) => {
      const g = new THREE.BoxGeometry(w, h, d), o = pos.length / 3, p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) pos.push(p[i] + cx, p[i + 1] + cy, p[i + 2] + cz);
      nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
      g.index.array.forEach((i) => idx.push(i + o));
      g.dispose();
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  // Oval windows lying in planes of constant z. list: [cx, cy, cz, w, h]
  function ovals(list) {
    const pos = [], idx = [], out = [], N = 12;
    list.forEach(([cx, cy, cz, w, h]) => {
      const b = pos.length / 3;
      pos.push(cx, cy, cz);
      for (let k = 0; k < N; k++) {
        const a = (k / N) * 6.2832;
        pos.push(cx + Math.cos(a) * w / 2, cy + Math.sin(a) * h / 2, cz);
        idx.push(b, b + 1 + k, b + 1 + ((k + 1) % N));
      }
      for (let k = 0; k < N; k++) {
        const A = (b + 1 + k) * 3, B = (b + 1 + ((k + 1) % N)) * 3;
        out.push(pos[A], pos[A + 1], pos[A + 2], pos[B], pos[B + 1], pos[B + 2]);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return { geo: g, seg: new Float32Array(out) };
  }
  // Lofted airfoil surface. secs: [{ le, te, t, up }] with t = max thickness in metres.
  const ytf = (s) => 0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1036 * s ** 4;
  function loft(secs, col, lines, n = 14) {
    const pos = [], rgb = [], idx = [], out = [], M = 2 * n, k = new THREE.Color(), seq = [];
    for (let i = 0; i <= n; i++) seq.push([i, 1]);
    for (let i = n - 1; i > 0; i--) seq.push([i, -1]);
    secs.forEach((sc) => {
      const c = [sc.te[0] - sc.le[0], sc.te[1] - sc.le[1], sc.te[2] - sc.le[2]];
      seq.forEach(([i, sg]) => {
        const s = (1 - Math.cos(Math.PI * i / n)) / 2, h = 5.05 * sc.t * ytf(s) * sg;
        const p = [sc.le[0] + c[0] * s + sc.up[0] * h, sc.le[1] + c[1] * s + sc.up[1] * h, sc.le[2] + c[2] * s + sc.up[2] * h];
        pos.push(p[0], p[1], p[2]);
        k.set(col(p[0], p[1], p[2], sg)); rgb.push(k.r, k.g, k.b);
      });
    });
    for (let a = 0; a < secs.length - 1; a++) for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M, p = a * M + j, q = a * M + j2, r = (a + 1) * M + j, s2 = (a + 1) * M + j2;
      idx.push(p, q, r, q, s2, r);
    }
    const L = (secs.length - 1) * M;
    for (let j = 1; j < M - 1; j++) idx.push(L, L + j, L + j + 1);
    const ln = (A, B) => out.push(pos[A * 3], pos[A * 3 + 1], pos[A * 3 + 2], pos[B * 3], pos[B * 3 + 1], pos[B * 3 + 2]);
    secs.forEach((_, a) => { for (let j = 0; j < M; j++) ln(a * M + j, a * M + ((j + 1) % M)); });
    lines.forEach((i) => { for (let a = 0; a < secs.length - 1; a++) ln(a * M + i, (a + 1) * M + i); });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(rgb, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return { geo: g, seg: new Float32Array(out) };
  }

  function fanGeo() {
    const pos = [], idx = [];
    for (let k = 0; k < 18; k++) {
      const a = k * 6.2832 / 18, b = pos.length / 3;
      [[0.25, a - 0.06], [0.25, a + 0.06], [1.38, a + 0.18], [1.38, a + 0.04]].forEach(([r, q]) => pos.push(0, r * Math.cos(q), r * Math.sin(q)));
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  /* ---------- scene: four-engine double-deck airliner (1 unit = 1 m) ---------- */
  function buildPlane(cut) {
    TEXBY.clear(); GLOSSY.clear();
    const P = [], WHITE = 0xf2f5f7, GLASS = 0x1e2c44, GEAR = 0x8b95a1, TIRE = 0x15181d, BLUE = 0x1d3f7a, ENGW = 0xe9edf0, SKIN = 0xe6ebef;
    GLOSSY.add(GLASS);
    const rotX = [0, 0, -Math.PI / 2];
    const FUSC = [[0.05, -36.6], [0.55, -35.2], [1.35, -31.5], [2.35, -26.5], [3.15, -20], [3.5, -12], [3.55, -3],
      [3.55, 12], [3.5, 21], [3.28, 26.5], [2.8, 30.5], [2.1, 33.6], [1.1, 35.6], [0.05, 36.6]];
    const UPC = [[0.08, -13], [1.4, -9], [2.2, -3], [2.6, 4], [2.6, 14], [2.3, 19], [1.5, 22.5], [0.6, 24.5], [0.05, 25.5]];
    const FR = (x) => lerpAt(FUSC.map((p) => [p[1], p[0]]), x), UR = (x) => lerpAt(UPC.map((p) => [p[1], p[0]]), x - 4);

    // Fuselage: painted belly, cheatline and cockpit glass, dense enough to hold the livery.
    P.push(lathePart("Fuselage", FUSC, 0xffffff, {
      rot: rotX, scl: [1.18, 1, 1], long: 16, segs: 96, res: 110, r: 0.35,
      paint: (x, y, z) => {
        const yw = -x * 1.18, r = Math.hypot(x, z);
        if (y > 31.4 && y < 34.4 && yw > 0.5 && Math.abs(z) < r * 0.8) return GLASS;
        if (yw < -2.3) return 0xa7b2be;
        if (yw < -0.1 && yw > -0.8 && y > -27 && y < 30) return BLUE;
        return WHITE;
      }
    }));
    P.push(lathePart("Upper deck", UPC, WHITE, { rot: rotX, pos: [4, 3.05, 0], scl: [0.78, 1, 1], long: 12, segs: 64, res: 60, r: 0.35 }));

    // Oval windows hugging the hull on both decks.
    const DX = [22.6, 10.0, -1.5, -10.5, -17.6], nearDoor = (x) => DX.some((d) => Math.abs(x - d) < 0.95);
    const lower = [], upper = [];
    for (let x = -15; x <= 20.5; x += 1.55) [-1, 1].forEach((s) => {
      const r = FR(x), cz = r * Math.sqrt(1 - Math.pow(0.55 / (1.18 * r), 2)) + 0.03;
      nearDoor(x) || (cut && s > 0 && x > -11 && x < 15) || lower.push([x, 0.55, s * cz, 0.6, 0.78]);
    });
    for (let x = -7; x <= 18.5; x += 1.5) [-1, 1].forEach((s) => (cut && s > 0 && x > -11 && x < 15) || upper.push([x, 3.1, s * (UR(x) + 0.03), 0.52, 0.68]));
    const win1 = (nm, w, i) => {
      const o1 = ovals([[w[0], w[1], w[2], w[3] + 0.16, w[4] + 0.16]]), o2 = ovals([[w[0], w[1], w[2] + (w[2] > 0 ? 0.015 : -0.015), w[3], w[4]]]);
      P.push(mk(nm + " frame " + i, o1.geo, 0xc9d1da, { seg: () => o1.seg, r: 0.5 }));
      P.push(mk(nm + " " + i, o2.geo, GLASS, { seg: () => o2.seg, max: 0.97, em: 0x6a5530 }));
    };
    lower.forEach((w, i) => win1("Window", w, i + 1));
    upper.forEach((w, i) => win1("Upper window", w, i + 1));

    // Swept, cranked wing lofted from airfoil sections, with real thickness and dihedral.
    const LE = [[2.6, 7], [14.5, -1], [40, -17.5]], TE = [[2.6, -8], [14.5, -13.5], [40, -21.5]];
    const WY = -2.2, DIH = 0.075;
    const leAt = (z) => lerpAt(LE, Math.abs(z)), teAt = (z) => lerpAt(TE, Math.abs(z)), wy = (z) => WY + Math.abs(z) * Math.sin(DIH);
    [1, -1].forEach((s) => {
      const side = s > 0 ? "starboard" : "port";
      const secs = [2.6, 8, 14.5, 22, 30, 36, 40].map((z) => ({
        le: [leAt(z), wy(z), s * z], te: [teAt(z), wy(z), s * z], t: (leAt(z) - teAt(z)) * (0.13 - 0.045 * z / 40), up: [0, 1, 0]
      }));
      const w = loft(secs, (x, y, z, sg) => {
        if (sg < 0) return 0xaeb8c3;
        const az = Math.abs(z), s = (leAt(az) - x) / (leAt(az) - teAt(az));
        return s > 0.72 && az > 8 && az < 37 ? 0xcdd5dd : s < 0.1 ? 0xd9dfe5 : SKIN;
      }, [0, 2, 5, 9, 12, 14]);
      P.push(mk("Wing, " + side, w.geo, 0xffffff, { vc: true, seg: () => w.seg, r: 0.5 }));
      P.push(mk("Wingtip fence, " + side, extrude(polyShape([[-17.4, 0], [-21.5, 0], [-21.9, 2.1], [-19.6, 2.1]]), 0.12), SKIN,
        { pos: [0, wy(40) + 0.1, s * 40 - 0.06], r: 0.5 }));
    });
    P.push(mk("Wing-body fairing", new THREE.SphereGeometry(1, 28, 14), 0xa7b2be, { pos: [-0.5, -3.7, 0], scl: [11, 1.4, 3.0], seg: () => new Float32Array(0), r: 0.5 }));
    [[1, 0x35ff7a], [-1, 0xff3b30]].forEach(([s, c]) => P.push(mk("Wingtip light", new THREE.SphereGeometry(0.2, 10, 8), c, { pos: [-19.8, wy(40) + 0.15, s * 40.1], em: c, angle: 70 })));

    // Hull details: doors, cargo doors, service panels, antennas, probes.
    const hz = (x, y) => { const r = FR(x), q = 1 - Math.pow(y / (1.18 * r), 2); return r * Math.sqrt(Math.max(0.05, q)); };
    const hull = (nm, x, y, s, w, h, col, o) => {
      if (cut && s > 0 && x > -11.5 && x < 15.5) return;
      P.push(mk(nm, new THREE.BoxGeometry(w, h, 0.1), col, Object.assign({ pos: [x, y, s * (hz(x, y) + 0.01)], r: 0.5, angle: 60 }, o || {})));
    };
    DX.forEach((x, i) => [-1, 1].forEach((s) => {
      const n = (s > 0 ? "S" : "P") + (i + 1);
      hull("Door " + n, x, 0.45, s, 1.1, 1.9, 0xdde3e9);
      hull("Door window " + n, x + 0.1, 1.0, s, 0.34, 0.46, GLASS, { max: 0.97 });
      hull("Door handle " + n, x - 0.35, 0.3, s, 0.16, 0.06, 0x8b95a1, { m: 0.6 });
    }));
    const CD = [[17, "Forward", 2.6], [-14, "Aft", 2.6], [-22.5, "Bulk", 1.2]];
    CD.forEach(([x, nm, w]) => [-1, 1].forEach((s) => hull(nm + " cargo door " + (s > 0 ? "S" : "P"), x, -2.5, s, w, 1.5, 0xb7c0ca)));
    for (let x = -29, k = 0; x < 31; x += 1.25, k++) [-1, 1].forEach((s) => {
      if (k % 3 === 0 || (x > -9 && x < 8) || CD.some((c) => Math.abs(x - c[0]) < 2)) return;
      hull("Hull panel " + k + (s > 0 ? "S" : "P"), x, k % 2 ? -3.0 : -1.8, s, 0.55, 0.36, 0xc2cad3);
    });
    [[-20, 3.75], [-12, 4.15], [-27, 2.75], [8, -4.15], [20, -4.15], [-5, -4.15]].forEach(([x, y], i) =>
      P.push(mk("Antenna blister " + (i + 1), new THREE.SphereGeometry(0.3, 10, 6), 0xdde3e9, { pos: [x, y, 0], scl: [1.6, 0.5, 1], seg: () => new Float32Array(0) })));
    [-1, 1].forEach((s) => P.push(mk("Pitot probe " + (s > 0 ? "S" : "P"), new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), 0x9aa3ad, { rot: [0, 0, Math.PI / 2], pos: [34.2, 0.9, s * 1.72], angle: 60 })));

    // Wing control surfaces as separate hinged skin panels that move.
    const wpatch = (s, z0, z1, f0, f1, pf) => {
      const NZ = 3, NC = 5, pos = [], idx = [];
      const pt = (z, f, sg) => { const c = leAt(z) - teAt(z), T = c * (0.13 - 0.045 * z / 40); return [leAt(z) - c * f, wy(z) + 5.05 * T * ytf(f) * sg + sg * 0.035, s * z]; };
      const pz = (z0 + z1) / 2, pc = leAt(pz) - teAt(pz), pv = [leAt(pz) - pc * pf, wy(pz), s * pz];
      for (let sg = 1; sg >= -1; sg -= 2) {
        const b = pos.length / 3;
        for (let i = 0; i <= NZ; i++) for (let j = 0; j <= NC; j++) { const p = pt(z0 + (z1 - z0) * i / NZ, f0 + (f1 - f0) * j / NC, sg); pos.push(p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]); }
        for (let i = 0; i < NZ; i++) for (let j = 0; j < NC; j++) { const a = b + i * (NC + 1) + j; idx.push(a, a + 1, a + NC + 1, a + 1, a + NC + 2, a + NC + 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return { geo: g, pv };
    };
    const dep = (t) => { const u = (t % 14) / 14, k = u < 0.25 ? 0 : u < 0.4 ? (u - 0.25) / 0.15 : u < 0.7 ? 1 : u < 0.85 ? 1 - (u - 0.7) / 0.15 : 0; return k * k * (3 - 2 * k); };
    const CS = [];
    [[3.5, 10], [10, 16.5], [16.5, 23], [23, 30], [30, 38]].forEach((r, i) => CS.push(["Slat " + (i + 1), r, 0, 0.1, 0.1, 0xe9eef2, (t) => -0.32 * dep(t)]));
    [[3.5, 9], [9, 14.2], [15, 21], [21, 27]].forEach((r, i) => CS.push(["Flap " + (i + 1), r, 0.74, 1, 0.74, 0xd9e0e6, (t) => 0.5 * dep(t)]));
    [[28, 33.5], [33.5, 39]].forEach((r, i) => CS.push(["Aileron " + (i + 1), r, 0.76, 1, 0.76, 0xd2d9e0, (t, s) => 0.28 * Math.sin(t * 0.9) * s]));
    [[5, 9.5], [9.5, 14], [15, 19.5], [19.5, 24], [24, 28.5], [28.5, 33]].forEach((r, i) => CS.push(["Spoiler " + (i + 1), r, 0.56, 0.74, 0.74, 0xcdd5dd, (t) => 0.6 * dep(t + 7)]));
    [1, -1].forEach((s) => CS.forEach(([nm, r, f0, f1, pf, col, fn]) => {
      const w = wpatch(s, r[0], r[1], f0, f1, pf);
      P.push(mk(nm + (s > 0 ? ", starboard" : ", port"), w.geo, col, { pos: w.pv, r: 0.5, seg: () => new Float32Array(0), anim: (t, m) => { m.rotation.z = fn(t, s); } }));
    }));

    // Pulsing lights: strobes and beacons.
    [[-21.9, wy(40) + 0.12, 40.3], [-21.9, wy(40) + 0.12, -40.3], [-36.2, 1.5, 0]].forEach((p, i) =>
      P.push(mk("Strobe " + (i + 1), new THREE.SphereGeometry(0.16, 8, 6), 0xffffff, { pos: p, em: 0xffffff, seg: () => new Float32Array(0), anim: (t, m) => { const u = (t * 1.1 + i * 0.13) % 1; m.material.emissiveIntensity = u < 0.07 || (u > 0.14 && u < 0.21) ? 3 : 0.05; } })));
    [[-30, 2.05], [-5, -4.22]].forEach((p, i) =>
      P.push(mk("Beacon " + (i + 1), new THREE.SphereGeometry(0.2, 8, 6), 0xff2a1a, { pos: [p[0], p[1], 0], em: 0xff2a1a, seg: () => new Float32Array(0), anim: (t, m) => { m.material.emissiveIntensity = 0.1 + 1.6 * Math.max(0, Math.sin(t * 5 + i)); } })));

    // Four high-bypass engines: nacelle, inlet lip, fan with blades, spinner, core plug, pylon.
    [[12.2, 1], [25.5, 2]].forEach(([z0, n]) => [-1, 1].forEach((s) => {
      const z = s * z0, ex = leAt(z0) - 0.4, ey = wy(z0) - 3.2;
      const tag = (s > 0 ? "starboard " : "port ") + (n === 1 ? "inner" : "outer");
      P.push(lathePart("Nacelle, " + tag, [[0.55, -3.9], [1.05, -3.2], [1.5, -1.6], [1.62, 0.2], [1.58, 2.2], [1.7, 3.5]],
        ENGW, { rot: rotX, pos: [ex, ey, z], long: 10, segs: 40, r: 0.45 }));
      P.push(lathePart("Core plug, " + tag, [[0.5, 0], [0.36, -0.6], [0.03, -1.6]], 0x3b414a, { rot: rotX, pos: [ex - 3.9, ey, z], long: 6, r: 0.6 }));
      P.push(mk("Inlet lip, " + tag, new THREE.TorusGeometry(1.62, 0.12, 8, 32), 0xbfc7d0, { rot: [0, Math.PI / 2, 0], pos: [ex + 3.5, ey, z], m: 0.6, r: 0.25, angle: 60 }));
      const sp = [];
      for (let k = 0; k < 16; k++) { const a = (k / 16) * 6.2832; sp.push(ex + 3.6, ey, z, ex + 3.6, ey + Math.cos(a) * 1.4, z + Math.sin(a) * 1.4); }
      P.push(mk("Fan face, " + tag, new THREE.CylinderGeometry(1.42, 1.42, 0.12, 28), 0x161c27,
        { rot: [0, 0, -Math.PI / 2], pos: [ex + 3.52, ey, z], max: 0.98, angle: 50, r: 0.4 }));
      P.push(lathePart("Spinner, " + tag, [[0.5, 0], [0.38, 0.4], [0.02, 0.85]], 0xcfd6de, { rot: rotX, pos: [ex + 3.5, ey, z], long: 6, max: 0.98, m: 0.7, r: 0.25 }));
      P.push(mk("Fan blades, " + tag, fanGeo(), 0x2a3340, { pos: [ex + 3.62, ey, z], max: 0.98, m: 0.6, r: 0.35, seg: () => new Float32Array(0), anim: (t, m) => { m.rotation.x = t * (s > 0 ? 16 : -16); } }));
      P.push(mk("Pylon, " + tag, extrude(polyShape([[-2.8, 0], [1.6, 0], [0.6, 2.2], [-2.4, 2.2]]), 0.4), ENGW,
        { pos: [ex, ey + 1.1, z - 0.2], scl: [1, 0.92, 1], r: 0.5 }));
    }));

    // Tail: lofted tailplanes and a lofted fin in the livery blue.
    const leS = (z) => -24.5 - 7.9 * (z - 1) / 14.4, teS = (z) => -34.2 - 1.4 * (z - 1) / 14.4;
    [1, -1].forEach((s) => {
      const secs = [1, 5, 9.5, 15.4].map((z) => ({ le: [leS(z), 1.4 + z * 0.1, s * z], te: [teS(z), 1.4 + z * 0.1, s * z], t: (leS(z) - teS(z)) * 0.09, up: [0, 1, 0] }));
      const h = loft(secs, (x, y, z, sg) => (sg > 0 ? SKIN : 0xaeb8c3), [0, 10, 14]);
      P.push(mk(s > 0 ? "Horizontal stabilizer, starboard" : "Horizontal stabilizer, port", h.geo, 0xffffff, { vc: true, seg: () => h.seg, r: 0.5 }));
    });
    const finX = (y) => (y <= 3.7 ? -15 : -15 - 13 * ((y - 3.7) / 12.2)), finT = (y) => -36.2 + 2.2 * ((y - 1.2) / 14.7);
    const fs = [2, 5, 8.5, 12, 15.9].map((y) => ({ le: [finX(y), y, 0], te: [finT(y), y, 0], t: (finX(y) - finT(y)) * 0.1, up: [0, 0, 1] }));
    const fin = loft(fs, () => BLUE, [0, 10, 14]);
    P.push(mk("Vertical fin", fin.geo, 0xffffff, { vc: true, seg: () => fin.seg, r: 0.4 }));

    // Landing gear: struts with pistons, bogie beams, tyres and hubs.
    const gearY = -8.3;
    const leg = (name, x, y0, z, rows, gap, R) => {
      const h = y0 - (gearY + R);
      P.push(mk(name + " strut", new THREE.CylinderGeometry(0.2, 0.26, h, 12), GEAR, { pos: [x, y0 - h / 2, z], angle: 60, m: 0.6, r: 0.35 }));
      P.push(mk(name + " piston", new THREE.CylinderGeometry(0.14, 0.14, h * 0.45, 10), 0xd5dbe2, { pos: [x, gearY + R + h * 0.25, z], angle: 60, m: 0.8, r: 0.2 }));
      if (rows > 1) P.push(mk(name + " bogie beam", new THREE.BoxGeometry(gap * (rows - 1) + 0.3, 0.26, 0.3), GEAR, { pos: [x, gearY + R, z], m: 0.5 }));
      P.push(mk(name + " drag brace", new THREE.BoxGeometry(0.1, h * 0.6, 0.1), GEAR, { pos: [x + 0.35, y0 - h * 0.35, z], rot: [0, 0, 0.5], m: 0.5 }));
      P.push(mk(name + " torque link", new THREE.BoxGeometry(0.08, h * 0.25, 0.08), 0xd5dbe2, { pos: [x - 0.18, gearY + R + h * 0.3, z + 0.2], rot: [0.4, 0, 0], m: 0.6 }));
      P.push(mk(name + " gear door", new THREE.BoxGeometry(0.06, h * 0.7, 0.9), 0xc9d1da, { pos: [x, y0 - h * 0.4, z + (z >= 0 ? 0.9 : -0.9)], r: 0.5 }));
      for (let r = 0; r < rows; r++) {
        const xx = x + (r - (rows - 1) / 2) * gap;
        [-1, 1].forEach((k) => {
          const at = [xx, gearY + R, z + k * 0.46];
          P.push(mk(name + " wheel", new THREE.CylinderGeometry(R, R, 0.42, 22), TIRE, { rot: [Math.PI / 2, 0, 0], pos: at, angle: 40, r: 0.9 }));
          P.push(mk(name + " brake", new THREE.CylinderGeometry(R * 0.38, R * 0.38, 0.5, 12), 0x4a4f57, { rot: [Math.PI / 2, 0, 0], pos: at, angle: 40, m: 0.5 }));
          P.push(mk(name + " hub", new THREE.CylinderGeometry(R * 0.5, R * 0.5, 0.46, 14), 0xc4ccd5, { rot: [Math.PI / 2, 0, 0], pos: at, angle: 40, m: 0.7, r: 0.3 }));
        });
      }
    };
    leg("Nose gear", 27, -3.4, 0, 1, 0, 0.62);
    [-1, 1].forEach((s) => leg("Body gear " + (s > 0 ? "starboard" : "port"), -7, -3.6, s * 2.4, 2, 1.7, 0.78));
    [-1, 1].forEach((s) => leg("Wing gear " + (s > 0 ? "starboard" : "port"), -2.5, -2.6, s * 8.6, 2, 1.7, 0.78));

    // Cutaway: slice away the starboard half of the cabin section and fit out both decks and the hold.
    if (cut) {
      const planes = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), -11), new THREE.Plane(new THREE.Vector3(1, 0, 0), -15), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
      ["Fuselage", "Upper deck"].forEach((nm) => {
        const p = P.find((q) => q.name === nm), m = p.mesh.material, a = p.seg, keep = [];
        m.clippingPlanes = planes; m.clipIntersection = true;
        for (let i = 0; i < a.length; i += 6) {
          const mx = (a[i] + a[i + 3]) / 2, mz = (a[i + 2] + a[i + 5]) / 2;
          if (!(mx > -11 && mx < 15 && mz > 0)) for (let k = 0; k < 6; k++) keep.push(a[i + k]);
        }
        p.seg = new Float32Array(keep);
      });
      P.push(mk("Cabin floor", boxes([[2, -0.6, 0, 26, 0.1, 6.9]]), 0x7d838c, { r: 0.9 }));
      P.push(mk("Aisle carpet", boxes([[2, -0.54, -1.4, 26, 0.02, 0.5], [2, -0.54, 1.4, 26, 0.02, 0.5]]), 0x8f2f3a, { r: 1 }));
      P.push(mk("Overhead bins", boxes([[2, 1.3, -3.0, 26, 0.45, 0.6], [2, 1.3, 3.0, 26, 0.45, 0.6]]), 0xdfe4e9, { r: 0.6 }));
      P.push(mk("Cabin bulkheads", boxes([[-11.3, 0.52, 0, 0.1, 2.15, 6.8], [15.0, 0.52, 0, 0.1, 2.15, 6.8]]), 0xcfd5db, { r: 0.7 }));
      P.push(mk("Upper deck floor", boxes([[2, 1.95, 0, 26, 0.1, 5.8]]), 0x7d838c, { r: 0.9 }));
      P.push(mk("Upper aisle carpet", boxes([[2, 2.01, -1.0, 26, 0.02, 0.4], [2, 2.01, 1.0, 26, 0.02, 0.4]]), 0x8f2f3a, { r: 1 }));
      P.push(mk("Upper deck bulkheads", boxes([[-11.3, 2.8, 0, 0.1, 1.6, 3.6], [15.0, 2.8, 0, 0.1, 1.6, 3.6]]), 0xcfd5db, {}));
      P.push(mk("Cargo floor", boxes([[2, -3.0, 0, 26, 0.1, 4.6]]), 0x6d737c, { r: 0.7 }));
      const zs = [-3.0, -2.45, -1.9, -0.85, -0.28, 0.28, 0.85, 1.9, 2.45, 3.0], uz = [-2.3, -1.8, -1.3, -0.7, -0.2, 0.2, 0.7, 1.3, 1.8, 2.3];
      for (let r = 0; r < 28; r++) {
        const x = -10.8 + r * 0.9, b = [], u = [];
        zs.forEach((z) => b.push([x, -0.1, z, 0.46, 0.1, 0.5], [x - 0.2, 0.28, z, 0.08, 0.72, 0.5], [x, -0.36, z, 0.1, 0.4, 0.1]));
        uz.forEach((z) => u.push([x, 2.45, z, 0.46, 0.1, 0.5], [x - 0.2, 2.83, z, 0.08, 0.72, 0.5], [x, 2.19, z, 0.1, 0.4, 0.1]));
        P.push(mk("Seat row " + (r + 1), boxes(b), 0x2b4f8c, { r: 0.8 }));
        P.push(mk("Upper seat row " + (r + 1), boxes(u), 0x7a2f3b, { r: 0.8 }));
      }
      for (let r = 0; r < 13; r++) P.push(mk("Cargo row " + (r + 1), boxes([[-10.4 + r * 2.0, -2.0, -1.15, 1.7, 1.7, 2.0], [-10.4 + r * 2.0, -2.0, 1.15, 1.7, 1.7, 2.0]]), 0xb7bfc9, { m: 0.5, r: 0.45 }));
    }

    // Apron: soft contact shadow and the yellow lead-in line. Not part of the envelope.
    P.push(mk("Apron shadow", new THREE.PlaneGeometry(90, 40), 0x000000, { rot: [-Math.PI / 2, 0, 0], pos: [-2, -8.29, 0], dress: true, map: BLOB, tex: null, max: 0.5, r: 1 }));
    P.push(mk("Taxi line", new THREE.PlaneGeometry(95, 0.4), 0xf2c230, { rot: [-Math.PI / 2, 0, 0], pos: [10, -8.28, 0], dress: true, r: 0.9, max: 0.9 }));

    return {
      parts: P,
      focus: cut ? new THREE.Box3(new THREE.Vector3(-18, -6, -8), new THREE.Vector3(22, 7, 8)) : null,
      gridStep: 4,
      dims: (box) => {
        const gy = box.min.y;
        return cat(
          dim([box.min.x, gy, box.max.z + 4], [box.max.x, gy, box.max.z + 4], [0, 0, 1], 1.4),
          dim([box.max.x + 4, gy, box.min.z], [box.max.x + 4, gy, box.max.z], [1, 0, 0], 1.4));
      },
      groundOffset: 0
    };
  }

  /* ---------- scene: two-storey house with garage, porch and dormer (1 unit = 1 m) ---------- */
  function buildHouse(cut) {
    const W = 12, D = 8, H = 5.6, R = 3.2, t = 0.28, P = [];
    TEXBY.clear(); GLOSSY.clear();
    const WALL = 0xe1d9c6, TRIM = 0xf7f5f0, ROOF = 0x4b4f57, ROOFD = 0x363a41, GLASS = 0x6c93bd, BRICK = 0xb0583d, SLAB = 0xbab7af, DOOR = 0x8a2f25,
      GDOOR = 0xe8e5de, CONC = 0xa9a7a1, GRASS = 0x4a7a3a, LEAF = 0x37653a, SHUT = 0x2f4a3a;
    GLOSSY.add(GLASS);
    const grey = (g, v) => { g.fillStyle = "rgb(" + v + "," + v + "," + v + ")"; };
    const tSid = mkTex(64, 128, (g, w) => { for (let i = 0; i < 8; i++) { const y = i * 16; grey(g, 232 + Math.floor(rnd() * 20)); g.fillRect(0, y, w, 16); g.fillStyle = "rgba(0,0,0,.28)"; g.fillRect(0, y + 13, w, 3); g.fillStyle = "rgba(255,255,255,.5)"; g.fillRect(0, y, w, 1); } });
    const tShi = mkTex(128, 128, (g, w, h) => { g.fillStyle = "#777"; g.fillRect(0, 0, w, h); for (let r = 0; r < 4; r++) for (let c = -1; c < 4; c++) { const x = c * 32 + (r % 2) * 16; grey(g, 190 + Math.floor(rnd() * 60)); g.fillRect(x + 1, r * 32 + 1, 30, 29); g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x, r * 32 + 29, 32, 3); } });
    const tBrk = mkTex(128, 64, (g, w, h) => { grey(g, 185); g.fillRect(0, 0, w, h); for (let r = 0; r < 4; r++) for (let c = -1; c < 4; c++) { grey(g, 205 + Math.floor(rnd() * 50)); g.fillRect(c * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14); } });
    const tCon = mkTex(128, 128, (g, w, h) => { grey(g, 240); g.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { grey(g, 205 + Math.floor(rnd() * 40)); g.fillRect(rnd() * w, rnd() * h, 2, 2); } g.strokeStyle = "rgba(0,0,0,.4)"; g.lineWidth = 3; g.strokeRect(0, 0, w, h); });
    const tGrs = mkTex(256, 256, (g, w, h) => { grey(g, 235); g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { grey(g, 170 + Math.floor(rnd() * 85)); g.fillRect(rnd() * w, rnd() * h, 2, 5); } });
    TEXBY.set(WALL, { t: tSid, w: 0.6, h: 1.2, bump: 1 });
    TEXBY.set(ROOF, { t: tShi, w: 1.0, h: 0.6, bump: 1 });
    TEXBY.set(BRICK, { t: tBrk, w: 0.86, h: 0.26, bump: 1 });
    TEXBY.set(SLAB, { t: tCon, w: 3, h: 3 });
    TEXBY.set(CONC, { t: tCon, w: 3, h: 3 });
    TEXBY.set(GRASS, { t: tGrs, w: 2.5, h: 2.5 });

    // Foundations, driveway, walk.
    P.push(mk("Foundation slab, main", new THREE.BoxGeometry(W + 0.7, 0.34, D + 0.7), SLAB, { pos: [0, -0.17, 0] }));
    P.push(mk("Foundation slab, garage", new THREE.BoxGeometry(6.9, 0.34, 8.6), SLAB, { pos: [9.45, -0.17, 0.8] }));
    P.push(mk("Driveway", new THREE.BoxGeometry(5.6, 0.08, 7.2), CONC, { pos: [9.3, -0.04, 8.8] }));
    P.push(mk("Front walk", new THREE.BoxGeometry(1.5, 0.08, 4.6), CONC, { pos: [-3, -0.04, 9.7] }));

    // Main walls. Holes are cut where windows and doors sit.
    const front = polyShape(rectPts(-W / 2, 0, W / 2, H));
    front.holes.push(
      rectPath(-3.5, 0, -2.5, 2.3),
      rectPath(-4.3, 0.2, -3.75, 2.2), rectPath(-2.25, 0.2, -1.7, 2.2),
      rectPath(0.4, 0.9, 3.2, 2.5), rectPath(3.9, 0.9, 5.5, 2.5),
      rectPath(-5.2, 4.0, -3.6, 5.2), rectPath(-2.2, 4.0, -0.6, 5.2),
      rectPath(0.9, 4.0, 2.5, 5.2), rectPath(3.9, 4.0, 5.5, 5.2));
    P.push(mk("Front wall", extrude(front, t), WALL, { pos: [0, 0, D / 2 - t] }));

    const back = polyShape(rectPts(-W / 2, 0, W / 2, H));
    back.holes.push(
      rectPath(-1.8, 0, 0.8, 2.3), rectPath(-5.0, 0.9, -3.4, 2.5), rectPath(3.4, 0.9, 5.2, 2.5),
      rectPath(-5.0, 4.0, -3.4, 5.2), rectPath(-1.0, 4.0, 0.6, 5.2), rectPath(3.4, 4.0, 5.0, 5.2));
    P.push(mk("Rear wall", extrude(back, t), WALL, { pos: [0, 0, -D / 2] }));

    const gableShape = (holes) => {
      const g = polyShape([[-D / 2, 0], [D / 2, 0], [D / 2, H], [0, H + R], [-D / 2, H]]);
      holes.forEach((h) => g.holes.push(h));
      return g;
    };
    // Gable shapes are mirrored by the Y rotation, so hole z coordinates are negated.
    P.push(mk("Gable wall, west", extrude(gableShape([
      rectPath(-1.0, 0.9, 1.0, 2.5), rectPath(-1.0, 4.0, 1.0, 5.2), rectPath(-0.45, 6.6, 0.45, 7.7)]), t), WALL,
      { rot: [0, Math.PI / 2, 0], pos: [-W / 2, 0, 0] }));
    P.push(mk("Gable wall, east", extrude(gableShape([rectPath(-0.45, 6.6, 0.45, 7.7)]), t), WALL,
      { rot: [0, Math.PI / 2, 0], pos: [W / 2 - t, 0, 0] }));

    // Trim: corner boards and the belly band between floors.
    [[-W / 2 - 0.05, D / 2 + 0.05], [W / 2 + 0.05, D / 2 + 0.05], [-W / 2 - 0.05, -D / 2 - 0.05]].forEach((c, i) =>
      P.push(mk("Corner board " + (i + 1), new THREE.BoxGeometry(0.22, H, 0.22), TRIM, { pos: [c[0], H / 2, c[1]] })));
    P.push(mk("Belly band", new THREE.BoxGeometry(W + 0.2, 0.16, 0.1), TRIM, { pos: [0, 3.15, D / 2 + 0.04] }));

    // Gable roof, ridge along X, with overhang, fascia, rake boards and ridge cap.
    function roof(prefix, cx, cz, len, hd, eaveH, rise, c1, c2) {
      const th = Math.atan2(rise, hd), slope = Math.hypot(rise, hd), L = slope + 0.6, rt = 0.2, sh = (L - slope) / 2;
      [1, -1].forEach((s) => {
        const pz = cz + s * (hd / 2) + s * Math.cos(th) * sh + s * Math.sin(th) * rt / 2;
        const py = eaveH + rise / 2 - Math.sin(th) * sh + Math.cos(th) * rt / 2;
        P.push(mk(prefix + (s > 0 ? "front slope" : "rear slope"), new THREE.BoxGeometry(len + 1.1, rt, L), c1,
          { pos: [cx, py, pz], rot: [s * th, 0, 0] }));
        P.push(mk(prefix + (s > 0 ? "front gutter" : "rear gutter"), new THREE.BoxGeometry(len + 1.1, 0.16, 0.16), TRIM,
          { pos: [cx, eaveH - Math.sin(th) * 0.6 - 0.02, cz + s * (hd + Math.cos(th) * 0.6)] }));
        [-1, 1].forEach((e) => P.push(mk(prefix + "rake board", new THREE.BoxGeometry(0.14, 0.3, L), TRIM,
          { pos: [cx + e * (len / 2 + 0.55), py + 0.02, pz], rot: [s * th, 0, 0] })));
      });
      P.push(mk(prefix + "ridge cap", new THREE.BoxGeometry(len + 1.1, 0.16, 0.42), c2, { pos: [cx, eaveH + rise + 0.12, cz] }));
    }
    roof("Roof, ", 0, 0, W, D / 2, H, R, ROOF, ROOFD);

    // Chimney with cap and flue.
    P.push(mk("Chimney stack", new THREE.BoxGeometry(1.0, 3.6, 1.0), BRICK, { pos: [3.6, 8.2, -1.3] }));
    P.push(mk("Chimney cap", new THREE.BoxGeometry(1.25, 0.16, 1.25), 0x6e3a22, { pos: [3.6, 10.08, -1.3] }));
    P.push(mk("Flue pot", new THREE.CylinderGeometry(0.2, 0.24, 0.45, 12), 0x6e3a22, { pos: [3.6, 10.38, -1.3], angle: 60 }));

    // Gable dormer on the front slope, above the entry.
    const dx = -3, dzf = 2.7, dzb = 0.35;
    P.push(mk("Dormer body", extrude(polyShape([[-0.95, 6.35], [0.95, 6.35], [0.95, 7.95], [0, 8.6], [-0.95, 7.95]]), dzf - dzb), WALL,
      { pos: [dx, 0, dzb] }));
    [1, -1].forEach((s) => P.push(mk("Dormer roof " + (s > 0 ? "east" : "west"), new THREE.BoxGeometry(1.25, 0.1, dzf - dzb + 0.35), ROOF,
      { pos: [dx + s * 0.55, 8.32, (dzf + dzb) / 2 + 0.17], rot: [0, 0, -s * 0.62] })));

    // Covered porch: deck, steps, columns, beam, shed roof.
    P.push(mk("Porch deck", new THREE.BoxGeometry(5.4, 0.3, 2.6), SLAB, { pos: [-3, 0.15, D / 2 + 1.3] }));
    [[7.1, 0.15], [6.8, 0.22]].forEach((st, i) => P.push(mk("Porch step " + (i + 1), new THREE.BoxGeometry(2.4, st[1], 0.5), SLAB,
      { pos: [-3, st[1] / 2, st[0]] })));
    [-5.35, -0.65].forEach((x, i) => {
      P.push(mk("Column base " + (i + 1), new THREE.BoxGeometry(0.55, 0.7, 0.55), BRICK, { pos: [x, 0.65, D / 2 + 2.2] }));
      P.push(mk("Porch column " + (i + 1), new THREE.BoxGeometry(0.28, 1.93, 0.28), TRIM, { pos: [x, 1.97, D / 2 + 2.2] }));
    });
    P.push(mk("Porch beam", new THREE.BoxGeometry(5.5, 0.3, 0.24), TRIM, { pos: [-3, 3.08, D / 2 + 2.2] }));
    P.push(mk("Porch roof", new THREE.BoxGeometry(6.0, 0.16, 2.9), ROOF, { pos: [-3, 3.45, D / 2 + 1.25], rot: [0.17, 0, 0] }));

    // Entry door, frame and glazing.
    const zF = D / 2;
    P.push(mk("Entry door frame", new THREE.BoxGeometry(1.2, 2.45, 0.08), TRIM, { pos: [-3, 1.22, zF + 0.01] }));
    P.push(mk("Entry door", new THREE.BoxGeometry(0.95, 2.28, 0.08), DOOR, {
      pos: [-3, 1.14, zF + 0.07],
      extra: new Float32Array([-3.3, 1.55, zF + 0.12, -2.7, 1.55, zF + 0.12, -3.3, 0.45, zF + 0.12, -2.7, 0.45, zF + 0.12,
        -3.3, 0.45, zF + 0.12, -3.3, 1.55, zF + 0.12, -2.7, 0.45, zF + 0.12, -2.7, 1.55, zF + 0.12])
    }));
    P.push(mk("Door handle", new THREE.CylinderGeometry(0.04, 0.04, 0.22, 8), 0xc9a24b, { pos: [-2.68, 1.1, zF + 0.16], angle: 60 }));

    // Window helper: frame behind, glass in front with mullions, projecting sill.
    const win = (name, x0, y0, x1, y1, z, face, cols, rows) => {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0, zz = z + face * 0.05, zg = z + face * 0.085;
      const mul = [];
      for (let i = 1; i < cols; i++) { const x = x0 + (w * i) / cols; mul.push(x, y0, zg + face * 0.04, x, y1, zg + face * 0.04); }
      for (let j = 1; j < rows; j++) { const y = y0 + (h * j) / rows; mul.push(x0, y, zg + face * 0.04, x1, y, zg + face * 0.04); }
      P.push(mk(name + " frame", new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.06), TRIM, { pos: [cx, cy, zz] }));
      P.push(mk(name + " glass", new THREE.BoxGeometry(w - 0.02, h - 0.02, 0.05), GLASS, { pos: [cx, cy, zg], max: 0.95, extra: new Float32Array(mul) }));
      if (y0 > 0.5) P.push(mk(name + " sill", new THREE.BoxGeometry(w + 0.34, 0.08, 0.2), TRIM, { pos: [cx, y0 - 0.14, z + face * 0.1] }));
    };
    win("Living window", 0.4, 0.9, 3.2, 2.5, zF, 1, 3, 2);
    win("Kitchen window", 3.9, 0.9, 5.5, 2.5, zF, 1, 2, 2);
    win("Bedroom 1 window", -5.2, 4.0, -3.6, 5.2, zF, 1, 2, 2);
    win("Bedroom 2 window", -2.2, 4.0, -0.6, 5.2, zF, 1, 2, 2);
    win("Bedroom 3 window", 0.9, 4.0, 2.5, 5.2, zF, 1, 2, 2);
    win("Bedroom 4 window", 3.9, 4.0, 5.5, 5.2, zF, 1, 2, 2);
    P.push(mk("Sidelight glass, west", new THREE.BoxGeometry(0.55, 2.0, 0.05), GLASS, { pos: [-4.02, 1.2, zF + 0.04], max: 0.95 }));
    P.push(mk("Sidelight glass, east", new THREE.BoxGeometry(0.55, 2.0, 0.05), GLASS, { pos: [-1.98, 1.2, zF + 0.04], max: 0.95 }));
    P.push(mk("Dormer window", new THREE.BoxGeometry(1.0, 0.9, 0.05), GLASS, { pos: [dx, 7.25, dzf + 0.04], max: 0.95,
      extra: new Float32Array([dx, 6.8, dzf + 0.08, dx, 7.7, dzf + 0.08, dx - 0.5, 7.25, dzf + 0.08, dx + 0.5, 7.25, dzf + 0.08]) }));

    const zB = -D / 2;
    win("Patio door", -1.8, 0.05, 0.8, 2.3, zB, -1, 4, 1);
    win("Rear window 1", -5.0, 0.9, -3.4, 2.5, zB, -1, 2, 2);
    win("Rear window 2", 3.4, 0.9, 5.2, 2.5, zB, -1, 2, 2);
    win("Rear window 3", -5.0, 4.0, -3.4, 5.2, zB, -1, 2, 2);
    win("Rear window 4", -1.0, 4.0, 0.6, 5.2, zB, -1, 2, 2);
    win("Rear window 5", 3.4, 4.0, 5.0, 5.2, zB, -1, 2, 2);

    // Side-wall glazing on the west gable, drawn in the x-plane.
    const side = (name, z0, z1, y0, y1, x, face) => {
      const cz = (z0 + z1) / 2, cy = (y0 + y1) / 2, xg = x + face * 0.05;
      P.push(mk(name, new THREE.BoxGeometry(0.05, y1 - y0, z1 - z0), GLASS, { pos: [xg, cy, cz], max: 0.95,
        extra: new Float32Array([xg + face * 0.03, y0, cz, xg + face * 0.03, y1, cz, xg + face * 0.03, cy, z0, xg + face * 0.03, cy, z1]) }));
    };
    side("West window, ground", -1.0, 1.0, 0.9, 2.5, -W / 2, -1);
    side("West window, upper", -1.0, 1.0, 4.0, 5.2, -W / 2, -1);
    side("West attic window", -0.45, 0.45, 6.6, 7.7, -W / 2, -1);

    // Attached garage: walls, roof, door.
    const gx0 = W / 2, gx1 = 12.6, gz0 = -3.2, gz1 = 4.8, GH = 3.3, GR = 1.9;
    const gf = polyShape(rectPts(gx0, 0, gx1, GH));
    gf.holes.push(rectPath(6.9, 0, 11.7, 2.4));
    P.push(mk("Garage front wall", extrude(gf, t), WALL, { pos: [0, 0, gz1 - t] }));
    P.push(mk("Garage rear wall", extrude(polyShape(rectPts(gx0, 0, gx1, GH)), t), WALL, { pos: [0, 0, gz0] }));
    const gEnd = polyShape([[-(4.0), 0], [4.0, 0], [4.0, GH], [0, GH + GR], [-4.0, GH]]);
    gEnd.holes.push(rectPath(-3.0, 1.1, -2.0, 2.0));
    P.push(mk("Garage gable wall", extrude(gEnd, t), WALL, { rot: [0, Math.PI / 2, 0], pos: [gx1 - t, 0, 0.8] }));
    roof("Garage roof, ", 9.3, 0.8, gx1 - gx0, 4.0, GH, GR, ROOF, ROOFD);

    const gdz = gz1 + 0.05, gdx = 9.3, pan = [];
    for (let k = 1; k < 4; k++) pan.push(6.9, (2.4 * k) / 4, gdz + 0.05, 11.7, (2.4 * k) / 4, gdz + 0.05);
    for (let k = 1; k < 4; k++) pan.push(6.9 + (4.8 * k) / 4, 0, gdz + 0.05, 6.9 + (4.8 * k) / 4, 2.4, gdz + 0.05);
    P.push(mk("Garage door", new THREE.BoxGeometry(4.8, 2.4, 0.1), GDOOR, { pos: [gdx, 1.2, gz1 - t / 2], extra: new Float32Array(pan) }));
    P.push(mk("Garage door header", new THREE.BoxGeometry(5.1, 0.18, 0.12), TRIM, { pos: [gdx, 2.5, gz1 + 0.02] }));
    side("Garage side window", 2.0, 3.0, 1.1, 2.0, gx1, 1);

    // Site dressing: lawn, soft contact shadow, hedges and trees. Left out of the envelope.
    P.push(mk("Lawn", new THREE.PlaneGeometry(25, 21), GRASS, { rot: [-Math.PI / 2, 0, 0], pos: [3.3, -0.07, 1.6], dress: true, r: 1 }));
    P.push(mk("Ground shadow", new THREE.PlaneGeometry(24, 16), 0x000000, { rot: [-Math.PI / 2, 0, 0], pos: [3.4, -0.06, 0.8], dress: true, map: BLOB, tex: null, max: 0.5, r: 1 }));
    [0.9, 2.0, 3.1, 4.2, 5.3].forEach((x, i) => P.push(mk("Hedge " + (i + 1), new THREE.SphereGeometry(0.55, 12, 9), LEAF,
      { pos: [x, 0.45, D / 2 + 0.75], scl: [1.1, 0.85, 0.9], dress: true, flat: true, r: 1 })));
    const tree = (i, x, z, h) => {
      P.push(mk("Tree trunk " + i, new THREE.CylinderGeometry(0.16, 0.26, h * 0.5, 8), 0x5b3f2c, { pos: [x, h * 0.25, z], dress: true, r: 1 }));
      [[0, 0.7, 0, 0.3], [0.22, 0.55, 0.1, 0.2], [-0.2, 0.58, -0.1, 0.22]].forEach((b, j) =>
        P.push(mk("Tree crown " + i + "." + j, new THREE.IcosahedronGeometry(h * b[3], 1), LEAF,
          { pos: [x + b[0] * h, b[1] * h, z + b[2] * h], dress: true, flat: true, r: 1, anim: (t, m) => { m.position.x = x + b[0] * h + Math.sin(t * 0.9 + x) * 0.08; } })));
    };
    tree(1, -8.2, 4.8, 7);
    tree(2, 15.4, -5.2, 8.5);

    // Brick water table, shutters, porch railing, lamps, downspouts and roof vents.
    P.push(mk("Brick water table", boxes([
      [-5.25, 0.25, D / 2 + 0.07, 1.7, 0.5, 0.14], [2.25, 0.25, D / 2 + 0.07, 7.7, 0.5, 0.14],
      [-4.0, 0.25, -D / 2 - 0.07, 4.2, 0.5, 0.14], [3.5, 0.25, -D / 2 - 0.07, 5.2, 0.5, 0.14],
      [-W / 2 - 0.07, 0.25, 0, 0.14, 0.5, D]]), BRICK, {}));
    const sh = [];
    [[-5.2, -3.6], [-2.2, -0.6], [0.9, 2.5], [3.9, 5.5]].forEach(([a, b]) => [a - 0.3, b + 0.3].forEach((x) => sh.push([x, 4.6, zF + 0.09, 0.3, 1.3, 0.07])));
    P.push(mk("Window shutters", boxes(sh), SHUT, {}));
    const rl = [];
    [[-5.35, -4.2], [-1.8, -0.65]].forEach(([a, b]) => {
      rl.push([(a + b) / 2, 1.05, 6.35, b - a, 0.08, 0.1], [(a + b) / 2, 0.4, 6.35, b - a, 0.06, 0.08]);
      for (let x = a + 0.1; x < b; x += 0.16) rl.push([x, 0.72, 6.35, 0.04, 0.62, 0.04]);
    });
    [-5.35, -0.65].forEach((x) => {
      rl.push([x, 1.05, 5.2, 0.1, 0.08, 2.3]);
      for (let z = 4.3; z < 6.2; z += 0.16) rl.push([x, 0.72, z, 0.04, 0.62, 0.04]);
    });
    P.push(mk("Porch railing", boxes(rl), TRIM, {}));
    P.push(mk("Exterior lamps", boxes([[-4.62, 1.95, zF + 0.1], [-1.38, 1.95, zF + 0.1], [6.55, 2.2, gz1 + 0.1], [12.05, 2.2, gz1 + 0.1]]
      .map((p) => [p[0], p[1], p[2], 0.14, 0.26, 0.12])), 0x25272b, { em: 0xffc477, anim: (t, m) => { m.material.emissiveIntensity = 0.75 + 0.25 * Math.sin(t * 2.1); } }));
    [[-W / 2 - 0.16, D / 2 + 0.1], [-W / 2 - 0.16, -D / 2 - 0.1], [W / 2 + 0.16, -D / 2 - 0.1]].forEach((p, i) =>
      P.push(mk("Downspout " + (i + 1), new THREE.CylinderGeometry(0.05, 0.05, H - 0.4, 8), TRIM, { pos: [p[0], (H - 0.4) / 2 + 0.1, p[1]], angle: 60 })));
    [-4.2, 2.2].forEach((x, i) => P.push(mk("Roof vent " + (i + 1), new THREE.CylinderGeometry(0.07, 0.09, 0.5, 8), 0x1f2226, { pos: [x, 7.45, -1.9], angle: 60 })));

    // Cutaway: clip above the first floor, drop the front and east walls, furnish the ground floor.
    let clip = null;
    if (cut) {
      clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 5.65);
      GLOSSY.add(0x1e2c44);
      const RM = /^(Front wall|Gable wall, east|Garage front wall|Garage door|Garage gable wall|Garage side window|Entry door|Door handle|Living window|Kitchen window|Sidelight|Exterior lamps|Window shutters|Bedroom \d window)|roof|chimney|flue|dormer|porch beam|attic|belly|corner/i;
      for (let i = P.length - 1; i >= 0; i--) if (RM.test(P[i].name)) P.splice(i, 1);
      const WOOD = 0xb98a5a, SOFA = 0x5d6f86, WHT = 0xe9e6df, TOP = 0x3a3d42, INT = 0xefece4;
      P.push(mk("Wood floor", boxes([[-1.325, 0.02, 0, 9.05, 0.04, 7.7]]), WOOD, { r: 0.6 }));
      P.push(mk("Tile floor", boxes([[4.6, 0.02, 0, 2.7, 0.04, 7.7]]), 0xd7d3cb, { r: 0.4 }));
      P.push(mk("Interior partition", boxes([[-1.0, 1.45, -1.5, 0.12, 2.9, 5.0]]), INT, {}));
      const st = [];
      for (let i = 0; i < 15; i++) st.push([-5.2, 0.1 * (i + 1), 3.0 - 0.33 * i, 1.0, 0.2 * (i + 1), 0.33]);
      P.push(mk("Staircase", boxes(st), 0xc9a27a, { r: 0.6 }));
      P.push(mk("Hall console", boxes([[-1.35, 0.45, -0.2, 0.4, 0.9, 1.4]]), 0x6b4a2f, {}));
      P.push(mk("Hall runner", boxes([[-3.0, 0.05, 1.5, 1.2, 0.02, 3.0]]), 0x3b5a7a, { r: 1 }));
      P.push(mk("Sofa", boxes([[1.2, 0.3, -2.9, 2.3, 0.5, 0.95], [1.2, 0.75, -3.35, 2.3, 0.5, 0.22], [0.0, 0.45, -2.9, 0.22, 0.7, 0.95], [2.4, 0.45, -2.9, 0.22, 0.7, 0.95]]), SOFA, { r: 0.9 }));
      P.push(mk("Living rug", boxes([[1.2, 0.05, -0.9, 2.8, 0.02, 2.4]]), 0x8a4b3d, { r: 1 }));
      P.push(mk("Coffee table", boxes([[1.2, 0.42, -0.9, 1.1, 0.06, 0.6], [0.75, 0.2, -1.1, 0.06, 0.4, 0.06], [1.65, 0.2, -1.1, 0.06, 0.4, 0.06], [0.75, 0.2, -0.7, 0.06, 0.4, 0.06], [1.65, 0.2, -0.7, 0.06, 0.4, 0.06]]), 0x6b4a2f, { r: 0.5 }));
      P.push(mk("Armchair", boxes([[2.7, 0.28, 0.3, 0.8, 0.5, 0.8], [3.1, 0.65, 0.3, 0.15, 0.7, 0.8]]), 0xb06a3b, { r: 0.9 }));
      P.push(mk("Plant pot", new THREE.CylinderGeometry(0.2, 0.15, 0.4, 12), 0x3a3d42, { pos: [-0.3, 0.2, 3.3], angle: 60 }));
      P.push(mk("Plant", new THREE.IcosahedronGeometry(0.4, 1), LEAF, { pos: [-0.3, 0.75, 3.3], flat: true, r: 1, seg: () => new Float32Array(0) }));
      P.push(mk("Kitchen cabinets", boxes([[4.2, 0.45, -3.45, 1.9, 0.9, 0.55]]), WHT, {}));
      P.push(mk("Countertops", boxes([[4.2, 0.92, -3.45, 1.95, 0.05, 0.6], [4.3, 0.92, 0.0, 2.0, 0.05, 0.9]]), TOP, { r: 0.3 }));
      P.push(mk("Kitchen island", boxes([[4.3, 0.45, 0.0, 1.9, 0.9, 0.8]]), WHT, {}));
      P.push(mk("Refrigerator", boxes([[5.55, 0.95, -3.4, 0.8, 1.9, 0.65]]), 0xc4ccd5, { m: 0.6, r: 0.3 }));
      [3.7, 4.3, 4.9].forEach((x, i) => P.push(mk("Bar stool " + (i + 1), new THREE.CylinderGeometry(0.18, 0.18, 0.65, 14), 0x2a2a2a, { pos: [x, 0.33, 0.75], angle: 60 })));
      P.push(mk("Car body", boxes([[9.3, 0.6, 0.5, 1.8, 0.55, 4.3]]), 0x2f4468, { m: 0.3, r: 0.35 }));
      P.push(mk("Car cabin", boxes([[9.3, 1.1, 0.3, 1.55, 0.5, 2.3]]), 0x1e2c44, { r: 0.1 }));
      [[-0.9, -0.9], [0.9, -0.9], [-0.9, 1.9], [0.9, 1.9]].forEach((w, i) => P.push(mk("Car wheel " + (i + 1), new THREE.CylinderGeometry(0.33, 0.33, 0.24, 18), 0x15181d, { rot: [0, 0, Math.PI / 2], pos: [9.3 + w[0], 0.33, w[1]], angle: 40, r: 0.9 })));
      P.push(mk("Garage shelf", boxes([[12.2, 0.9, -1.5, 0.4, 1.8, 3.0]]), 0x7b8088, {}));
      P.push(mk("Workbench", boxes([[9.3, 0.45, -2.8, 3.0, 0.9, 0.5]]), 0x8a6a45, {}));

      const NB = 0xb08a5a;
      const bed = (x, z, w) => [[x, 3.37, z, w, 0.5, 2.0], [x, 3.7, z, w - 0.1, 0.18, 1.9], [x, 3.95, z - 1.0, w, 0.9, 0.1]];
      P.push(mk("First floor slab", boxes([[0.625, 3.0, 0, 10.45, 0.18, 7.7], [-5.225, 3.0, -2.875, 1.25, 0.18, 1.95], [-5.225, 3.0, 3.425, 1.25, 0.18, 0.85]]), INT, { r: 0.8 }));
      P.push(mk("Upstairs floor", boxes([[0.625, 3.1, 0, 10.45, 0.03, 7.7], [-5.225, 3.1, -2.875, 1.25, 0.03, 1.95], [-5.225, 3.1, 3.425, 1.25, 0.03, 0.85]]), WOOD, { r: 0.6 }));
      P.push(mk("Upstairs partitions", boxes([[-1.2, 4.37, 0, 0.12, 2.5, 7.7], [2.4, 4.37, 0, 0.12, 2.5, 7.7]]), INT, {}));
      P.push(mk("Landing rail", boxes([[-4.62, 3.9, 0.55, 0.06, 0.06, 4.9], [-4.62, 3.5, -1.9, 0.06, 0.8, 0.06], [-4.62, 3.5, 0.55, 0.06, 0.8, 0.06], [-4.62, 3.5, 3.0, 0.06, 0.8, 0.06]]), 0x6b4a2f, {}));
      P.push(mk("Master bed", boxes(bed(-2.8, -2.6, 1.9)), 0x8a97a8, { r: 0.9 }));
      P.push(mk("Master linen", boxes([[-2.8, 3.82, -2.6, 1.8, 0.06, 1.9], [-3.3, 3.9, -3.4, 0.5, 0.12, 0.3], [-2.3, 3.9, -3.4, 0.5, 0.12, 0.3]]), 0xf1efe9, { r: 1 }));
      P.push(mk("Bedside tables", boxes([[-4.1, 3.4, -3.5, 0.5, 0.55, 0.45], [-1.5, 3.4, -3.5, 0.5, 0.55, 0.45]]), 0x6b4a2f, {}));
      P.push(mk("Master rug", boxes([[-2.8, 3.14, -0.9, 2.2, 0.02, 2.4]]), 0x4a5d7a, { r: 1 }));
      P.push(mk("Master wardrobe", boxes([[-1.5, 4.2, 1.9, 0.5, 2.2, 1.6]]), NB, {}));
      P.push(mk("Kids bed", boxes(bed(0.2, -2.6, 1.1)), 0x5c8a6b, { r: 0.9 }));
      P.push(mk("Desk", boxes([[1.8, 3.9, -3.4, 1.2, 0.05, 0.6], [1.3, 3.5, -3.6, 0.06, 0.78, 0.06], [2.3, 3.5, -3.6, 0.06, 0.78, 0.06], [1.3, 3.5, -3.2, 0.06, 0.78, 0.06], [2.3, 3.5, -3.2, 0.06, 0.78, 0.06]]), 0x8a6a45, {}));
      P.push(mk("Desk chair", boxes([[1.8, 3.6, -2.7, 0.45, 0.08, 0.45], [1.8, 3.95, -2.5, 0.45, 0.6, 0.06]]), 0x2a2a2a, {}));
      P.push(mk("Guest bed", boxes(bed(4.0, -2.6, 1.5)), 0xa86a5a, { r: 0.9 }));
      P.push(mk("Guest wardrobe", boxes([[5.55, 4.2, 0.8, 0.5, 2.2, 1.4]]), NB, {}));
      P.push(mk("Guest rug", boxes([[4.0, 3.14, -0.5, 2.0, 0.02, 2.0]]), 0x6b7f5a, { r: 1 }));
    }
    return {
      parts: P,
      clip,
      focus: cut ? new THREE.Box3(new THREE.Vector3(-7, 0, -5), new THREE.Vector3(13.5, 6, 7.5)) : null,
      gridStep: 1,
      dims: (box) => {
        const gy = box.min.y;
        return cat(
          dim([box.min.x, gy, box.max.z + 1], [box.max.x, gy, box.max.z + 1], [0, 0, 1]),
          dim([box.max.x + 1, gy, box.min.z], [box.max.x + 1, gy, box.max.z], [1, 0, 0]));
      },
      groundOffset: 0.0
    };
  }

  const SCENES = [
    {
      id: "airplane", build: buildPlane,
      prompt: "Four-engine double-deck airliner, 80 m wingspan, swept wings",
      alt: "A four-engine double-deck airliner drawn as a blueprint line by line, then turning into a solid 3D model",
      envelope: "length × span × height",
      cam: { from: { az: 0.0, el: 1.34 }, to: { az: 0.72, el: 0.36 } },
      camCut: { from: { az: 0.0, el: 1.34 }, to: { az: 0.2, el: 0.4 } }
    },
    {
      id: "house", build: buildHouse,
      prompt: "Four-bedroom two-storey house, double garage, covered porch",
      alt: "A two-storey house with garage and porch drawn as a blueprint line by line, then turning into a solid 3D model",
      envelope: "width × depth × height",
      cam: { from: { az: 0.0, el: 0.05 }, to: { az: 0.52, el: 0.3 } },
      camCut: { from: { az: 0.0, el: 0.05 }, to: { az: 0.42, el: 0.3 } }
    }
  ];

  /* ---------- runtime state ---------- */
  const cutBtn = document.getElementById("bpCut");
  const el = {
    tabs: Array.prototype.slice.call(stage.parentNode.querySelectorAll(".bp-tab")),
    prompt: document.getElementById("bpPrompt"),
    parts: document.getElementById("bpParts"),
    size: document.getElementById("bpSize"),
    sizeLabel: document.getElementById("bpSizeLabel")
  };
  const S = {
    index: -1, cut: false, t: 0, idle: 0, out: 0, next: -1, userPicked: false, visible: true,
    center: new THREE.Vector3(), dist: 30, cur: null,
    structN: 0, dimN: 0, lines: null, dimLines: null, grid: null, group: null, promptText: ""
  };

  const envBox = () => { const b = new THREE.Box3(); S.group.children.forEach((m) => { if (!m.userData.dress) b.expandByObject(m); }); return b; };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeIO = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);
  const easeCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

  function disposeCurrent() {
    [S.group, S.lines, S.dimLines, S.grid].forEach((o) => {
      if (!o) return;
      scene.remove(o);
      o.traverse((n) => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m.dispose());
      });
    });
    S.group = S.lines = S.dimLines = S.grid = null;
  }

  function lineObj(arr, color) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    g.setDrawRange(0, 0);
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true }));
  }

  function loadScene(i) {
    disposeCurrent();
    MATC.clear();
    const def = SCENES[i];
    const built = def.build(S.cut);
    const cl = built.clip ? [built.clip] : [];
    renderer.clippingPlanes = cl; if (dockR) dockR.clippingPlanes = cl;
    if (cutBtn) cutBtn.setAttribute("aria-pressed", S.cut ? "true" : "false");
    S.index = i; S.cur = def; S.t = 0; S.idle = 0; S.out = 0; S.next = -1;

    S.group = new THREE.Group();
    built.parts.forEach((p) => S.group.add(p.mesh));
    scene.add(S.group);
    S.anims = built.parts.filter((p) => p.mesh.userData.anim).map((p) => p.mesh);
    S.group.updateMatrixWorld(true);
    const box = envBox();
    const dimArr = built.dims(box);
    const full = box.clone();
    for (let k = 0; k < dimArr.length; k += 3) full.expandByPoint(new THREE.Vector3(dimArr[k], dimArr[k + 1], dimArr[k + 2]));

    const structArr = cat.apply(null, built.parts.map((p) => p.seg));
    S.lines = lineObj(structArr, COL.line);
    S.dimLines = lineObj(dimArr, COL.dim);
    scene.add(S.lines, S.dimLines);
    S.structN = structArr.length / 3 | 0;
    S.dimN = dimArr.length / 3 | 0;

    const size = box.getSize(new THREE.Vector3());
    const sphere = full.getBoundingSphere(new THREE.Sphere());
    const fs = built.focus ? built.focus.getBoundingSphere(new THREE.Sphere()) : sphere;
    S.center.copy(fs.center); S.focusR = built.focus ? fs.radius : 0;
    fitDistance(fs.radius);

    const gridSize = Math.ceil(sphere.radius * 2.6 / 2) * 2;
    const step = built.gridStep || 1;
    S.grid = new THREE.GridHelper(Math.ceil(gridSize / step) * step, Math.ceil(gridSize / step), COL.grid, COL.grid);
    S.grid.position.set(sphere.center.x, box.min.y - built.groundOffset, sphere.center.z);
    S.grid.material.transparent = true;
    S.grid.material.opacity = 0;
    scene.add(S.grid);

    S.promptText = def.prompt;
    if (el.parts) el.parts.textContent = built.parts.filter((p) => !p.dress).length + " parts";
    if (el.size) el.size.textContent = size.x.toFixed(1) + " × " + size.z.toFixed(1) + " × " + size.y.toFixed(1) + " m";
    if (el.sizeLabel) el.sizeLabel.textContent = "Envelope, " + def.envelope;
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", def.alt);
    el.tabs.forEach((b, k) => b.setAttribute("aria-pressed", k === i ? "true" : "false"));
    update(reduce ? 99 : 0, 1);
  }

  function fitDistance(radius) {
    const aspect = camera.aspect || 1.25;
    const base = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.88;
    S.dist = aspect < 1.25 ? base * Math.pow(1.25 / aspect, 0.85) : base;
  }

  function placeCamera(az, el_, cam, scale) {
    cam = cam || camera;
    const c = S.center, d = S.dist * (scale || 1);
    cam.position.set(
      c.x + d * Math.sin(az) * Math.cos(el_),
      c.y + d * Math.sin(el_),
      c.z + d * Math.cos(az) * Math.cos(el_));
    cam.lookAt(c);
  }

  /* k = overall visibility multiplier (used to erase the old scene before a swap) */
  function update(t, k) {
    if (!reduce && S.anims && S.anims.length) { const ta = performance.now() / 1000; for (const m of S.anims) m.userData.anim(ta, m); }
    const drawP = clamp((t - 0.3) / 3.3, 0, 1);
    const sf = clamp(drawP / 0.86, 0, 1), df = clamp((drawP - 0.86) / 0.14, 0, 1);
    const sN = Math.floor(S.structN * easeIO(sf) * k) & ~1;
    const dN = Math.floor(S.dimN * easeIO(df) * k) & ~1;
    S.lines.geometry.setDrawRange(0, sN);
    S.dimLines.geometry.setDrawRange(0, dN);

    const solid = easeIO(clamp((t - 3.6) / 1.1, 0, 1)) * k;
    S.group.traverse((n) => {
      if (!n.isMesh) return;
      const m = n.material, mx = m.userData.max, tr = !(mx >= 1 && solid > 0.999);
      m.opacity = mx * solid;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      n.visible = solid > 0.01;
    });
    S.lines.material.color.setHex(COL.line).lerp(new THREE.Color(COL.lineSolid), solid);
    S.lines.material.opacity = Math.max(0.3, 1 - solid * 0.7);
    S.grid.material.opacity = 0.2 * clamp(t / 0.8, 0, 1) * k;

    const u = easeCubic(clamp((t - 0.8) / 4.6, 0, 1));
    const c = S.cut && S.cur.camCut ? S.cur.camCut : S.cur.cam;
    placeCamera(lerp(c.from.az, c.to.az, u) + S.idle, lerp(c.from.el, c.to.el, u));

    if (el.prompt) {
      const n = Math.floor(clamp((t - 0.05) / 1.3, 0, 1) * S.promptText.length);
      el.prompt.textContent = S.promptText.slice(0, n);
      el.prompt.classList.toggle("done", n >= S.promptText.length);
    }
  }

  function toggleCut() {
    if (S.out > 0) return;
    S.userPicked = true; S.cut = !S.cut;
    if (reduce) { loadScene(S.index); renderOnce(); return; }
    S.next = S.index; S.out = 0.35;
  }
  function switchTo(i, byUser) {
    if (i === S.index || S.out > 0) return;
    if (byUser) S.userPicked = true;
    if (reduce) { loadScene(i); renderOnce(); return; }
    S.next = i; S.out = 0.35;
  }

  /* ---------- sizing, loop, wiring ---------- */
  function resize() {
    const w = host.clientWidth || 600, h = host.clientHeight || 480;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 520 ? 1.5 : 2));
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (S.cur && S.group) {
      const box = envBox();
      fitDistance(S.focusR || box.getBoundingSphere(new THREE.Sphere()).radius * 1.18);
    }
  }
  const renderOnce = () => { if (S.cur) { update(reduce ? 99 : S.t, 1); renderer.render(scene, camera); } };

  /* Docked copy: once the hero scrolls away, a small model stays on screen and turns with the scroll. */
  const dock = document.getElementById("bpDock");
  const dockHost = dock && dock.querySelector(".bp-dock-canvas");
  let dockR = null, dockCam = null, dockOn = false;
  if (dockHost && !reduce) {
    try {
      dockR = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      dockR.setClearColor(0x000000, 0);
      dockR.toneMapping = THREE.ACESFilmicToneMapping; dockR.toneMappingExposure = 1.15; dockR.localClippingEnabled = true;
      dockR.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      dockR.setSize(dockHost.clientWidth || 168, dockHost.clientHeight || 168, false);
      dockR.domElement.style.cssText = "width:100%;height:100%;display:block";
      dockHost.appendChild(dockR.domElement);
      dockCam = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
    } catch (err) { dockR = null; }
  }
  function syncDock() {
    dockOn = !!dockR && !S.visible && window.innerWidth >= 900 && window.scrollY > 200;
    if (dock) dock.classList.toggle("on", dockOn);
  }
  window.addEventListener("resize", syncDock);
  window.addEventListener("scroll", syncDock, { passive: true });

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!(S.visible || dockOn) || document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (S.out > 0) {
      S.out -= dt;
      update(S.t, clamp(S.out / 0.35, 0, 1));
      if (S.out <= 0) loadScene(S.next);
    } else {
      S.t += dt;
      S.idle += dt * 0.16 * clamp((S.t - 5.4) / 1.5, 0, 1);
      update(S.t, 1);
      if (!S.userPicked && S.t > 12.5) switchTo((S.index + 1) % SCENES.length, false);
    }
    if (S.visible) renderer.render(scene, camera);
    if (dockOn) {
      placeCamera(S.cur.cam.to.az + window.scrollY * 0.0025, S.cur.cam.to.el, dockCam, 1.2);
      dockR.render(scene, dockCam);
    }
  }

  el.tabs.forEach((b, k) => b.addEventListener("click", () => switchTo(k, true)));
  if (cutBtn) cutBtn.addEventListener("click", toggleCut);
  if (window.ResizeObserver) new ResizeObserver(() => { resize(); if (reduce) renderOnce(); }).observe(host);
  else window.addEventListener("resize", () => { resize(); if (reduce) renderOnce(); });
  if (window.IntersectionObserver) {
    new IntersectionObserver((e) => { S.visible = e[0].isIntersecting; syncDock(); }, { threshold: 0.05 }).observe(stage);
  }

  resize();
  loadScene(0);
  if (reduce) renderOnce();
  else requestAnimationFrame(frame);
}
