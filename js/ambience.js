/* ═══════════════════════════════════════════════════════════════
   TIGA Kontraktor — generative ambience
   Synthesised entirely in the browser with Web Audio:
   · air bed   — looped filtered noise, slowly breathing
   · tone pad  — sparse pentatonic notes with a soft echo
   No audio files, no licensing, ~0 bytes of network.
   Starts only from a user gesture (autoplay policy) via the toggle.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  const btn = document.getElementById("soundToggle");
  if (!btn) return;

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { btn.style.display = "none"; return; }

  let ctx = null;
  let master = null;
  let bus = null;
  let running = false;
  const timers = new Set();

  const rand = (a, b) => a + Math.random() * (b - a);
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (running) fn(); }, ms);
    timers.add(id);
  };

  function build() {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // everything plays into `bus`; a feedback delay adds gentle space
    bus = ctx.createGain();
    bus.connect(master);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    bus.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(master);

    buildAirBed();
  }

  /* ── air bed: looped noise through a breathing lowpass ─────── */
  function buildAirBed() {
    const len = 4 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // cheap pink-ish noise: one-pole lowpassed white
      last = last * 0.96 + (Math.random() * 2 - 1) * 0.04;
      d[i] = last * 6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    lp.Q.value = 0.4;

    const g = ctx.createGain();
    g.gain.value = 0.05;

    // slow breathing on the filter
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 160;
    lfo.connect(lfoAmt);
    lfoAmt.connect(lp.frequency);

    src.connect(lp);
    lp.connect(g);
    g.connect(bus);
    src.start();
    lfo.start();
  }

  /* ── tone pad: sparse warm notes, pentatonic, long envelopes ── */
  const SCALE = [220.0, 246.94, 277.18, 329.63, 369.99, 440.0]; // A pentatonic
  function padNote() {
    const t = ctx.currentTime + 0.05;
    const f = SCALE[Math.floor(Math.random() * SCALE.length)] / (Math.random() < 0.4 ? 2 : 1);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = f;
    const det = ctx.createOscillator();
    det.type = "sine";
    det.frequency.value = f * 1.003;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 850;

    const g = ctx.createGain();
    const peak = rand(0.025, 0.045);
    const attack = rand(2.2, 3.6);
    const release = rand(3.5, 6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);

    osc.connect(lp);
    det.connect(lp);
    lp.connect(g);
    g.connect(bus);
    osc.start(t);
    det.start(t);
    osc.stop(t + attack + release + 0.1);
    det.stop(t + attack + release + 0.1);
    later(padNote, rand(7000, 16000));
  }

  /* ── transport ─────────────────────────────────────────────── */

  function start() {
    if (!ctx) build();
    ctx.resume();
    running = true;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.8);
    later(padNote, 1500);
    btn.classList.add("is-on");
    btn.setAttribute("aria-pressed", "true");
    try { localStorage.setItem("tiga-sound", "1"); } catch (e) {}
  }

  function stop() {
    running = false;
    timers.forEach(clearTimeout);
    timers.clear();
    if (ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(() => { if (!running && ctx) ctx.suspend(); }, 2200);
    }
    btn.classList.remove("is-on");
    btn.setAttribute("aria-pressed", "false");
    try { localStorage.setItem("tiga-sound", "0"); } catch (e) {}
  }

  btn.addEventListener("click", () => (running ? stop() : start()));

  // returning visitor who left the sound on: arm it for the first gesture
  let wanted = false;
  try { wanted = localStorage.getItem("tiga-sound") === "1"; } catch (e) {}
  if (wanted) {
    const arm = () => { if (!running) start(); };
    addEventListener("pointerdown", arm, { once: true });
    addEventListener("keydown", arm, { once: true });
    addEventListener("wheel", arm, { once: true });
  }

  // debug hook
  window.__ambience = {
    start, stop,
    isRunning: () => running,
    ctxState: () => (ctx ? ctx.state : "none"),
    tap: () => { const a = ctx.createAnalyser(); a.fftSize = 2048; master.connect(a); return a; },
  };
})();
