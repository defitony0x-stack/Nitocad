/* NitoCAD Studio: front end only.
   All backend calls go through the `Backend` object near the top. When the chat backend
   changes, replace `Backend.send` and `Backend.anchor` and leave the rest alone.
   Add ?demo=1 to the URL to explore the interface with sample parts and no sign-in. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const Auth = window.NitoAuth;
const BASE = Auth.API_BASE;
const DEMO = new URLSearchParams(location.search).get("demo") === "1";
const $ = (id) => document.getElementById(id);
const esc = (v) => { const d = document.createElement("div"); d.textContent = v == null ? "" : String(v); return d.innerHTML; };
const uid = () => Math.random().toString(36).slice(2, 10);
const IS_TOUCH = matchMedia("(hover: none)").matches;

/* ============================================================ backend adapter */
const Backend = {
  /* Returns { reply, part?, needCredits?, authExpired? }. `lastPart` is the latest part in
     this chat, so edits can build on it. Until the backend takes conversation history, an
     edit is sent as the earlier description plus the new instruction. */
  async send({ text, lastPart }) {
    if (DEMO) return Demo.send(text, lastPart);
    const session = Auth.getSession();
    if (!session) return { authExpired: true };
    const balance = await Auth.fetchBalance();
    if (balance === 0) return { needCredits: true };
    const description = lastPart ? lastPart.description + ". Change: " + text : text;
    let res, data;
    try {
      res = await fetch(BASE + "/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.session_id },
        body: JSON.stringify({ description })
      });
      if (res.status === 401) return { authExpired: true };
      data = await res.json();
    } catch (e) {
      return { reply: "I could not reach the build service. Check your connection and try again.", error: true };
    }
    if (!res.ok || !data.success) {
      return { reply: (data && (data.error || data.detail)) || "That build failed (HTTP " + res.status + ").", error: true };
    }
    const p = data.parameters || {};
    const part = {
      id: uid(), description, jobId: data.job_id || null,
      partType: p.part_type || "part", params: flatParams(p), material: p.material || "",
      notes: collectNotes(data), createdAt: Date.now()
    };
    part.title = titleFor(part.partType);
    return { reply: replyFor(part, !!lastPart), part };
  },

  async anchor(part) {
    if (DEMO) { await sleep(1400); return { anchor_tx: "0x" + uid() + uid() + uid() + uid() + uid() + uid(), explorer_url: "https://scan.botchain.ai" }; }
    const session = Auth.getSession();
    if (!session) throw new Error("Your session expired. Sign in again.");
    const auth = { Authorization: "Bearer " + session.session_id };
    const prep = await fetch(`${BASE}/api/jobs/${part.jobId}/anchor/prepare`, { method: "POST", headers: auth });
    const p = await prep.json().catch(() => ({}));
    if (!prep.ok) throw new Error(p.detail || "Could not prepare the anchor.");
    if (p.already_anchored) return { anchor_tx: p.anchor_tx, explorer_url: p.explorer_url };
    if (!window.ethereum) throw new Error("No wallet found to sign the anchor.");
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: p.tx.chainId }] }); } catch (e) { /* already on chain */ }
    const txHash = await window.ethereum.request({ method: "eth_sendTransaction", params: [p.tx] });
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`${BASE}/api/jobs/${part.jobId}/anchor/confirm`, {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ tx_hash: txHash })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || "Anchor verification failed.");
      if (d.status === "anchored") return d;
      await sleep(2000);
    }
    throw new Error("The anchor was submitted but is not confirmed yet. Check again shortly.");
  },

  async exportFile(part, fmt) {
    if (DEMO) { await sleep(700); toast("Demo mode: no file is produced."); return; }
    const session = Auth.getSession();
    if (!session) throw new Error("Your session expired. Sign in again.");
    if (fmt === "stl") {
      const blob = await fetchStl(part, true);
      return blobDownload(blob, (part.title || "part").replace(/\s+/g, "_") + ".stl");
    }
    const r = await fetch(`${BASE}/export/${fmt}/${part.jobId}/link`, { method: "POST", headers: { Authorization: "Bearer " + session.session_id } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || "Export failed (HTTP " + r.status + ").") }
    const info = await r.json();
    deliver(BASE + info.url, info.filename || `${part.jobId}.${fmt}`);
  },

  async buyCredits(tier) {
    const cfg = await Auth.getChainConfig();
    const price = tier === "single" ? cfg.credit_price_bot : tier === "pack_1000" ? cfg.pack_1000_price_bot : cfg.pack_10000_price_bot;
    const session = Auth.getSession();
    if (!session) throw new Error("Sign in first.");
    const account = await Auth.connectWallet();
    const wei = BigInt(Math.round(price * 1e18));
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to: cfg.treasury_address, value: "0x" + wei.toString(16) }]
    });
    const r = await fetch(BASE + "/credits/purchase", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.session_id },
      body: JSON.stringify({ tx_hash: txHash, tier })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || "Credit purchase failed.");
    return d.balance;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function flatParams(p) {
  const out = {};
  Object.entries(p.parameters || {}).forEach(([k, v]) => { if (k !== "operations" && typeof v !== "object") out[k] = v; });
  return out;
}
function collectNotes(data) {
  const v = data.validation || {}, notes = [];
  (v.warnings || []).forEach((w) => notes.push(String(w)));
  Object.entries(v.corrections || {}).forEach(([k, c]) => notes.push(`${k}: ${c.old} to ${c.new}`));
  return notes;
}
function titleFor(t) { return String(t || "part").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()); }
function replyFor(part, isEdit) {
  const n = Object.keys(part.params).length;
  let s = isEdit ? `Updated. This is a new version of the ${part.title} with your change applied.` : `Here is your ${part.title}, built as a solid with ${n} parameter${n === 1 ? "" : "s"}.`;
  if (part.notes && part.notes.length) s += `\n\nI adjusted a few values to keep it manufacturable. The details are under Specs.`;
  s += `\n\nTell me what to change, or open Files to export STEP.`;
  return s;
}

