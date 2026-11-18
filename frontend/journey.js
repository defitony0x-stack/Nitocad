/* NitoCAD journey layer.
   1) Hero idea box: hands the description to the Workspace through the same
      sessionStorage key ("nito_prefill") the free preview already uses.
   2) Workspace preview: a self-contained example project. All data here is
      illustrative and labelled as such on the page. It makes no network calls. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- 1. idea box ---------- */
  var idea = $("jxIdea");
  if (idea) {
    var chipWrap = $("jxKinds");
    chipWrap.addEventListener("click", function (e) {
      var b = e.target.closest(".jx-chip"); if (!b) return;
      var on = b.getAttribute("aria-pressed") === "true";
      b.setAttribute("aria-pressed", on ? "false" : "true");
    });
    $("jxStart").addEventListener("click", function () {
      var text = idea.value.trim();
      var kinds = Array.prototype.map.call(chipWrap.querySelectorAll('[aria-pressed="true"]'), function (b) { return b.textContent; });
      var out = text;
      if (kinds.length) out = (text ? text + "\n\n" : "") + "Project type: " + kinds.join(", ") + ".";
      try { if (out) sessionStorage.setItem("nito_prefill", out); } catch (e) {}
      location.href = "studio.html";
    });
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
