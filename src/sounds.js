// Tiny Web Audio sound module — no assets, synthesized on the fly.
// All sounds gated by localStorage "mtt-sound-enabled" (default on).

let ctx = null;
function getCtx() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  } catch { ctx = null; }
  return ctx;
}

export function soundEnabled() {
  const v = localStorage.getItem("mtt-sound-enabled");
  return v === null ? true : v === "1";
}

export function setSoundEnabled(on) {
  localStorage.setItem("mtt-sound-enabled", on ? "1" : "0");
}

function tone(freq, duration = 0.08, type = "sine", gain = 0.08, delay = 0) {
  if (!soundEnabled()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const sfx = {
  click: () => tone(660, 0.05, "sine", 0.05),
  place: () => tone(820, 0.07, "triangle", 0.06),
  score: () => {
    tone(523, 0.12, "sine", 0.07, 0);
    tone(659, 0.12, "sine", 0.07, 0.08);
    tone(784, 0.18, "sine", 0.07, 0.16);
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, "triangle", 0.08, i * 0.1));
  },
  power: () => tone(440, 0.12, "sawtooth", 0.05),
  error: () => tone(180, 0.1, "square", 0.05),
};

// Haptic feedback helpers — gated by "mtt-haptic-enabled" (default on).
export function hapticEnabled() {
  const v = localStorage.getItem("mtt-haptic-enabled");
  return v === null ? true : v === "1";
}
export function setHapticEnabled(on) {
  localStorage.setItem("mtt-haptic-enabled", on ? "1" : "0");
}
export function vibe(pattern) {
  if (!hapticEnabled()) return;
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch {}
  }
}
export const haptic = {
  tap: () => vibe(5),
  place: () => vibe(10),
  score: () => vibe([20, 40, 20]),
  win: () => vibe([50, 30, 50, 30, 100]),
  error: () => vibe([30, 50, 30]),
};