/* ============================================================ demo backend */
const Demo = {
  async send(text, lastPart) {
    await sleep(1800);
    const t = (lastPart ? lastPart.description + " " : "") + text;
    const low = t.toLowerCase();
    const kind = /gear/.test(low) ? "gear" : /shaft|coupling|rod/.test(low) ? "shaft" : /box|enclosure|case/.test(low) ? "box" : "bracket";
    const num = (re, d) => { const m = low.match(re); return m ? parseFloat(m[1]) : d; };
    const thick = /thicker/.test(low) && lastPart ? Math.round(lastPart.params.thickness_mm * 1.2 * 10) / 10 : num(/(\d+(?:\.\d+)?)\s*mm thick/, 3);
    const defs = {
      bracket: { width_mm: num(/(\d+)\s*mm wide/, 50), height_mm: num(/(\d+)\s*mm tall/, 60), thickness_mm: thick, holes: num(/(\d+)\s*holes/, 4), fillet_mm: 5 },
      gear: { teeth: num(/(\d+)\s*teeth/, 20), module: num(/module\s*(\d+(?:\.\d+)?)/, 2), thickness_mm: num(/(\d+)\s*mm thick/, 10), bore_mm: num(/(\d+)\s*mm bore/, 5) },
      shaft: { diameter_mm: num(/(\d+)\s*mm diameter/, 10), length_mm: num(/(\d+)\s*mm long/, 50), chamfer_mm: 0.5 },
      box: { length_mm: 100, width_mm: 80, height_mm: 50, wall_mm: 3, lid: true }
    };
    const part = {
      id: uid(), description: t, jobId: "demo-" + uid(), demoKind: kind, partType: kind === "bracket" ? "l_bracket" : kind,
      params: defs[kind], material: "6061 aluminum", notes: [], createdAt: Date.now()
    };
    part.title = titleFor(part.partType);
    return { reply: replyFor(part, !!lastPart), part };
  },
  geometry(kind, p) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xD3541F, metalness: 0.15, roughness: 0.45 });
    const add = (geo, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    if (kind === "gear") {
      const N = Math.max(6, Math.round(p.teeth || 20)), ro = (p.module || 2) * N / 2 + (p.module || 2), ri = ro - (p.module || 2) * 2.2;
      const sh = new THREE.Shape();
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2, w = Math.PI / N;
        const pts = [[ri, a], [ri, a + w * 0.3], [ro, a + w * 0.55], [ro, a + w * 0.95], [ri, a + w * 1.2]];
        pts.forEach(([r, ang], j) => { const x = Math.cos(ang) * r, y = Math.sin(ang) * r; (i === 0 && j === 0) ? sh.moveTo(x, y) : sh.lineTo(x, y); });
      }
      const hole = new THREE.Path(); hole.absarc(0, 0, (p.bore_mm || 5) / 2, 0, Math.PI * 2, true); sh.holes.push(hole);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: p.thickness_mm || 10, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2); add(geo);
    } else if (kind === "shaft") {
      const r = (p.diameter_mm || 10) / 2, L = p.length_mm || 50, c = p.chamfer_mm || 0.5;
      const geo = new THREE.LatheGeometry([[0, 0], [r - c, 0], [r, c], [r, L - c], [r - c, L], [0, L]].map(([x, y]) => new THREE.Vector2(x, y)), 48);
      geo.rotateZ(Math.PI / 2); add(geo);
    } else if (kind === "box") {
      const L = p.length_mm, W = p.width_mm, H = p.height_mm, t = p.wall_mm;
      add(new THREE.BoxGeometry(L, t, W), 0, t / 2, 0);
      add(new THREE.BoxGeometry(L, H, t), 0, H / 2, W / 2 - t / 2);
      add(new THREE.BoxGeometry(L, H, t), 0, H / 2, -W / 2 + t / 2);
      add(new THREE.BoxGeometry(t, H, W - 2 * t), L / 2 - t / 2, H / 2, 0);
      add(new THREE.BoxGeometry(t, H, W - 2 * t), -L / 2 + t / 2, H / 2, 0);
    } else {
      const w = p.width_mm || 50, h = p.height_mm || 60, t = p.thickness_mm || 3, d = 40;
      const base = new THREE.Shape(); base.moveTo(0, 0); base.lineTo(w, 0); base.lineTo(w, d); base.lineTo(0, d); base.closePath();
      const n = Math.min(6, Math.max(0, Math.round(p.holes || 4)));
      for (let i = 0; i < n; i++) { const hp = new THREE.Path(); hp.absarc(w * (0.2 + 0.6 * (i % 2)), d * (0.28 + 0.44 * Math.floor(i / 2) / Math.max(1, Math.ceil(n / 2) - 1 || 1)), 2.6, 0, Math.PI * 2, true); base.holes.push(hp); }
      const g1 = new THREE.ExtrudeGeometry(base, { depth: t, bevelEnabled: false }); g1.rotateX(-Math.PI / 2); g1.translate(-w / 2, 0, d / 2);
      add(g1);
      add(new THREE.BoxGeometry(w, h, t), 0, h / 2, -d / 2 + t / 2);
    }
    const b = new THREE.Box3().setFromObject(g), c = b.getCenter(new THREE.Vector3());
    g.children.forEach((m) => { m.position.sub(new THREE.Vector3(c.x, 0, c.z)); });
    return g;
  }
};

