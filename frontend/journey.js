/* NitoCAD journey layer.
   1) Homepage composer: description, optional attachment, optional category and examples. "Start creating" hands the text to the
      Workspace through the same sessionStorage key ("nito_prefill") the free preview already uses, and the attached file through IndexedDB.
   2) Workspace preview: a self-contained example project. All data here is
      illustrative and labelled as such on the page. It makes no network calls. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- 1. composer ---------- */
  var idea = $("description");
  var kindSel = $("cmpKind");
  var fileInput = $("cmpFile");
  var fileRow = $("cmpFiles");
  var noteEl = $("cmpNote");
  var composer = $("composer");
  var MAX_MB = 15;                                   /* same limit as the Workspace */
  var OK_EXT = /\.(step|stp|iges|igs|brep|pdf|png|jpe?g|webp|stl|obj|glb|gltf|3mf|dxf|svg|kicad_pcb|zip|gbr|ger|gtl|gbl|gts|gbs|gto|gbo|gtp|gbp|gko|gm1|gm2|gml|g\d+)$/i;
  var attached = null;
  var DEFAULT_NOTE = noteEl ? noteEl.textContent : "";

  function setNote(msg, isErr) {
    if (!noteEl) return;
    noteEl.textContent = msg || DEFAULT_NOTE;
    noteEl.style.color = isErr ? "#f0a36f" : "";
  }
  function fmtBytes(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function grow() { idea.style.height = "auto"; idea.style.height = Math.min(idea.scrollHeight + 2, 360) + "px"; }

  /* The file itself travels to the Workspace through IndexedDB (sessionStorage is too small for CAD files). */
  function openDb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open("nito_handoff", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("files"); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function dbOp(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction("files", mode);
        fn(tx.objectStore("files"));
        tx.oncomplete = function () { db.close(); res(true); };
        tx.onerror = tx.onabort = function () { db.close(); rej(tx.error); };
      });
    });
  }
  function saveFile(f) { return dbOp("readwrite", function (s) { s.put({ name: f.name, type: f.type, size: f.size, blob: f, t: Date.now() }, "attachment"); }); }
  function dropFile() { return dbOp("readwrite", function (s) { s.delete("attachment"); }); }

  function drawFile() {
    if (!fileRow) return;
    fileRow.innerHTML = "";
    if (!attached) { fileRow.hidden = true; return; }
    var chip = document.createElement("div"); chip.className = "cmp-chip";
    chip.innerHTML = "<span></span><small></small><button type=\"button\" aria-label=\"Remove attachment\"><svg width=\"12\" height=\"12\" viewBox=\"0 0 12 12\" aria-hidden=\"true\"><path d=\"M2.5 2.5l7 7M9.5 2.5l-7 7\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\"/></svg></button>";
    chip.querySelector("span").textContent = attached.name;
    chip.querySelector("small").textContent = fmtBytes(attached.size);
    chip.querySelector("button").addEventListener("click", function () { attached = null; drawFile(); setNote(); idea.focus(); });
    fileRow.appendChild(chip);
    fileRow.hidden = false;
  }
  function setFile(f) {
    if (!f) return;
    if (!OK_EXT.test(f.name)) { setNote("NitoCAD can open STEP, IGES, DXF, SVG, PDF, images, meshes and KiCad or Gerber files.", true); return; }
    if (f.size > MAX_MB * 1048576) { setNote("That file is over " + MAX_MB + " MB.", true); return; }
    if (!f.size) { setNote("That file is empty.", true); return; }
    attached = f; drawFile(); setNote("Attached. NitoCAD reads it in the Workspace.");
  }

  /* examples: the cards on the page plus two more for "Try an example" */
  var EXTRA = [
    { kind: "Aerospace", text: "A mounting bracket for an avionics box, 100 x 80 mm base, 3 mm thick, with 4 holes." },
    { kind: "", text: "A gear with 20 teeth, module 2, 10 mm thick, 5 mm bore." }
  ];
  function pool() {
    var list = Array.prototype.map.call(document.querySelectorAll(".ex[data-prompt]"), function (b) {
      return { kind: b.getAttribute("data-kind") || "", text: b.getAttribute("data-prompt") };
    });
    return list.concat(EXTRA);
  }
  function useExample(ex) {
    idea.value = ex.text;
    if (kindSel) kindSel.value = ex.kind || "";
    grow(); idea.focus();
    var r = composer.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight) composer.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (idea) {
    idea.addEventListener("input", grow);
    idea.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } });
    idea.addEventListener("paste", function (e) {
      var f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
      if (f) { e.preventDefault(); setFile(f); }
    });

    if ($("cmpAttach")) $("cmpAttach").addEventListener("click", function () { fileInput.click(); });
    if (fileInput) fileInput.addEventListener("change", function () { var f = fileInput.files && fileInput.files[0]; fileInput.value = ""; setFile(f); });

    ["dragenter", "dragover"].forEach(function (ev) { composer.addEventListener(ev, function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0) { e.preventDefault(); composer.classList.add("drag"); }
    }); });
    ["dragleave", "drop"].forEach(function (ev) { composer.addEventListener(ev, function () { composer.classList.remove("drag"); }); });
    composer.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { e.preventDefault(); setFile(f); }
    });

    $("cmpExample").addEventListener("click", function () {
      var all = pool(), sel = kindSel ? kindSel.value : "", cur = idea.value.trim();
      var fresh = function (list) { return list.filter(function (x) { return x.text !== cur; }); };
      var list = fresh(sel ? all.filter(function (x) { return x.kind === sel; }) : all);   /* same category first, never the text already in the box */
      if (!list.length) list = fresh(all);
      if (!list.length) list = all;
      useExample(list[Math.floor(Math.random() * list.length)]);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".ex[data-prompt]"), function (b) {
      b.addEventListener("click", function () { useExample({ kind: b.getAttribute("data-kind") || "", text: b.getAttribute("data-prompt") }); });
    });

    /* hand-off to the Workspace: text through sessionStorage (the key the free preview already uses), file through IndexedDB */
    var going = false;
    function go() {
      if (going) return; going = true;
      var text = idea.value.trim(), kind = kindSel ? kindSel.value : "";
      var out = text && kind ? text + "\n\nCategory: " + kind : text;
      try { if (out) sessionStorage.setItem("nito_prefill", out); } catch (e) {}
      var finish = function () { location.href = "studio.html"; };
      var saved = attached ? saveFile(attached) : dropFile();
      var timer = setTimeout(finish, 1500);
      saved.then(function () { clearTimeout(timer); finish(); }, function () {
        clearTimeout(timer);
        if (attached) { try { sessionStorage.setItem("nito_prefill_note", "Your browser would not pass " + attached.name + " along. Attach it again here."); } catch (e) {} }
        finish();
      });
    }
    $("jxStart").addEventListener("click", go);
    window.NitoHandoff = { go: go };

    /* links that mean "take me to the box" */
    Array.prototype.forEach.call(document.querySelectorAll("[data-focus-composer]"), function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(function () { idea.focus({ preventScroll: true }); }, 250); });
    });
    grow();
  }

  /* ---------- 2. Workspace preview ---------- */
  var root = $("jxWs"); if (!root) return;

  var MEANS = {
    Confirmed: "You approved it", Proposed: "NitoCAD suggested it", Unknown: "Information missing",
    Derived: "Calculated from your inputs", Rejected: "You turned it down"
  };
  var S = {
    rev: 1, rev2: false, extra: [],
    r: {
      a: ["Support the motor securely", "Confirmed"],
      b: ["Provide maintenance access", "Confirmed"],
      m: ["Motor mass not given yet", "Unknown"],
      l: ["Design load", "Unknown"],
      h: ["Mounting hole positions", "Proposed"],
      p: ["Manufacturing process", "Proposed"]
    },
    hist: ["Project created from your description", "Requirements captured: 2 confirmed, 2 proposed, 2 open"]
  };
  var PROPOSED_TEXT = {
    h: "Hole layout proposed by NitoCAD. Needs your approval",
    p: "Manufacturing: CNC machining (suggested)"
  };
  S.r.h[0] = PROPOSED_TEXT.h; S.r.p[0] = PROPOSED_TEXT.p;

  function ids() { return Object.keys(S.r); }
  function tag(s) { return '<span class="jx-tag jx-s-' + s + '" title="' + MEANS[s] + '">' + s + "</span>"; }

  function drawReqs() {
    $("jxReqs").innerHTML = ids().map(function (k, n) {
      var r = S.r[k], btns = "";
      if (r[1] === "Proposed") {
        btns = '<div class="jx-acts"><button type="button" class="jx-btn sm" data-k="' + k + '" data-a="Confirmed">Confirm</button>' +
               '<button type="button" class="jx-btn sm" data-k="' + k + '" data-a="Rejected">Reject</button></div>';
      }
      return '<div class="jx-row' + (r[1] === "Rejected" ? " rej" : "") + '"><div class="t"><small>R-00' + (n + 1) + '</small><span class="tx">' + esc(r[0]) + "</span>" + btns + "</div>" + tag(r[1]) + "</div>";
    }).join("");
    Array.prototype.forEach.call($("jxReqs").querySelectorAll("[data-k]"), function (b) {
      b.onclick = function () {
        var CONF = { h: "Mounting hole layout", p: "Manufacturing: CNC machining" };
        if (b.dataset.a === "Confirmed" && CONF[b.dataset.k]) S.r[b.dataset.k][0] = CONF[b.dataset.k];
        S.r[b.dataset.k][1] = b.dataset.a;
        S.hist.push("You marked “" + (PROPOSED_TEXT[b.dataset.k] ? S.r[b.dataset.k][0] : S.r[b.dataset.k][0]) + "” " + b.dataset.a.toLowerCase());
        render();
      };
    });
  }

  function checks() {
    var r = S.r, hOk = r.h[1] === "Confirmed", pOk = r.p[1] === "Confirmed";
    return [
      ["Part is a valid solid", "PASS", "Geometry check on revision " + S.rev],
      ["Hole pattern fits the motor", hOk ? "PASS" : "UNKNOWN", hOk ? "Checked against the confirmed hole layout" : "Needs a confirmed hole layout (R-005)"],
      ["Can be made by the chosen process", pOk ? "PASS" : "UNKNOWN", pOk ? "Rules for CNC machining applied" : "Manufacturing process not confirmed (R-006)"],
      ["Carries the design load", "UNKNOWN", "No stress analysis has been run on this revision"]
    ];
  }
  function drawChecks() {
    $("jxChecks").innerHTML = checks().map(function (c) {
      return '<div class="jx-row"><div class="t">' + c[0] + '<span class="ev">' + c[2] + '</span></div><b class="jx-vd jx-' + c[1] + '">' + c[1] + "</b></div>";
    }).join("");
  }

  function drawCanvas() {
    var ok = S.r.h[1] === "Confirmed", h = ok ? "#3ecf8e" : "#f2b84b";
    var slot = S.rev2 ? '<rect x="225" y="86" width="40" height="28" rx="14" fill="#070c16" stroke="#6ea8ff" stroke-dasharray="4 3"/>' : "";
    var holes = [[185, 100], [295, 100], [185, 135], [295, 135]].map(function (p) {
      return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="9" fill="#070c16" stroke="' + h + '" stroke-width="2"/>';
    }).join("");
    $("jxCv").innerHTML =
      '<defs><pattern id="jxg" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#14213a"/></pattern></defs>' +
      '<rect width="420" height="260" fill="url(#jxg)"/>' +
      '<polygon points="70,190 250,190 330,150 150,150" fill="#2b3a57" stroke="#6b7fa6"/>' +
      '<polygon points="70,190 70,205 250,205 250,190" fill="#1b2740" stroke="#6b7fa6"/>' +
      '<polygon points="150,150 330,150 330,60 150,60" fill="#34476b" stroke="#8aa0c9"/>' +
      '<polygon points="250,190 330,150 330,165 250,205" fill="#1b2740" stroke="#6b7fa6"/>' +
      holes + slot +
      '<text x="16" y="28" fill="#8e9db0" font-family="JetBrains Mono,IBM Plex Mono,monospace" font-size="10">' +
      (S.rev2 ? "Rev 02 proposal, kept separate" : "Rev 0" + S.rev) + " · holes " + (ok ? "confirmed" : "not confirmed") + "</text>";
  }

  function drawChat() {
    var hc = S.r.h[1] === "Confirmed";
    var base = ['<div class="jx-msg"><small>NitoCAD</small>I built the first bracket and checked what I could. ' + (hc ? "Hole positions are confirmed, so that check now runs against them." : "Hole positions are not confirmed, so I marked that check UNKNOWN rather than guess.") + "</div>"];
    if (S.r.h[1] !== "Confirmed") {
      base.push('<div class="jx-msg"><small>Decision needed · mounting geometry</small>I proposed a hole layout. I will only treat it as final once you confirm it under Requirements.</div>');
    }
    $("jxChat").innerHTML = base.concat(S.extra).join("");
  }

  function drawAct() {
    var a = [["Understood your description", "done"], ["Captured requirements and open decisions", "done"],
             ["Built revision 01 geometry", "done"], ["Ran the checks that can run today", "done"], ["Drawings and exports", "pending"]];
    if (S.rev2) a.splice(4, 0, ["Revision 02 built separately and compared with revision 01", "done"]);
    $("jxAct").innerHTML = a.map(function (x) { return '<div class="jx-act ' + x[1] + '"><span class="d"></span>' + x[0] + "</div>"; }).join("");
  }
  function drawTl() { $("jxTl").innerHTML = S.hist.map(function (h) { return "<div>" + esc(h) + "</div>"; }).join(""); }

  function render() {
    drawReqs(); drawChecks(); drawCanvas(); drawChat(); drawAct(); drawTl();
    $("jxRev").textContent = "Rev 0" + S.rev + (S.rev2 ? " · rev 02 proposed" : "");
  }

  $("jxWhy").onclick = function () {
    S.extra.push('<div class="jx-msg"><small>NitoCAD</small>Plain version: an L-shape gives the motor a flat face to bolt to and leaves the other side open for maintenance. The load path and wall thickness are one click away for engineers.</div>');
    render();
  };
  $("jxLighter").onclick = function () {
    if (S.rev2) return;
    S.rev2 = true;
    S.hist.push("Revision 02 proposed: lighter. Revision 01 untouched");
    S.extra.push('<div class="jx-msg"><small>NitoCAD</small>Lighter is possible. I built it as a separate revision so nothing is overwritten. It affects R-004 (design load), which is still UNKNOWN. Accept or discard it below the model.</div>');
    var c = $("jxCmp"); c.className = "jx-cmp on";
    c.innerHTML = '<h5>Revision 02 vs revision 01</h5><p>Adds a lightening slot. Affects: design load (R-004). Illustrative figures: 410 g to 330 g.</p>' +
      '<div class="jx-acts"><button type="button" class="jx-btn pri sm" id="jxAcc">Accept revision 02</button><button type="button" class="jx-btn sm" id="jxDis">Discard</button></div>';
    $("jxAcc").onclick = function () { S.rev = 2; S.rev2 = false; S.hist.push("You accepted revision 02. Evidence for revision 01 stays with revision 01"); c.className = "jx-cmp"; render(); };
    $("jxDis").onclick = function () { S.rev2 = false; S.hist.push("You discarded revision 02"); c.className = "jx-cmp"; render(); };
    render();
  };

  render();
})();
