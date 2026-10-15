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
  host.appendChild(renderer.domElement);
  stage.classList.add("bp-live");

  const COL = { line: 0xbfd3f2, lineSolid: 0x1d3659, dim: 0xff8f5e, grid: 0xc9a24b };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1.25, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1b3358, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
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

  const mat = (color, max = 1) => {
    const m = new THREE.MeshLambertMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    m.userData.max = max;
    return m;
  };

  function mk(name, geo, color, o = {}) {
    const mesh = new THREE.Mesh(geo, mat(color, o.max == null ? 1 : o.max));
    if (o.pos) mesh.position.set(o.pos[0], o.pos[1], o.pos[2]);
    if (o.rot) mesh.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
    if (o.scl) mesh.scale.set(o.scl[0], o.scl[1], o.scl[2]);
    mesh.updateMatrix();
    let seg = o.seg ? o.seg(mesh.matrix) : edgeSeg(geo, mesh.matrix, o.angle == null ? 28 : o.angle);
    if (o.extra) seg = cat(seg, o.extra);
    return { name, mesh, seg };
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
      .getPoints(36).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
    const geo = new THREE.LatheGeometry(sm, 32);
    return mk(name, geo, color, Object.assign({}, o, { seg: (m) => xf(latheLines(ctrl, sm, o.long || 10), m) }));
  }

  // Engineering-style dimension line with end ticks.
  function dim(a, b, t, tick) {
    tick = tick || 0.32;
    const p = (v, s) => [v[0] + t[0] * tick * s, v[1] + t[1] * tick * s, v[2] + t[2] * tick * s];
    return new Float32Array([].concat(a, b, p(a, -1), p(a, 1), p(b, -1), p(b, 1)));
  }

  /* ---------- scene: light twin-prop airplane (1 unit = 1 m) ---------- */
  function buildPlane() {
    const P = [];
    P.push(lathePart("Fuselage",
      [[0.04, -5.2], [0.16, -4.6], [0.38, -3.4], [0.62, -1.8], [0.78, 0], [0.84, 1.8], [0.8, 3.4], [0.62, 4.5], [0.3, 5.1], [0, 5.3]],
      0xedf2f4, { rot: [0, 0, -Math.PI / 2] }));
    P.push(lathePart("Canopy", [[0, -0.9], [0.38, -0.6], [0.5, 0], [0.4, 0.6], [0, 0.9]],
      0x5b7ba8, { rot: [0, 0, -Math.PI / 2], pos: [1.7, 0.62, 0], scl: [0.7, 1, 0.8], long: 6, max: 0.95 }));

    const le = (z) => { const a = Math.abs(z); return a <= 0.8 ? 1.3 : 1.3 - 0.7 * ((a - 0.8) / 5.2); };
    const te = (z) => { const a = Math.abs(z); return a <= 0.8 ? -0.9 : -0.9 + 0.3 * ((a - 0.8) / 5.2); };
    const ribs = [];
    [-5.2, -4.2, -3.2, -2.2, -1.5, 1.5, 2.2, 3.2, 4.2, 5.2].forEach((z) => ribs.push(le(z), -0.147, z, te(z), -0.147, z));
    [-1, 1].forEach((s) => ribs.push(te(s * 1.2) + 0.5, -0.147, s * 1.2, te(s * 5.9) + 0.5, -0.147, s * 5.9));
    P.push(mk("Wing", extrude(polyShape([[0.6, -6], [1.3, -0.8], [1.3, 0.8], [0.6, 6], [-0.6, 6], [-0.9, 0.8], [-0.9, -0.8], [-0.6, -6]]), 0.14),
      0xdce5ec, { rot: [Math.PI / 2, 0, 0], pos: [0, -0.15, 0], extra: new Float32Array(ribs) }));

    [-2.6, 2.6].forEach((z, i) => {
      P.push(lathePart("Engine nacelle " + (i + 1), [[0.05, -1.2], [0.3, -0.8], [0.42, 0], [0.4, 0.8], [0.28, 1.3], [0, 1.5]],
        0xc9d6e0, { rot: [0, 0, -Math.PI / 2], pos: [1.5, -0.2, z], long: 8 }));
      P.push(mk("Propeller " + (i + 1), new THREE.BoxGeometry(0.06, 1.9, 0.16), 0x9db0c8, { pos: [3.05, -0.2, z] }));
    });

    P.push(mk("Vertical fin", extrude(polyShape([[-3.0, 0.3], [-4.3, 2.5], [-5.1, 2.5], [-5.1, 0.1]]), 0.12),
      0xd3541f, { pos: [0, 0, -0.06] }));
    P.push(mk("Horizontal stabilizer", extrude(polyShape([[-4.6, -2.2], [-4.1, -0.3], [-4.1, 0.3], [-4.6, 2.2], [-5.1, 2.2], [-5.1, -2.2]]), 0.1),
      0xdce5ec, { rot: [Math.PI / 2, 0, 0], pos: [0, 2.62, 0] }));

    return {
      parts: P,
      dims: (box) => {
        const gy = box.min.y - 0.5;
        return cat(
          dim([box.min.x, gy, box.max.z + 1], [box.max.x, gy, box.max.z + 1], [0, 0, 1]),
          dim([box.max.x + 1, gy, box.min.z], [box.max.x + 1, gy, box.max.z], [1, 0, 0]));
      },
      groundOffset: 0.5
    };
  }

  /* ---------- scene: two-bedroom gable house (1 unit = 1 m) ---------- */
  function buildHouse() {
    const W = 9, D = 7, H = 3.2, R = 2.4, t = 0.25, P = [];
    P.push(mk("Foundation slab", new THREE.BoxGeometry(W + 0.8, 0.3, D + 0.8), 0xb6c4d4, { pos: [0, -0.15, 0] }));

    const front = polyShape(rectPts(-W / 2, 0, W / 2, H));
    front.holes.push(rectPath(-1.6, 0, -0.6, 2.2), rectPath(0.8, 0.9, 3.4, 2.6), rectPath(-4.0, 1.0, -2.4, 2.4));
    P.push(mk("Front wall", extrude(front, t), 0xedf2f4, { pos: [0, 0, D / 2 - t] }));

    const back = polyShape(rectPts(-W / 2, 0, W / 2, H));
    back.holes.push(rectPath(-3.2, 1.0, -1.4, 2.4), rectPath(1.4, 1.0, 3.2, 2.4));
    P.push(mk("Rear wall", extrude(back, t), 0xedf2f4, { pos: [0, 0, -D / 2] }));

    [-1, 1].forEach((s) => {
      const g = polyShape([[-D / 2, 0], [D / 2, 0], [D / 2, H], [0, H + R], [-D / 2, H]]);
      g.holes.push(rectPath(-0.6, 1.2, 0.6, 2.4));
      P.push(mk(s > 0 ? "Gable wall east" : "Gable wall west", extrude(g, t), 0xedf2f4,
        { rot: [0, Math.PI / 2, 0], pos: [s > 0 ? W / 2 - t : -W / 2, 0, 0] }));
    });

    const th = Math.atan2(R, D / 2), slope = Math.hypot(R, D / 2), L = slope + 0.55, rt = 0.18;
    [1, -1].forEach((s) => {
      const sh = (L - slope) / 2;
      const cz = s * (D / 4) + s * Math.cos(th) * sh + s * Math.sin(th) * rt / 2;
      const cy = H + R / 2 - Math.sin(th) * sh + Math.cos(th) * rt / 2;
      P.push(mk(s > 0 ? "Roof front slope" : "Roof rear slope", new THREE.BoxGeometry(W + 1.0, rt, L), 0xa83e15,
        { pos: [0, cy, cz], rot: [s * th, 0, 0] }));
    });
    P.push(mk("Ridge cap", new THREE.BoxGeometry(W + 1.0, 0.14, 0.34), 0x8c3411, { pos: [0, H + R + 0.1, 0] }));
    P.push(mk("Chimney", new THREE.BoxGeometry(0.7, 2.2, 0.7), 0x9a4a26, { pos: [2.8, 5.5, -0.9] }));
    P.push(mk("Chimney cap", new THREE.BoxGeometry(0.9, 0.12, 0.9), 0x6e3a22, { pos: [2.8, 6.66, -0.9] }));
    P.push(mk("Entry door", new THREE.BoxGeometry(1.0, 2.2, 0.08), 0xd3541f, { pos: [-1.1, 1.1, D / 2 - t / 2] }));
    P.push(mk("Entry step", new THREE.BoxGeometry(1.8, 0.16, 0.7), 0xb6c4d4, { pos: [-1.1, 0.08, D / 2 + 0.35] }));

    const pane = (name, x0, y0, x1, y1, z, dz) => {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, zz = z + dz;
      return mk(name, new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.05), 0x5b7ba8, {
        pos: [cx, cy, z], max: 0.95,
        extra: new Float32Array([cx, y0, zz, cx, y1, zz, x0, cy, zz, x1, cy, zz])
      });
    };
    P.push(pane("Window living", 0.8, 0.9, 3.4, 2.6, D / 2 - t / 2, 0.03));
    P.push(pane("Window bedroom 1", -4.0, 1.0, -2.4, 2.4, D / 2 - t / 2, 0.03));
    P.push(pane("Window rear 1", -3.2, 1.0, -1.4, 2.4, -D / 2 + t / 2, -0.03));
    P.push(pane("Window rear 2", 1.4, 1.0, 3.2, 2.4, -D / 2 + t / 2, -0.03));
    [-1, 1].forEach((s) => {
      const x = s * (W / 2 - t / 2);
      P.push(mk("Window gable " + (s > 0 ? "east" : "west"), new THREE.BoxGeometry(0.05, 1.2, 1.2), 0x5b7ba8, {
        pos: [x, 1.8, 0], max: 0.95,
        extra: new Float32Array([x + s * 0.03, 1.2, 0, x + s * 0.03, 2.4, 0, x + s * 0.03, 1.8, -0.6, x + s * 0.03, 1.8, 0.6])
      }));
    });

    return {
      parts: P,
      dims: (box) => {
        const gy = box.min.y;
        return cat(
          dim([box.min.x, gy, box.max.z + 1], [box.max.x, gy, box.max.z + 1], [0, 0, 1]),
          dim([box.max.x + 1, gy, box.min.z], [box.max.x + 1, gy, box.max.z], [1, 0, 0]));
      },
      groundOffset: 0
    };
  }

  const SCENES = [
    {
      id: "airplane", build: buildPlane,
      prompt: "Twin-prop light aircraft, 12 m wingspan, T-tail",
      alt: "A twin-propeller airplane drawn as a blueprint line by line, then turning into a solid 3D model",
      envelope: "length × span × height",
      cam: { from: { az: 0.0, el: 1.34 }, to: { az: 0.78, el: 0.4 } }
    },
    {
      id: "house", build: buildHouse,
      prompt: "Two-bedroom gable house, 9 × 7 m footprint, pitched roof",
      alt: "A gable-roof house drawn as a blueprint line by line, then turning into a solid 3D model",
      envelope: "width × depth × height",
      cam: { from: { az: 0.0, el: 0.05 }, to: { az: 0.62, el: 0.3 } }
    }
  ];

  /* ---------- runtime state ---------- */
  const el = {
    tabs: Array.prototype.slice.call(stage.parentNode.querySelectorAll(".bp-tab")),
    prompt: document.getElementById("bpPrompt"),
    parts: document.getElementById("bpParts"),
    size: document.getElementById("bpSize"),
    sizeLabel: document.getElementById("bpSizeLabel")
  };
  const S = {
    index: -1, t: 0, idle: 0, out: 0, next: -1, userPicked: false, visible: true,
    center: new THREE.Vector3(), dist: 30, cur: null,
    structN: 0, dimN: 0, lines: null, dimLines: null, grid: null, group: null, promptText: ""
  };

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
    const def = SCENES[i];
    const built = def.build();
    S.index = i; S.cur = def; S.t = 0; S.idle = 0; S.out = 0; S.next = -1;

    S.group = new THREE.Group();
    built.parts.forEach((p) => S.group.add(p.mesh));
    scene.add(S.group);
    S.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(S.group);
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
    S.center.copy(sphere.center);
    fitDistance(sphere.radius);

    const gridSize = Math.ceil(sphere.radius * 2.6 / 2) * 2;
    S.grid = new THREE.GridHelper(gridSize, gridSize, COL.grid, COL.grid);
    S.grid.position.set(sphere.center.x, box.min.y - built.groundOffset, sphere.center.z);
    S.grid.material.transparent = true;
    S.grid.material.opacity = 0;
    scene.add(S.grid);

    S.promptText = def.prompt;
    if (el.parts) el.parts.textContent = built.parts.length + " parts";
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
    const drawP = clamp((t - 0.3) / 3.3, 0, 1);
    const sf = clamp(drawP / 0.86, 0, 1), df = clamp((drawP - 0.86) / 0.14, 0, 1);
    const sN = Math.floor(S.structN * easeIO(sf) * k) & ~1;
    const dN = Math.floor(S.dimN * easeIO(df) * k) & ~1;
    S.lines.geometry.setDrawRange(0, sN);
    S.dimLines.geometry.setDrawRange(0, dN);

    const solid = easeIO(clamp((t - 3.6) / 1.1, 0, 1)) * k;
    S.group.traverse((n) => {
      if (!n.isMesh) return;
      n.material.opacity = n.material.userData.max * solid;
      n.visible = solid > 0.01;
    });
    S.lines.material.color.setHex(COL.line).lerp(new THREE.Color(COL.lineSolid), solid);
    S.lines.material.opacity = Math.max(0.35, 1 - solid * 0.2);
    S.grid.material.opacity = 0.2 * clamp(t / 0.8, 0, 1) * k;

    const u = easeCubic(clamp((t - 0.8) / 4.6, 0, 1));
    const c = S.cur.cam;
    placeCamera(lerp(c.from.az, c.to.az, u) + S.idle, lerp(c.from.el, c.to.el, u));

    if (el.prompt) {
      const n = Math.floor(clamp((t - 0.05) / 1.3, 0, 1) * S.promptText.length);
      el.prompt.textContent = S.promptText.slice(0, n);
      el.prompt.classList.toggle("done", n >= S.promptText.length);
    }
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
      const box = new THREE.Box3().setFromObject(S.group);
      fitDistance(box.getBoundingSphere(new THREE.Sphere()).radius * 1.18);
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