/* ============================================================ state + storage */
const S = { chats: [], activeId: null, activePartId: null, busy: false, balance: null, tab: "specs" };
let storeKey = "nitocad_studio_v1:guest";
function userKey() { const s = Auth.getSession(); return DEMO ? "demo" : (s ? (s.email || s.wallet_address || "user") : "guest"); }
function load() {
  storeKey = "nitocad_studio_v1:" + userKey();
  try { S.chats = JSON.parse(localStorage.getItem(storeKey) || "[]"); } catch (e) { S.chats = []; }
  S.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  S.activeId = null;
}
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(storeKey, JSON.stringify(S.chats.slice(0, 60))); } catch (e) { /* storage full or blocked */ } }, 150);
}
const chat = () => S.chats.find((c) => c.id === S.activeId) || null;
function newChat() { const c = { id: uid(), title: "New design", createdAt: Date.now(), updatedAt: Date.now(), messages: [], parts: {} }; S.chats.unshift(c); return c; }
function partOf(c, id) { return c && c.parts[id]; }
function lastPart(c) { if (!c) return null; for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.partId && c.parts[m.partId]) return c.parts[m.partId]; } return null; }
function versionsOf(c, part) { const all = []; c.messages.forEach((m) => { if (m.partId && c.parts[m.partId]) all.push(c.parts[m.partId]); }); return all; }

/* ============================================================ toast + downloads */
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3200); }
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function deliver(url, filename) {
  const a = document.createElement("a"); a.href = url; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
  if (IS_MOBILE) saveBar(url, filename);
}
function saveBar(url, filename) {
  const old = $("saveBar"); if (old) old.remove();
  const bar = document.createElement("div"); bar.id = "saveBar";
  bar.style.cssText = "position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:200;background:#111827;color:#fff;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:center;font-size:.85rem;";
  bar.innerHTML = `<span style="flex:1;min-width:0;word-break:break-all">Download started. Not saving? ${esc(filename)}</span>`;
  const a = document.createElement("a"); a.href = url; a.textContent = "Tap to save"; a.setAttribute("download", filename);
  a.style.cssText = "background:#13A57D;color:#fff;padding:9px 14px;border-radius:999px;font-weight:600;text-decoration:none;white-space:nowrap";
  const x = document.createElement("button"); x.textContent = "\u2715"; x.setAttribute("aria-label", "Dismiss"); x.style.cssText = "background:none;border:0;color:#9ca3af;font-size:18px";
  x.onclick = () => bar.remove(); a.onclick = () => setTimeout(() => bar.remove(), 1500);
  bar.append(a, x); document.body.appendChild(bar); setTimeout(() => bar.remove(), 25000);
}
async function blobDownload(blob, filename) {
  if (IS_MOBILE && navigator.canShare && navigator.share) {
    try { const f = new File([blob], filename, { type: blob.type || "application/octet-stream" }); if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: filename }); return; } }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  if (IS_MOBILE) { saveBar(url, filename); return; }
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function fetchStl(part, asBlob) {
  const url = `${BASE}/download/job/${part.jobId}/stl`;
  const r = await fetch(url, { headers: Auth.authHeader() });
  if (!r.ok) throw new Error("Could not load the mesh (HTTP " + r.status + ").");
  return asBlob ? r.blob() : r.arrayBuffer();
}

