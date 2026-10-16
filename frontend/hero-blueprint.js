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

  /* ---------- scene: four-engine double-deck airliner (1 unit = 1 m) ---------- */
  function buildPlane() {
    const P = [];
    const FUS = 0xedf2f4, WING = 0xdce5ec, ENG = 0xc9d6e0, GLASS = 0x2c4468, GEAR = 0x4a5a70, TIRE = 0x1f2b3d, ACC = 0xd3541f;
    const rotX = [0, 0, -Math.PI / 2];

    // Fuselage: long lofted body, taller than wide for the double-deck cross-section.
    P.push(lathePart("Fuselage",
      [[0.05, -36.6], [0.55, -35.2], [1.35, -31.5], [2.35, -26.5], [3.15, -20], [3.5, -12], [3.55, -3],
       [3.55, 12], [3.5, 21], [3.28, 26.5], [2.8, 30.5], [2.1, 33.6], [1.1, 35.6], [0.05, 36.6]],
      FUS, { rot: rotX, scl: [1.18, 1, 1], long: 16 }));
    P.push(lathePart("Upper deck",
      [[0.08, -13], [1.4, -9], [2.2, -3], [2.6, 4], [2.6, 14], [2.3, 19], [1.5, 22.5], [0.6, 24.5], [0.05, 25.5]],
      FUS, { rot: rotX, pos: [4, 3.05, 0], scl: [0.78, 1, 1], long: 12 }));

    // Window rows follow the cabin: two decks, both sides, as one merged part each.
    const lower = [], upper = [];
    for (let x = -15; x <= 20.5; x += 1.55) [-1, 1].forEach((s) => lower.push([x, 0.55, s * 3.56, 0.62, 0.78, 0]));
    for (let x = -7; x <= 18.5; x += 1.5) [-1, 1].forEach((s) => upper.push([x, 3.1, s * 2.66, 0.55, 0.7, 0]));
    const lw = quadBatch(lower), uw = quadBatch(upper);
    P.push(mk("Cabin windows, main deck", lw.geo, GLASS, { seg: () => lw.seg, max: 0.96 }));
    P.push(mk("Cabin windows, upper deck", uw.geo, GLASS, { seg: () => uw.seg, max: 0.96 }));

    // Swept wing with a crank. Planform [x, z], right side; mirrored for the left.
    const LE = [[2.6, 7], [14.5, -1], [40, -17.5]];
    const TE = [[2.6, -8], [14.5, -13.5], [40, -21.5]];
    const WY = -2.2;
    const leAt = (z) => lerpAt(LE, Math.abs(z));
    const teAt = (z) => lerpAt(TE, Math.abs(z));
    const DIH = 0.075;
    [1, -1].forEach((s) => {
      const poly = [[7, 2.6], [-1, 14.5], [-17.5, 40], [-21.5, 40], [-13.5, 14.5], [-8, 2.6]].map((p) => [p[0], s * p[1]]);
      const ribs = [];
      for (let z = 5; z < 39; z += 3.2) {
        const zz = s * z;
        ribs.push(leAt(z), 0, zz, teAt(z), 0, zz);
      }
      // front spar, rear spar and flap line
      [0.18, 0.62, 0.78].forEach((f) => {
        for (let z = 2.6; z < 39.5; z += 6.1) {
          const z2 = Math.min(40, z + 6.1);
          ribs.push(
            leAt(z) + (teAt(z) - leAt(z)) * f, 0, s * z,
            leAt(z2) + (teAt(z2) - leAt(z2)) * f, 0, s * z2);
        }
      });
      P.push(mk(s > 0 ? "Wing, starboard" : "Wing, port", planform(poly, 0.55), WING, {
        rot: [Math.PI / 2 - s * DIH, 0, 0], pos: [0, WY, 0], extra: new Float32Array(ribs)
      }));
      P.push(mk(s > 0 ? "Wingtip fence, starboard" : "Wingtip fence, port",
        extrude(polyShape([[-17.4, 0], [-21.5, 0], [-21.9, 2.1], [-19.6, 2.1]]), 0.12), WING,
        { pos: [0, WY + 40 * Math.sin(DIH) + 0.1, s * 40 - 0.06] }));
    });

    // Four engines, hung below and ahead of the wing.
    [[12.2, 1], [25.5, 2]].forEach(([z0, n]) => [-1, 1].forEach((s) => {
      const z = s * z0, ex = leAt(z0) - 0.4, ey = WY + z0 * Math.sin(DIH) - 3.2;
      const tag = (s > 0 ? "starboard " : "port ") + (n === 1 ? "inner" : "outer");
      P.push(lathePart("Nacelle, " + tag,
        [[0.55, -3.9], [1.05, -3.2], [1.5, -1.6], [1.62, 0.2], [1.58, 2.2], [1.7, 3.5]],
        ENG, { rot: rotX, pos: [ex, ey, z], long: 10 }));
      P.push(mk("Fan face, " + tag, new THREE.CylinderGeometry(1.42, 1.42, 0.12, 24), GLASS,
        { rot: [0, 0, -Math.PI / 2], pos: [ex + 3.52, ey, z], max: 0.97, angle: 50 }));
      P.push(lathePart("Spinner, " + tag, [[0.5, 0], [0.38, 0.4], [0.02, 0.85]], 0x8fa3bd,
        { rot: rotX, pos: [ex + 3.5, ey, z], long: 6, max: 0.97 }));
      P.push(mk("Pylon, " + tag, extrude(polyShape([[-2.8, 0], [1.6, 0], [0.6, 2.2], [-2.4, 2.2]]), 0.4), WING,
        { rot: [0, 0, 0], pos: [ex, ey + 1.1, z - 0.2], scl: [1, 0.92, 1] }));
    }));

    // Tailplane and fin.
    [1, -1].forEach((s) => {
      const poly = [[-24.5, 1.0], [-32.4, 15.4], [-35.6, 15.4], [-34.2, 1.0]].map((p) => [p[0], s * p[1]]);
      P.push(mk(s > 0 ? "Horizontal stabilizer, starboard" : "Horizontal stabilizer, port", planform(poly, 0.3), WING,
        { rot: [Math.PI / 2 - s * 0.1, 0, 0], pos: [0, 1.4, 0] }));
    });
    const fin = [[-15, 3.7], [-28, 15.9], [-34, 15.9], [-36.2, 1.2], [-24, 1.8]];
    const rud = [];
    for (let k = 0; k < 6; k++) {
      const pt = (y) => {
        const f = (y - 1.2) / 14.7, tx = -36.2 + 2.2 * f;
        const lx = y <= 3.7 ? -15 : -15 + (-13) * ((y - 3.7) / 12.2);
        return tx + (lx - tx) * 0.26;
      };
      const y0 = 2.6 + (13.3 * k) / 6, y1 = 2.6 + (13.3 * (k + 1)) / 6;
      rud.push(pt(y0), y0, 0.2, pt(y1), y1, 0.2);
    }
    P.push(mk("Vertical fin", extrude(polyShape(fin), 0.3), ACC, { pos: [0, 0, -0.15], extra: new Float32Array(rud) }));

    // Landing gear: nose leg, two body legs, two wing legs. Each wheel is its own solid.
    const gearY = -8.3;
    const leg = (name, x, y0, z, nWheelRows, rowGap, wheelR) => {
      const h = y0 - (gearY + wheelR);
      P.push(mk(name + " strut", new THREE.CylinderGeometry(0.2, 0.26, h, 10), GEAR, { pos: [x, y0 - h / 2, z], angle: 60 }));
      for (let r = 0; r < nWheelRows; r++) {
        const xx = x + (r - (nWheelRows - 1) / 2) * rowGap;
        [-1, 1].forEach((k) => P.push(mk(name + " wheel", new THREE.CylinderGeometry(wheelR, wheelR, 0.42, 18), TIRE,
          { rot: [Math.PI / 2, 0, 0], pos: [xx, gearY + wheelR, z + k * 0.46], angle: 40 })));
      }
    };
    leg("Nose gear", 27, -3.4, 0, 1, 0, 0.62);
    [-1, 1].forEach((s) => leg("Body gear " + (s > 0 ? "starboard" : "port"), -7, -3.6, s * 2.4, 2, 1.7, 0.78));
    [-1, 1].forEach((s) => leg("Wing gear " + (s > 0 ? "starboard" : "port"), -2.5, -2.6, s * 8.6, 2, 1.7, 0.78));

    return {
      parts: P,
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
  function buildHouse() {
    const W = 12, D = 8, H = 5.6, R = 3.2, t = 0.28, P = [];
    const WALL = 0xedf2f4, TRIM = 0xf8fafc, ROOF = 0xa83e15, ROOFD = 0x8c3411, GLASS = 0x5b7ba8, BRICK = 0x9a4a26, SLAB = 0xb6c4d4, DOOR = 0xd3541f, GDOOR = 0xdce5ec;

    // Foundations, driveway, walk.
    P.push(mk("Foundation slab, main", new THREE.BoxGeometry(W + 0.7, 0.34, D + 0.7), SLAB, { pos: [0, -0.17, 0] }));
    P.push(mk("Foundation slab, garage", new THREE.BoxGeometry(6.9, 0.34, 8.6), SLAB, { pos: [9.45, -0.17, 0.8] }));
    P.push(mk("Driveway", new THREE.BoxGeometry(5.6, 0.08, 7.2), 0xc8d2de, { pos: [9.3, -0.04, 8.8] }));
    P.push(mk("Front walk", new THREE.BoxGeometry(1.5, 0.08, 4.6), 0xc8d2de, { pos: [-3, -0.04, 9.7] }));

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

    return {
      parts: P,
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
      cam: { from: { az: 0.0, el: 1.34 }, to: { az: 0.72, el: 0.36 } }
    },
    {
      id: "house", build: buildHouse,
      prompt: "Four-bedroom two-storey house, double garage, covered porch",
      alt: "A two-storey house with garage and porch drawn as a blueprint line by line, then turning into a solid 3D model",
      envelope: "width × depth × height",
      cam: { from: { az: 0.0, el: 0.05 }, to: { az: 0.5, el: 0.27 } }
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
    const step = built.gridStep || 1;
    S.grid = new THREE.GridHelper(Math.ceil(gridSize / step) * step, Math.ceil(gridSize / step), COL.grid, COL.grid);
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
