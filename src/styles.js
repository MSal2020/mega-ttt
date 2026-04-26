// Global CSS string injected via <style> in the root component.
// Keeps animations and shared utility classes in one place.
export const css = `
  @keyframes popIn { 0% { transform: scale(0); } 100% { transform: scale(1); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(-8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  @keyframes fadeOut { from { opacity: 1; transform: translateX(-50%) translateY(0); } to { opacity: 0; transform: translateX(-50%) translateY(-8px); } }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(26,23,20,0.22); } 50% { box-shadow: 0 0 0 6px rgba(26,23,20,0); } }
  @keyframes glassFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes glassPop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
  .g-pop { animation: glassPop 420ms cubic-bezier(0.34,1.56,0.64,1); }
  .g-float { animation: glassFloat 4.6s ease-in-out infinite; }
  .glass-bg { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
    background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 100%); }
  .glass-bg::before, .glass-bg::after { content: ''; position: absolute; border-radius: 50%;
    filter: blur(40px); pointer-events: none; will-change: transform; }
  .glass-bg::before { top: -8%; right: -18%; width: 70%; height: 60%;
    background: radial-gradient(closest-side, var(--bgBlob) 0%, transparent 70%); opacity: 0.8;
    animation: blobDrift1 28s ease-in-out infinite; }
  .glass-bg::after { bottom: -12%; left: -20%; width: 80%; height: 55%;
    background: radial-gradient(closest-side, var(--bgBlob2) 0%, transparent 72%); opacity: 0.66;
    animation: blobDrift2 35s ease-in-out infinite; }
  @keyframes blobDrift1 { 0%, 100% { transform: translate(0, 0) scale(1); } 25% { transform: translate(22px, -28px) scale(1.04); } 50% { transform: translate(-12px, 18px) scale(0.97); } 75% { transform: translate(18px, 14px) scale(1.02); } }
  @keyframes blobDrift2 { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(-24px, 22px) scale(0.96); } 66% { transform: translate(20px, -18px) scale(1.03); } }
  .glass-card-glow { position: relative; }
  .glass-card-glow::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    background: radial-gradient(at top, var(--cardGlow), transparent 50%); z-index: 1; }
  .glass-card { background: var(--glassFill); backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%); border: 0.5px solid var(--glassBorder);
    box-shadow: var(--glassShadow); border-radius: 18px; }
  @keyframes scoreGlow { 0% { box-shadow: 0 0 0 0 currentColor; opacity: 1; } 40% { box-shadow: 0 0 8px 4px currentColor; opacity: 0.8; } 100% { box-shadow: none; opacity: 0.35; } }
  @keyframes wallDrop { 0% { transform: scale(0) rotate(-45deg); opacity: 0; } 100% { transform: scale(1) rotate(0); opacity: 0.35; } }
  @keyframes ghostFade { 0% { opacity: 0; transform: scale(1.3); } 100% { opacity: 0.5; transform: scale(1); } }
  @keyframes stealFlash { 0% { background: rgba(242,92,84,0.3); } 100% { background: transparent; } }
  @keyframes revealPop { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.2); } 100% { transform: scale(1); opacity: 1; } }
  @keyframes winPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
  @keyframes timerShrink { from { width: 100%; } to { width: 0%; } }
  @keyframes timerShake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-3px); } 40% { transform: translateX(3px); } 60% { transform: translateX(-2px); } 80% { transform: translateX(2px); } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes scoreBump { 0% { transform: scale(1); } 40% { transform: scale(1.3); } 100% { transform: scale(1); } }
  @keyframes slotPulse { 0%,100% { opacity: 0.55; } 50% { opacity: 0.95; } }
  @keyframes slotFillIn { 0% { opacity: 0; transform: scale(0.92); } 100% { opacity: 1; transform: scale(1); } }
  @keyframes boardIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  @keyframes bannerIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes miniIn { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
  * { box-sizing: border-box; margin: 0; touch-action: manipulation; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; overscroll-behavior: none; background: var(--bg); color: var(--text); transition: background 0.3s, color 0.3s; }
  input[type=range] { accent-color: #1A1714; }
  .zoom-slider { -webkit-appearance: none; appearance: none; background: transparent; width: 100%; height: 28px;
    cursor: pointer; touch-action: pan-y pinch-zoom; }
  .zoom-slider:focus { outline: none; }
  .zoom-slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px;
    background: var(--zoomTrack, rgba(26,23,20,0.12)); }
  .zoom-slider::-moz-range-track { height: 4px; border-radius: 2px;
    background: var(--zoomTrack, rgba(26,23,20,0.12)); }
  .zoom-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
    width: 22px; height: 22px; border-radius: 50%; margin-top: -9px;
    background: var(--zoomThumb, #1A1714); border: 2px solid var(--zoomThumbRing, #FBF8F1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.1);
    cursor: grab; transition: transform 0.12s ease-out; }
  .zoom-slider::-webkit-slider-thumb:active { transform: scale(1.18); cursor: grabbing; }
  .zoom-slider::-moz-range-thumb {
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--zoomThumb, #1A1714); border: 2px solid var(--zoomThumbRing, #FBF8F1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.18); cursor: grab; transition: transform 0.12s ease-out; }
  .zoom-slider::-moz-range-thumb:active { transform: scale(1.18); cursor: grabbing; }
  .zoom-step { display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 10px; font-size: 14px; cursor: pointer;
    color: var(--zoomStep, rgba(26,23,20,0.55)); background: transparent; border: none;
    flex-shrink: 0; user-select: none; -webkit-tap-highlight-color: transparent;
    transition: background 0.15s, color 0.15s; }
  .zoom-step:hover { background: rgba(26,23,20,0.06); color: var(--zoomStepActive, #1A1714); }
  .zoom-step:active { transform: scale(0.9); }
  .zoom-step:disabled { opacity: 0.3; cursor: default; }
  .cell:hover .cell-hover { background: rgba(26,23,20,0.05); }
  .cell:hover .hover-dot { opacity: 0.26; transform: scale(1); }
  .btn-hover { transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.12s, opacity 0.12s; }
  .btn-hover:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .btn-hover:active { transform: translateY(0) scale(0.93); box-shadow: none; transition: transform 0.08s ease-out, box-shadow 0.08s; }
  @keyframes confettiFall { 0% { transform: translate(0,0) rotate(0); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; } }
  @keyframes bannerSlide { 0% { opacity: 0; transform: translateY(-18px) scale(0.95); } 60% { transform: translateY(2px) scale(1.02); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes modalCardIn { from { opacity: 0; transform: translateY(12px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes bannerShine { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
  @keyframes skeletonShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
  @keyframes turnPulse { 0% { opacity: 0.75; } 100% { opacity: 1; } }
  @keyframes turnGlow { 0% { opacity: 0; } 35% { opacity: 0.55; } 100% { opacity: 0; } }
  select { color-scheme: light dark; }
`;