/* ============================================================ viewer */
const V = { ready: false, running: false, mesh: null, wire: false, grid: true, token: 0 };
function viewerInit() {
  if (V.ready) return;
  const el = $("cvStage");
  V.scene = new THREE.Scene(); V.scene.background = new THREE.Color(0xEDF2F4);
  V.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  V.renderer = new THREE.WebGLRenderer({ antialias: true });
  V.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  el.insertBefore(V.renderer.domElement, el.firstChild);
  V.controls = new OrbitControls(V.camera, V.renderer.domElement);
  V.controls.enableDamping = true;
  V.scene.add(new THREE.HemisphereLight(0xffffff, 0xb7c3d1, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(60, 90, 50); V.scene.add(dl);
  V.gridObj = new THREE.GridHelper(160, 16, 0xb7c3d1, 0xd5dde6); V.scene.add(V.gridObj);
  new ResizeObserver(viewerFit).observe(el);
  V.ready = true;
}
function viewerFit() {
  if (!V.ready) return;
  const el = $("cvStage"), w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  V.renderer.setSize(w, h); V.camera.aspect = w / h; V.camera.updateProjectionMatrix();
}
function viewerLoop() { if (!V.running) return; requestAnimationFrame(viewerLoop); V.controls.update(); V.renderer.render(V.scene, V.camera); }
function viewerReset() {
  if (!V.ready) return;
  const y = V.mesh ? V.mesh.userData.midY || 0 : 0;
  V.camera.position.set(95, 80 + y, 95); V.controls.target.set(0, y, 0); V.controls.update();
}
function viewerStatus(msg, loading) {
  const stage = $("cvStage"); let el = stage.querySelector(".cv-load");
  if (!msg) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.className = "cv-load"; el.innerHTML = "<i></i><span></span>"; stage.appendChild(el); }
  el.querySelector("i").style.display = loading ? "" : "none";
  el.querySelector("span").textContent = msg;
}
function applyWire() { if (!V.mesh) return; V.mesh.traverse((o) => { if (o.isMesh) o.material.wireframe = V.wire; }); }
async function viewerShow(part) {
  $("cvEmpty").hidden = !!part;
  if (!part) { if (V.mesh) { V.scene.remove(V.mesh); V.mesh = null; } $("cvDim").hidden = true; return; }
  viewerInit(); viewerFit();
  if (!V.running) { V.running = true; viewerLoop(); }
  const token = ++V.token;
  viewerStatus("Loading part", true);
  try {
    let obj;
    if (part.demoKind) { await sleep(250); obj = Demo.geometry(part.demoKind, part.params); }
    else {
      const geo = new STLLoader().parse(await fetchStl(part, false));
      geo.computeVertexNormals();
      obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xD3541F, metalness: 0.15, roughness: 0.45 }));
      geo.center(); geo.rotateX(-Math.PI / 2);
    }
    if (token !== V.token) return;
    if (V.mesh) V.scene.remove(V.mesh);
    const wrap = new THREE.Group(); wrap.add(obj);
    const b0 = new THREE.Box3().setFromObject(wrap), size = b0.getSize(new THREE.Vector3());
    const k = 70 / (Math.max(size.x, size.y, size.z) || 1);
    wrap.scale.setScalar(k);
    const b1 = new THREE.Box3().setFromObject(wrap), c = b1.getCenter(new THREE.Vector3());
    wrap.position.set(-c.x, -b1.min.y, -c.z);
    wrap.userData.midY = (b1.max.y - b1.min.y) / 2;
    V.mesh = wrap; V.scene.add(wrap); applyWire(); viewerReset(); viewerStatus("");
    const d = $("cvDim"); d.hidden = false; d.textContent = `${size.x.toFixed(1)} x ${size.z.toFixed(1)} x ${size.y.toFixed(1)} mm`;
  } catch (e) { if (token === V.token) viewerStatus(e.message || "Could not load the part.", false); }
}

/* ============================================================ rendering: sidebar */
function groupLabel(ts) {
  const d = (Date.now() - ts) / 864e5;
  return d < 1 ? "Today" : d < 2 ? "Yesterday" : d < 8 ? "Previous 7 days" : "Earlier";
}
function renderSide() {
  const list = $("chatList");
  const real = S.chats.filter((c) => c.messages.length);
  if (!real.length) { list.innerHTML = '<div class="chat-empty">Your designs will show up here. Start one with a message.</div>'; return; }
  let html = "", last = "";
  real.forEach((c) => {
    const g = groupLabel(c.updatedAt);
    if (g !== last) { html += `<div class="chat-group">${g}</div>`; last = g; }
    html += `<div class="chat-item${c.id === S.activeId ? " active" : ""}"><button class="chat-open" data-open="${c.id}">${esc(c.title)}</button>` +
      `<button class="chat-del" data-del="${c.id}" aria-label="Delete ${esc(c.title)}"><svg class="icon" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button></div>`;
  });
  list.innerHTML = html;
}

