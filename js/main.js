/* ═══════════════════════════════════════════════════════════════
   TIGA Kontraktor — scroll-cinema engine (image-sequence edition)
   · Scroll never moves the page: it drives a virtual timeline 0→1
   · The timeline picks a frame from a pre-extracted WebP sequence
     and paints it on canvas — no video decoder, so scrubbing is
     instant and perfectly reversible
   · Last frame == first frame → progress wraps mod 1 (infinite)
   · A preloader gates entry on a coarse frame set (every 6th);
     the remaining frames stream in silently and sharpen playback
   · If the sequence is missing, a procedural 3D model of the same
     journey renders instead
   ═══════════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  const canvas = $("#heroCanvas");
  const railFill = $("#railFill");
  const railPct = $("#railPct");
  const scrollHint = $("#scrollHint");
  const copyItems = $$(".copy__item");
  const phaseDots = $$(".phase-dot");
  const loader = $("#loader");
  const loaderFill = $("#loaderFill");
  const loaderPct = $("#loaderPct");

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = matchMedia("(max-width: 900px)").matches;

  /* ── virtual timeline ─────────────────────────────────────── */

  // one full journey ≈ 9 wheel-screens of travel
  const TRAVEL = 9000;
  let target = 0;      // unbounded — wrapping happens at read time
  let current = 0;
  let panelOpen = false;
  let interacted = false;

  const wrap = (v) => ((v % 1) + 1) % 1;

  // ease the timeline to progress p via the shortest way around the loop
  function goTo(p) {
    let d = (p - wrap(target)) % 1;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    target += d;
    interacted = true;
  }

  function onWheel(e) {
    if (panelOpen) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    target += (e.deltaY * unit) / TRAVEL;
    interacted = true;
  }

  let touchY = null;
  function onTouchStart(e) { touchY = e.touches[0].clientY; }
  function onTouchMove(e) {
    if (panelOpen || touchY === null) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    target += ((touchY - y) * 2.4) / TRAVEL;
    touchY = y;
    interacted = true;
  }

  function onKey(e) {
    if (panelOpen) {
      if (e.key === "Escape") {
        const lb = document.getElementById("lightbox");
        if (lb && lb.classList.contains("is-open")) {
          lb.classList.remove("is-open");
          lb.setAttribute("aria-hidden", "true");
        } else {
          closePanels();
        }
      }
      return;
    }
    const step = 420 / TRAVEL;
    if (["ArrowDown", "PageDown", " "].includes(e.key)) { target += step; interacted = true; }
    if (["ArrowUp", "PageUp"].includes(e.key)) { target -= step; interacted = true; }
  }

  addEventListener("wheel", onWheel, { passive: false });
  addEventListener("touchstart", onTouchStart, { passive: true });
  addEventListener("touchmove", onTouchMove, { passive: false });
  addEventListener("keydown", onKey);

  /* ── canvas ─────────────────────────────────────────────────── */

  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;
  let needsPaint = true;   // force a repaint on the next tick
  let lastDrawnIdx = -1;   // sequence frame currently on the canvas

  function resize() {
    // mobile screens don't need retina-density canvas for a masked exhibit
    DPR = Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 2);
    const r = canvas.parentElement.getBoundingClientRect();
    W = Math.max(2, Math.round(r.width));
    H = Math.max(2, Math.round(r.height));
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    needsPaint = true;
    lastDrawnIdx = -1;
  }
  addEventListener("resize", () => { resize(); });
  resize();

  /* ── image sequence ─────────────────────────────────────────── */

  const SEQ = {
    count: 603,
    base: isMobile ? "assets/seq/sd/" : "assets/seq/hd/",
    coarseStride: 6,
  };
  const frames = new Array(SEQ.count).fill(null);
  let useSeq = true;      // flips off if the sequence turns out missing
  let coarseDone = false;

  const frameUrl = (i) => SEQ.base + "f_" + String(i + 1).padStart(4, "0") + ".webp";

  // load order: every 6th frame first (gates the preloader),
  // then every 3rd, then the rest — playback sharpens as they land
  const order = [];
  {
    const seen = new Set();
    for (const stride of [SEQ.coarseStride, 3, 1]) {
      for (let i = 0; i < SEQ.count; i += stride) {
        if (!seen.has(i)) { seen.add(i); order.push(i); }
      }
    }
  }
  const coarseTotal = Math.ceil(SEQ.count / SEQ.coarseStride);
  let coarseLoaded = 0;
  let coarseFailed = 0;

  function updateLoader() {
    const p = Math.min(1, coarseLoaded / coarseTotal);
    loaderFill.style.transform = `scaleX(${p})`;
    loaderPct.textContent = Math.round(p * 100) + "%";
  }

  function finishLoading() {
    if (coarseDone) return;
    coarseDone = true;
    if (coarseFailed >= coarseTotal) useSeq = false; // sequence absent → procedural fallback
    loader.classList.add("is-done");
    document.body.classList.add("is-ready");
    needsPaint = true;
  }

  function pump(queue) {
    const next = queue.shift();
    if (next === undefined) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      frames[next] = img;
      if (next % SEQ.coarseStride === 0) {
        coarseLoaded++;
        updateLoader();
        if (coarseLoaded + coarseFailed >= coarseTotal) finishLoading();
      }
      // repaint if the freshly landed frame is nearer to the timeline
      needsPaint = true;
      pump(queue);
    };
    img.onerror = () => {
      if (next % SEQ.coarseStride === 0) {
        coarseFailed++;
        if (coarseLoaded + coarseFailed >= coarseTotal) finishLoading();
      }
      pump(queue);
    };
    img.src = frameUrl(next);
  }

  function startLoading() {
    const queue = order.slice();
    const lanes = Math.min(isMobile ? 6 : 10, queue.length);
    for (let i = 0; i < lanes; i++) pump(queue);
    // safety valve: never trap the user on the loader
    setTimeout(finishLoading, 20000);
  }

  // nearest loaded frame to i, searching outward with wrap-around
  function nearestFrame(i) {
    if (frames[i]) return i;
    for (let d = 1; d <= SEQ.count >> 1; d++) {
      const a = (i + d) % SEQ.count;
      const b = (i - d + SEQ.count) % SEQ.count;
      if (frames[b]) return b;
      if (frames[a]) return a;
    }
    return -1;
  }

  function drawFrame(p) {
    const want = Math.min(SEQ.count - 1, Math.floor(p * SEQ.count));
    const idx = nearestFrame(want);
    if (idx === -1 || idx === lastDrawnIdx) return;
    const img = frames[idx];
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#f5ede4";
    ctx.fillRect(0, 0, W, H);
    // cover-fit, centre crop
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    lastDrawnIdx = idx;
  }

  /* ── procedural fallback: living architectural model ───────── */

  const PARTS = [
    { min: [-6.4, -0.5, -4.8], max: [6.4, 0.0, 4.8], col: [216, 207, 192], ex: [0, -3.4, 0] },
    { min: [-5.2, 0.0, -3.9], max: [5.2, 0.35, 3.9], col: [205, 195, 178], ex: [0, -1.6, 0] },
    { min: [-4.4, 0.35, -3.2], max: [2.2, 3.3, 3.2], col: [236, 229, 216], ex: [0, 0, 0] },
    { min: [2.2, 0.35, -2.6], max: [4.9, 2.9, 2.6], col: [196, 206, 201], ex: [3.2, 0.6, 0] },
    { min: [-4.4, 3.3, -2.6], max: [0.7, 5.9, 2.6], col: [229, 221, 206], ex: [0, 2.8, 0] },
    { min: [-4.95, 5.9, -3.15], max: [1.25, 6.34, 3.15], col: [56, 51, 44], ex: [0, 5.0, 0] },
    { min: [1.9, 2.9, -3.05], max: [5.35, 3.28, 3.05], col: [66, 60, 52], ex: [3.6, 2.6, 0] },
    { min: [-1.3, 5.9, -1.05], max: [0.15, 7.5, 0.35], col: [176, 143, 108], ex: [0, 6.4, 0] },
  ];

  function boxFaces(mn, mx) {
    const [a, b, c] = mn, [d, e, f] = mx;
    const P = {
      A: [a, b, c], B: [d, b, c], C: [d, b, f], D: [a, b, f],
      E: [a, e, c], F: [d, e, c], G: [d, e, f], H: [a, e, f],
    };
    return [
      { q: [P.A, P.B, P.C, P.D], n: [0, -1, 0] },
      { q: [P.E, P.H, P.G, P.F], n: [0, 1, 0] },
      { q: [P.A, P.E, P.F, P.B], n: [0, 0, -1] },
      { q: [P.D, P.C, P.G, P.H], n: [0, 0, 1] },
      { q: [P.A, P.D, P.H, P.E], n: [-1, 0, 0] },
      { q: [P.B, P.F, P.G, P.C], n: [1, 0, 0] },
    ];
  }
  const GEO = PARTS.map((p) => ({ ...p, faces: boxFaces(p.min, p.max) }));

  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function journey(p) {
    const fill = 1 - smooth(0.06, 0.24, p) + smooth(0.6, 0.86, p) * smooth(0.06, 0.24, p);
    const blueprint = smooth(0.05, 0.16, p) * (1 - smooth(0.3, 0.46, p));
    const explode = smooth(0.3, 0.52, p) * (1 - smooth(0.56, 0.8, p));
    return {
      fill: Math.min(1, Math.max(0, fill)),
      blueprint,
      explode: explode * explode * (3 - 2 * explode),
      grid: blueprint,
    };
  }

  const LIGHT = (() => {
    const l = [0.45, 0.85, 0.3], m = Math.hypot(...l);
    return l.map((v) => v / m);
  })();

  function render(p) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#f5ede4";
    ctx.fillRect(0, 0, W, H);

    const J = journey(p);
    const yaw = p * Math.PI * 2 + Math.PI * 0.22;
    const pitch = 0.44;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const DIST = 30;
    const F = Math.min(W, H) * 1.62;
    const CX = W / 2, CY = H * 0.56;

    const proj = (v) => {
      let [x, y, z] = v;
      const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const s = F / (z2 + DIST);
      return [CX + x1 * s, CY - (y2 - 3.1) * s, z2];
    };
    const rotN = (n) => {
      const x1 = n[0] * cy - n[2] * sy, z1 = n[0] * sy + n[2] * cy;
      return [x1, n[1], z1];
    };

    if (J.grid > 0.01) {
      ctx.strokeStyle = `rgba(72, 105, 153, ${0.28 * J.grid})`;
      ctx.lineWidth = 1;
      for (let i = -8; i <= 8; i++) {
        let a = proj([i, -0.5, -8]), b = proj([i, -0.5, 8]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        a = proj([-8, -0.5, i]); b = proj([8, -0.5, i]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }

    const draw = [];
    for (const part of GEO) {
      const off = part.ex.map((v) => v * J.explode);
      for (const f of part.faces) {
        const q = f.q.map((v) => proj([v[0] + off[0], v[1] + off[1], v[2] + off[2]]));
        const depth = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4;
        draw.push({ q, n: rotN(f.n), depth, col: part.col });
      }
    }
    draw.sort((a, b) => b.depth - a.depth);

    const inkStroke = [31, 27, 22];
    const blueStroke = [62, 96, 146];
    const sc = inkStroke.map((v, i) => v + (blueStroke[i] - v) * J.blueprint);
    const strokeA = 0.16 + 0.5 * (1 - J.fill);

    for (const f of draw) {
      const lum = 0.7 + 0.3 * Math.max(0, f.n[0] * LIGHT[0] + f.n[1] * LIGHT[1] + f.n[2] * LIGHT[2]);
      ctx.beginPath();
      ctx.moveTo(f.q[0][0], f.q[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(f.q[i][0], f.q[i][1]);
      ctx.closePath();
      if (J.fill > 0.01) {
        const mix = J.fill;
        const r = 245 + (f.col[0] * lum - 245) * mix;
        const g = 237 + (f.col[1] * lum - 237) * mix;
        const b = 228 + (f.col[2] * lum - 228) * mix;
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${sc[0] | 0},${sc[1] | 0},${sc[2] | 0},${strokeA})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /* ── scroll-driven copy · rail · phases ─────────────────────── */

  const STAGES = [0, 0.2, 0.4, 0.6, 0.8, 0.94];
  const STAGE_W = 0.085;

  function wrapDist(a, b) {
    let d = Math.abs(a - b) % 1;
    return Math.min(d, 1 - d);
  }

  function updateUI(p) {
    let active = 0, best = 1;
    copyItems.forEach((el, i) => {
      const d = wrapDist(p, STAGES[i]);
      el.style.opacity = Math.max(0, 1 - d / STAGE_W).toFixed(3);
      if (d < best) { best = d; active = i; }
    });
    phaseDots.forEach((el, i) => el.classList.toggle("is-active", i === active));
    railFill.style.transform = `scaleY(${p})`;
    railPct.textContent = String(Math.round(p * 100)).padStart(2, "0");
    if (interacted) scrollHint.classList.add("is-hidden");
  }

  /* ── main loop ──────────────────────────────────────────────── */

  let lastP = -1;
  function tick() {
    const ease = reduceMotion ? 1 : 0.075;
    current += (target - current) * ease;
    if (Math.abs(target - current) < 0.00004) current = target;

    if (current > 2 && target > 2) { current -= 2; target -= 2; }
    if (current < -2 && target < -2) { current += 2; target += 2; }

    const p = wrap(current);
    if (Math.abs(p - lastP) > 0.00002 || needsPaint) {
      needsPaint = false;
      if (useSeq) drawFrame(p);
      else render(p);
      updateUI(p);
      lastP = p;
    }
    requestAnimationFrame(tick);
  }

  /* ── panels ─────────────────────────────────────────────────── */

  const panelsRoot = $("#panels");
  const panels = $$(".panel");
  let activePanel = null;

  function openPanel(id) {
    const next = panels.find((el) => el.dataset.panelId === id);
    if (!next) return;
    panelOpen = true;
    panelsRoot.classList.add("is-open");
    if (activePanel && activePanel !== next) {
      activePanel.classList.remove("is-visible", "is-active");
    }
    activePanel = next;
    next.classList.add("is-active");
    next.scrollTop = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add("is-visible")));
  }

  function closePanels() {
    if (!activePanel) return;
    const el = activePanel;
    el.classList.remove("is-visible");
    setTimeout(() => {
      el.classList.remove("is-active");
      panelsRoot.classList.remove("is-open");
    }, 600);
    activePanel = null;
    panelOpen = false;
  }

  $$("[data-panel]").forEach((btn) =>
    btn.addEventListener("click", () => openPanel(btn.dataset.panel))
  );
  $("[data-menu]").addEventListener("click", () => openPanel("nav"));
  $("#panelClose").addEventListener("click", closePanels);

  // logo → close everything and glide the timeline home
  $("[data-home]").addEventListener("click", (e) => {
    e.preventDefault();
    closeLightbox();
    closePanels();
    goTo(0);
  });

  // stage numbers → jump the timeline to that chapter
  phaseDots.forEach((btn) =>
    btn.addEventListener("click", () => goTo(STAGES[+btn.dataset.stage]))
  );

  /* ── gallery + lightbox ─────────────────────────────────────── */

  const GALLERY_COUNT = 28;
  const galleryEl = $("#gallery");
  const lightbox = $("#lightbox");
  const lightboxImg = $("#lightboxImg");
  const lightboxCounter = $("#lightboxCounter");
  let lightboxIndex = 0;

  const gallerySrc = (i) => "assets/portfolio/p" + String(i).padStart(2, "0") + ".webp";

  // staggered scroll-in reveal
  const revealer = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        el.style.transitionDelay = (el.dataset.lane * 70) + "ms";
        el.classList.add("is-in");
        revealer.unobserve(el);
      });
    },
    { threshold: 0.12 }
  );

  for (let i = 1; i <= GALLERY_COUNT; i++) {
    const fig = document.createElement("figure");
    fig.className = "gallery__item";
    fig.dataset.lane = (i - 1) % 4;
    const img = document.createElement("img");
    img.src = gallerySrc(i);
    img.alt = "Dokumentasi proyek TIGA Kontraktor — " + i;
    img.loading = "lazy";
    img.decoding = "async";
    const num = document.createElement("span");
    num.className = "gallery__num";
    num.textContent = String(i).padStart(2, "0") + " / " + GALLERY_COUNT;
    fig.append(img, num);
    fig.addEventListener("click", () => openLightbox(i));
    galleryEl.appendChild(fig);
    revealer.observe(fig);
  }

  function showLightbox(i) {
    lightboxIndex = ((i - 1 + GALLERY_COUNT) % GALLERY_COUNT) + 1;
    lightboxImg.src = gallerySrc(lightboxIndex);
    lightboxCounter.textContent =
      String(lightboxIndex).padStart(2, "0") + " — " + GALLERY_COUNT;
  }
  function openLightbox(i) {
    showLightbox(i);
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
  }
  function closeLightbox() {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
  }

  lightbox.addEventListener("click", closeLightbox);
  $("#lightboxPrev").addEventListener("click", (e) => { e.stopPropagation(); showLightbox(lightboxIndex - 1); });
  $("#lightboxNext").addEventListener("click", (e) => { e.stopPropagation(); showLightbox(lightboxIndex + 1); });
  addEventListener("keydown", (e) => {
    if (!lightbox.classList.contains("is-open")) return;
    if (e.key === "ArrowLeft") showLightbox(lightboxIndex - 1);
    if (e.key === "ArrowRight") showLightbox(lightboxIndex + 1);
  });

  /* ── go ─────────────────────────────────────────────────────── */

  render(0); // procedural frame behind the loader until images land
  updateUI(0);
  startLoading();
  requestAnimationFrame(tick);

  // debug hook (harmless in production; handy for QA)
  window.__tiga = {
    render, updateUI, journey, drawFrame,
    setProgress: (p) => { target = current = p; },
    state: () => ({ useSeq, coarseDone, loaded: frames.filter(Boolean).length, count: SEQ.count, isMobile, targetP: wrap(target) }),
  };
})();
