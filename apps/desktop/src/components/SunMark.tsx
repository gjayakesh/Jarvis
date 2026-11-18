/**
 * The small JARVIS sun for the top bar: drawn in SVG and moved by CSS, so it
 * costs almost nothing on every screen. It burns brighter while the
 * microphone is live and pauses with every other animation when JARVIS is hidden.
 */
export function SunMark({ live }: { live: boolean }) {
  return (
    <svg className={`sun-mark ${live ? 'is-live' : ''}`} width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true">
      <defs>
        <radialGradient id="sun-mark-core">
          <stop offset="0" stopColor="#fff6dc" />
          <stop offset="0.45" stopColor="#ffc54a" />
          <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="sun-mark-glow" r="13.5" fill="url(#sun-mark-core)" />
      <g className="sun-mark-shell">
        <circle r="9.6" fill="none" stroke="#f5b53d" strokeWidth="1" strokeDasharray="5 2.4 1.5 3" />
      </g>
      <g className="sun-mark-shell is-back">
        <ellipse rx="9.6" ry="4.2" fill="none" stroke="#ff9a2e" strokeWidth="0.8" strokeDasharray="3 2.6" />
      </g>
      <circle r="4.6" fill="url(#sun-mark-core)" />
      <circle r="2" fill="#fff3d0" />
    </svg>
  );
}