/* ============================================================ rendering: thread */
const STARTERS = [
  ["Motor mount", "Mounting bracket for a 50mm stepper motor, 4 holes, 5mm fillets, 3mm thick"],
  ["Spur gear", "Gear with 24 teeth, module 2, 10mm thick, 6mm bore"],
  ["Enclosure", "Box enclosure 100x80x50mm, 3mm walls, with lid"],
  ["Drive shaft", "Shaft 12mm diameter, 120mm long, 1mm chamfer"]
];
function thumbSvg(kind) {
  const s = '<svg viewBox="0 0 84 68" fill="none" stroke="#0B2545" stroke-width="1.4" stroke-linejoin="round">';
  const shapes = {
    gear: '<circle cx="42" cy="34" r="20" fill="#fff"/><circle cx="42" cy="34" r="6"/><path d="M42 10v6M42 52v6M18 34h6M60 34h6M25 17l4 4M55 47l4 4M59 17l-4 4M29 47l-4 4"/>',
    shaft: '<rect x="8" y="27" width="68" height="14" rx="2" fill="#fff"/><path d="M14 27v14M70 27v14"/>',
    box: '<path d="M14 26l28-12 28 12v22L42 60 14 48z" fill="#fff"/><path d="M14 26l28 12 28-12M42 38v22"/>',
    bracket: '<path d="M18 18h14v28h34v10H18z" fill="#fff"/><circle cx="25" cy="27" r="2"/><circle cx="25" cy="42" r="2"/><circle cx="48" cy="51" r="2"/><circle cx="60" cy="51" r="2"/>'
  };
  return s + (shapes[kind] || shapes.bracket) + "</svg>";
}
function kindOf(part) { return part.demoKind || (/gear/.test(part.partType) ? "gear" : /shaft/.test(part.partType) ? "shaft" : /box|enclosure/.test(part.partType) ? "box" : "bracket"); }
function para(text) { return String(text).split(/\n\n+/).map((t) => "<p>" + esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>") + "</p>").join(""); }
const ASSIST_AVA = '<div class="ava"><img src="logo-mark.png" alt=""></div>';

function partCardHtml(c, part, isLatest) {
  const vers = versionsOf(c, part), v = vers.findIndex((p) => p.id === part.id) + 1;
  const chips = Object.entries(part.params).slice(0, 4).map(([k, val]) => `<span class="spec-chip">${esc(k.replace(/_mm$/, ""))} ${esc(val)}${/_mm$/.test(k) ? " mm" : ""}</span>`).join("");
  const anchored = part.anchor ? '<span class="ver anchored">anchored</span>' : "";
  return `<div class="part"><button class="part-top" data-part="${part.id}" aria-label="Open ${esc(part.title)} in viewer">` +
    `<div class="part-thumb">${thumbSvg(kindOf(part))}</div>` +
    `<div class="part-meta"><div class="part-title">${esc(part.title)} <span class="ver">v${v}</span>${anchored}</div><div class="part-specs">${chips}</div></div>` +
    `<span class="part-open">Open <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M9 6l6 6-6 6"/></svg></span></button>` +
    `<div class="part-actions"><button class="chip" data-export="${part.id}">Export STEP</button><button class="chip" data-part="${part.id}" data-tab="chain">Anchor on-chain</button></div></div>` +
    (isLatest ? followupsHtml(part) : "");
}
function followupsHtml(part) {
  const k = kindOf(part);
  const set = { gear: ["Add 4 lightening holes", "Make the bore 8 mm", "Use 30 teeth"], shaft: ["Add a keyway", "Make it 150 mm long", "Add a 2 mm chamfer"], box: ["Add 4 corner screw posts", "Make the walls 4 mm", "Add a vent slot"], bracket: ["Make it thicker", "Add 2 more holes", "Use 8 mm fillets"] }[k];
  return '<div class="followups">' + set.map((t) => `<button class="chip" data-say="${esc(t)}">${esc(t)}</button>`).join("") + "</div>";
}
function renderThread(animateLast) {
  const inner = $("threadInner"), c = chat();
  if (!c || !c.messages.length) {
    inner.innerHTML = `<div class="hello"><div class="mark"><img src="logo-mark.png" alt=""></div><h1>What are we building?</h1>` +
      `<p>Describe a part in plain words. Then keep talking to change it. Every version stays in this chat.</p>` +
      `<div class="starters">${STARTERS.map(([t, p]) => `<button class="starter" data-say="${esc(p)}"><b>${esc(t)}</b><span>${esc(p)}</span></button>`).join("")}</div></div>`;
    return;
  }
  const latest = lastPart(c);
  inner.innerHTML = c.messages.map((m) => {
    if (m.role === "user") return `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>`;
    const part = m.partId ? partOf(c, m.partId) : null;
    let extra = "";
    if (part) extra = partCardHtml(c, part, latest && latest.id === part.id && m === c.messages[c.messages.length - 1]);
    if (m.needCredits) extra = needCreditsHtml();
    return `<div class="msg">${ASSIST_AVA}<div class="reply" data-mid="${m.id}">${para(m.text)}${extra}</div></div>`;
  }).join("");
}
function needCreditsHtml() {
  return `<div class="need-credits"><b>You are out of credits</b><p>Each new build uses 1 credit. Edits in the same chat stay free until the next build.</p><button class="btn btn-primary btn-sm" data-buy="open">Get credits</button></div>`;
}
function scrollEnd(smooth) { const t = $("thread"); t.scrollTo({ top: t.scrollHeight, behavior: smooth ? "smooth" : "auto" }); }

/* working indicator */
let workTimer = 0;
function showWorking() {
  const inner = $("threadInner");
  const steps = ["Reading your request", "Checking the dimensions", "Building the solid", "Preparing the preview"];
  const el = document.createElement("div"); el.className = "msg"; el.id = "working";
  el.innerHTML = ASSIST_AVA + '<div class="reply"><div class="working">' + steps.map((s, i) => `<div class="work-row ${i === 0 ? "live" : ""}" data-i="${i}"><span class="tick"></span><span>${s}</span></div>`).join("") + "</div></div>";
  inner.appendChild(el); scrollEnd(true);
  let i = 0;
  workTimer = setInterval(() => {
    const rows = el.querySelectorAll(".work-row");
    if (i < rows.length) { rows[i].className = "work-row done"; rows[i].querySelector(".tick").innerHTML = '<svg viewBox="0 0 12 12"><path d="M2 6.5l2.5 2.5L10 3.5"/></svg>'; }
    i++;
    if (i < rows.length) rows[i].className = "work-row live"; else clearInterval(workTimer);
  }, 1100);
}
function hideWorking() { clearInterval(workTimer); const w = $("working"); if (w) w.remove(); }

/* ============================================================ rendering: canvas */
function renderCanvas() {
  const c = chat(), part = c && S.activePartId ? partOf(c, S.activePartId) : null;
  $("cvTitle").textContent = part ? part.title : "Part viewer";
  const sel = $("cvVersion");
  if (part) {
    const vers = versionsOf(c, part);
    sel.hidden = vers.length < 2;
    sel.innerHTML = vers.map((p, i) => `<option value="${p.id}"${p.id === part.id ? " selected" : ""}>v${i + 1}</option>`).join("");
  } else sel.hidden = true;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === S.tab ? "true" : "false"));
  const panel = $("panel");
  if (!part) { panel.innerHTML = '<div class="chat-empty">Build a part to see its specs, files and on-chain record here.</div>'; return; }
  if (S.tab === "specs") {
    let rows = `<div class="row"><span>part_type</span><span>${esc(part.partType)}</span></div>`;
    Object.entries(part.params).forEach(([k, v]) => { rows += `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`; });
    if (part.material) rows += `<div class="row"><span>material</span><span>${esc(part.material)}</span></div>`;
    let notes = "";
    if (part.notes && part.notes.length) notes = `<div class="note"><b>Adjusted for manufacturability</b><ul>${part.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
    panel.innerHTML = `<div class="kv">${rows}</div>${notes}`;
  } else if (S.tab === "files") {
    const F = [["STEP", "step", "3D solid for CAD and CAM"], ["IGES", "iges", "3D solid, older systems"], ["DXF", "dxf", "2D cut layers for laser and CNC"], ["PDF", "pdf", "1:1 drawing"], ["STL", "stl", "Mesh for 3D printing"]];
    panel.innerHTML = '<div class="files">' + F.map(([n, f, d]) => `<div class="file"><span class="ext">${n}</span><div class="what"><b>${n} file</b><span>${d}</span></div><button class="btn btn-ghost btn-sm" data-dl="${f}">Download</button></div>`).join("") + "</div>";
  } else {
    if (part.anchor) {
      const tx = part.anchor.anchor_tx || "";
      panel.innerHTML = `<div class="chain"><div class="kick">Anchored on BOT Chain</div><b>This version has a permanent record</b><div class="tx">Tx ${esc(tx.slice(0, 12))}...${esc(tx.slice(-8))}</div><a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="${esc(part.anchor.explorer_url || "https://scan.botchain.ai")}">View on explorer</a></div>`;
    } else {
      panel.innerHTML = `<div class="chain"><div class="kick">Optional · BOT Chain</div><b>Anchor this version on-chain</b><ul>` +
        `<li>A timestamped record nobody can edit later, including us.</li><li>Your wallet is stored as the submitter, so you can show you registered it first.</li>` +
        `<li>Anyone can check the parameters and STEP file hashes on the explorer.</li></ul>` +
        `<div class="fine">Costs a small network fee from your wallet. Separate from downloading.</div><button class="btn btn-primary" id="anchorBtn">Anchor on BOT Chain</button></div>`;
    }
  }
}
function openCanvas(partId, tab) {
  const c = chat(); if (!c) return;
  if (partId) S.activePartId = partId;
  if (tab) S.tab = tab;
  $("app").classList.add("canvas-open");
  renderCanvas();
  const part = partOf(c, S.activePartId);
  viewerShow(part);
  if (innerWidth <= 1180) $("scrim").classList.add("on");
}
function closeCanvas() { $("app").classList.remove("canvas-open"); $("scrim").classList.remove("on"); }

/* ============================================================ sending */
async function send(text) {
  text = (text || "").trim();
  if (!text || S.busy) return;
  let c = chat();
  if (!c) { c = newChat(); S.activeId = c.id; }
  const prior = lastPart(c);
  c.messages.push({ id: uid(), role: "user", text });
  if (c.title === "New design") c.title = text.length > 44 ? text.slice(0, 42).trim() + "..." : text;
  c.updatedAt = Date.now();
  $("input").value = ""; autosize(); $("send").disabled = true;
  S.busy = true; renderThread(); renderSide(); $("chatTitle").textContent = c.title; scrollEnd(false); showWorking();
  let out;
  try { out = await Backend.send({ text, lastPart: prior }); } catch (e) { out = { reply: "Something went wrong on my side. Please try again.", error: true }; }
  hideWorking(); S.busy = false;
  if (out.authExpired) { Auth.clearSession(); c.messages.pop(); toast("Your session expired. Sign in again."); save(); route(); return; }
  const msg = { id: uid(), role: "assistant", text: out.reply || "" };
  if (out.needCredits) { msg.text = "I need a credit to build this."; msg.needCredits = true; }
  if (out.part) { c.parts[out.part.id] = out.part; msg.partId = out.part.id; S.activePartId = out.part.id; }
  c.messages.push(msg); c.updatedAt = Date.now(); save();
  renderThread(); renderSide(); scrollEnd(true);
  if (out.part) { if (!DEMO) refreshBalance(); openCanvas(out.part.id, "specs"); if (innerWidth <= 1180) { /* on small screens keep the chat in view, the card opens the sheet */ closeCanvas(); } }
  $("send").disabled = !$("input").value.trim();
}

/* ============================================================ credits */
async function refreshBalance() {
  if (DEMO) { S.balance = 24; } else { S.balance = await Auth.fetchBalance(); }
  const n = $("creditNum"); n.textContent = S.balance == null ? "-" : S.balance.toLocaleString();
  $("creditChip").classList.toggle("low", S.balance != null && S.balance <= 2);
}
async function openCredits() {
  let cfg = null;
  try { cfg = DEMO ? { credit_price_bot: 0.01, pack_1000_price_bot: 1, pack_1000_credits: 1000, pack_10000_price_bot: 10, pack_10000_credits: 10000 } : await Auth.getChainConfig(); } catch (e) { toast("Could not load pricing. Try again shortly."); return; }
  const tiers = [["single", "1 credit", cfg.credit_price_bot], ["pack_1000", (cfg.pack_1000_credits || 1000).toLocaleString() + " credits", cfg.pack_1000_price_bot], ["pack_10000", (cfg.pack_10000_credits || 10000).toLocaleString() + " credits", cfg.pack_10000_price_bot]];
  const m = document.createElement("div"); m.className = "modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
  m.innerHTML = `<div class="modal-card"><h3>Get credits</h3><p>Paid in native BOT on BOT Chain. A build uses 1 credit, and every export format is included.</p>` +
    tiers.map(([id, label, price]) => `<div class="tier"><div><b>${label}</b><span>${price} BOT</span></div><button class="btn btn-primary btn-sm" data-tier="${id}">Buy</button></div>`).join("") +
    `<div class="modal-foot"><button class="btn btn-ghost btn-sm" data-close>Close</button></div></div>`;
  document.body.appendChild(m);
  m.addEventListener("click", async (e) => {
    if (e.target === m || e.target.closest("[data-close]")) { m.remove(); return; }
    const b = e.target.closest("[data-tier]"); if (!b) return;
    b.disabled = true; const t = b.textContent; b.textContent = "Confirm in wallet";
    try { if (DEMO) { await sleep(900); } else { await Backend.buyCredits(b.dataset.tier); } await refreshBalance(); toast("Credits added."); m.remove(); }
    catch (err) { toast(err.message || "Purchase failed."); b.disabled = false; b.textContent = t; }
  });
}

/* ============================================================ composer */
function autosize() { const t = $("input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 180) + "px"; }
$("input").addEventListener("input", () => { autosize(); $("send").disabled = S.busy || !$("input").value.trim(); });
$("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !IS_TOUCH) { e.preventDefault(); send($("input").value); } });
$("send").addEventListener("click", () => send($("input").value));

/* ============================================================ events */
function openSide() { $("side").classList.add("open"); $("scrim").classList.add("on"); }
function closeSide() { $("side").classList.remove("open"); if (!$("app").classList.contains("canvas-open") || innerWidth > 1180) $("scrim").classList.remove("on"); }
$("menuBtn").addEventListener("click", openSide);
$("sideClose").addEventListener("click", closeSide);
$("scrim").addEventListener("click", () => { closeSide(); if (innerWidth <= 1180) closeCanvas(); $("scrim").classList.remove("on"); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSide(); if (innerWidth <= 1180) closeCanvas(); } });
$("cvClose").addEventListener("click", closeCanvas);
$("canvasBtn").addEventListener("click", () => { const c = chat(), p = c && lastPart(c); if (p) openCanvas(S.activePartId || p.id); else toast("Build a part first."); });
$("creditChip").addEventListener("click", openCredits);
$("newChat").addEventListener("click", () => { S.activeId = null; S.activePartId = null; closeCanvas(); closeSide(); renderAll(); $("input").focus(); });
$("signOut").addEventListener("click", async () => { await Auth.signOut(); if (DEMO) location.href = "studio.html"; else route(); });
$("tReset").addEventListener("click", viewerReset);
$("tWire").addEventListener("click", (e) => { V.wire = !V.wire; e.currentTarget.setAttribute("aria-pressed", V.wire); applyWire(); });
$("tGrid").addEventListener("click", (e) => { V.grid = !V.grid; e.currentTarget.setAttribute("aria-pressed", V.grid); if (V.gridObj) V.gridObj.visible = V.grid; });
$("cvVersion").addEventListener("change", (e) => { S.activePartId = e.target.value; renderCanvas(); viewerShow(partOf(chat(), S.activePartId)); });
document.querySelector(".tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (!t) return; S.tab = t.dataset.tab; renderCanvas(); });

$("chatList").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) { if (confirm("Delete this design chat?")) { S.chats = S.chats.filter((c) => c.id !== del.dataset.del); if (S.activeId === del.dataset.del) { S.activeId = null; S.activePartId = null; closeCanvas(); } save(); renderAll(); } return; }
  const open = e.target.closest("[data-open]");
  if (open) { S.activeId = open.dataset.open; const p = lastPart(chat()); S.activePartId = p ? p.id : null; closeSide(); closeCanvas(); renderAll(); scrollEnd(false); }
});
$("threadInner").addEventListener("click", async (e) => {
  const say = e.target.closest("[data-say]"); if (say) { send(say.dataset.say); return; }
  const buy = e.target.closest("[data-buy]"); if (buy) { openCredits(); return; }
  const ex = e.target.closest("[data-export]");
  if (ex) { S.activePartId = ex.dataset.export; openCanvas(ex.dataset.export, "files"); return; }
  const pt = e.target.closest("[data-part]"); if (pt) openCanvas(pt.dataset.part, pt.dataset.tab || "specs");
});
$("panel").addEventListener("click", async (e) => {
  const c = chat(), part = c && partOf(c, S.activePartId); if (!part) return;
  const dl = e.target.closest("[data-dl]");
  if (dl) {
    dl.disabled = true; const t = dl.textContent; dl.textContent = "Building";
    try { await Backend.exportFile(part, dl.dataset.dl); } catch (err) { toast(err.message || "Download failed."); }
    dl.disabled = false; dl.textContent = t; return;
  }
  if (e.target.closest("#anchorBtn")) {
    const b = $("anchorBtn"); b.disabled = true; b.textContent = "Confirm in your wallet";
    try { part.anchor = await Backend.anchor(part); save(); toast("Anchored on BOT Chain."); renderCanvas(); renderThread(); }
    catch (err) { toast(err.message || "Anchor not completed."); b.disabled = false; b.textContent = "Anchor on BOT Chain"; }
  }
});

/* theme */
function flipTheme() {
  const root = document.documentElement, next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next); try { localStorage.setItem("nitocad-theme", next); } catch (e) { /* ignore */ }
}
$("themeBtn").addEventListener("click", flipTheme);
$("gateTheme").addEventListener("click", flipTheme);

/* ============================================================ gate + routing */
function showGate(show) { $("gate").hidden = !show; $("app").hidden = show; }
async function gateWallet() {
  const b = $("gateWallet"), err = $("gateErr"); err.textContent = ""; b.disabled = true; const t = b.textContent; b.textContent = "Waiting for your wallet";
  try { await Auth.signInWithWallet(); } catch (e) { err.textContent = e.message || "Sign-in failed."; }
  b.disabled = false; b.textContent = t;
}
$("gateWallet").addEventListener("click", gateWallet);
Auth.onError = (e) => { $("gateErr").textContent = (e && e.message) || "Sign-in failed."; };

function renderAll() {
  const c = chat();
  $("chatTitle").textContent = c ? c.title : "New design";
  renderSide(); renderThread(); renderCanvas();
}
function fillAccount() {
  const s = Auth.getSession(), name = DEMO ? "Demo account" : Auth.displayName(s);
  $("acctName").textContent = name; $("avatar").textContent = (name.replace(/^0x/, "")[0] || "N");
  $("acctSub").textContent = DEMO ? "Sample data" : (s && s.email ? "Google" : "Wallet");
}
let booted = false;
function route() {
  const signed = DEMO || !!Auth.getSession();
  if (!signed) { showGate(true); booted = false; Auth.initGoogle([$("gateGoogle")]); return; }
  showGate(false);
  if (!booted) { booted = true; load(); fillAccount(); refreshBalance(); renderAll(); if (!IS_TOUCH) $("input").focus(); }
}
Auth.onChange(() => route());
route();
