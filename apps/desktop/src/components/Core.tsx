import { useEffect, useRef } from 'react';

/**
 * The JARVIS Core: a particle torus drawn on canvas. Input wires run from the
 * labelled sources on the left into the ring. Microphone level makes the
 * particles shimmer; waking makes the ring contract and flare.
 */

export type WireState = 'live' | 'idle' | 'missing';

export interface CoreInput {
  id: string;
  label: string;
  detail: string;
  state: WireState;
  color: string;
}

interface CoreProps {
  inputs: CoreInput[];
  level: number;
  mode: 'idle' | 'listening' | 'awake';
  /** Increment to fire the wake flare. */
  pulseKey: number;
  compact?: boolean;
  showInputs?: boolean;
  label: string;
}

interface Particle {
  u: number;
  v: number;
  r: number;
  phase: number;
  tint: number; // index into inputs, -1 = core colour
  spike: number; // 0 for ring points, >0 for radial streaks
}

const TAU = Math.PI * 2;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeParticles(inputCount: number): Particle[] {
  const out: Particle[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rings = 64;
  const perRing = 30;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < perRing; j++) {
      out.push({
        u: (i / rings) * TAU + rand() * 0.04,
        v: (j / perRing) * TAU + rand() * 0.05,
        r: 1,
        phase: rand() * TAU,
        tint: -1,
        spike: 0,
      });
    }
  }
  // Streak clusters where each input meets the ring (left half of the torus).
  for (let k = 0; k < inputCount; k++) {
    const centreU = Math.PI * (0.62 + (0.76 * (k + 0.5)) / inputCount);
    for (let s = 0; s < 46; s++) {
      out.push({
        u: centreU + (rand() - 0.5) * 0.32,
        v: rand() * TAU,
        r: 1,
        phase: rand() * TAU,
        tint: k,
        spike: 0.15 + rand() * 0.55,
      });
    }
  }
  return out;
}

export function Core({ inputs, level, mode, pulseKey, compact = false, showInputs = true, label }: CoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const live = useRef({ level, mode, inputs, pulseAt: -1e9 });

  live.current.level = level;
  live.current.mode = mode;
  live.current.inputs = inputs;

  useEffect(() => {
    if (pulseKey > 0) live.current.pulseAt = performance.now();
  }, [pulseKey]);

  const inputCount = inputs.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const particles = makeParticles(inputCount);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let angle = 0.6;
    let last = performance.now();
    let smoothLevel = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const state = live.current;
      smoothLevel += (state.level - smoothLevel) * 0.2;
      const awake = state.mode === 'awake';
      const speed = reduced ? 0 : awake ? 0.5 : state.mode === 'listening' ? 0.2 : 0.11;
      angle += dt * speed;

      // Wake flare: quick contraction, then an overshooting bloom.
      const since = (now - state.pulseAt) / 1000;
      let flare = 0;
      if (since >= 0 && since < 1.6) {
        flare = since < 0.18 ? -since / 0.18 * 0.12 : 0.24 * Math.exp(-(since - 0.18) * 3) * Math.cos((since - 0.18) * 5);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const wires = showInputs && width >= 520; // narrow screens: ring only
      const wireSpace = wires ? Math.min(240, width * 0.3) : 0;
      const cx = wireSpace + (width - wireSpace) * 0.5;
      const cy = height * 0.5;
      const scale = Math.min((width - wireSpace) * 0.3, height * 0.6) * (1 + flare);
      const tilt = 1.08; // radians from top-down
      const cosT = Math.cos(tilt);
      const sinT = Math.sin(tilt);
      const R = 1;
      const rTube = 0.36;
      const wobble = smoothLevel * 0.22 + (awake ? 0.04 : 0);
      const colors = state.inputs.map((i) => hexToRgb(i.color));
      const base = awake ? [140, 220, 255] : [63, 184, 255];

      // Input wires first so particles sit on top.
      if (wires) {
        state.inputs.forEach((input, k) => {
          const y0 = height * ((k + 1) / (state.inputs.length + 1));
          const x0 = Math.min(150, wireSpace * 0.62);
          const u = Math.PI * (0.62 + (0.76 * (k + 0.5)) / state.inputs.length);
          const cu = Math.cos(u + angle);
          const su = Math.sin(u + angle);
          const px = R * cu;
          const pz = R * su;
          // Attach to the ring's centre line, slightly inside so the streaks cover the join.
          const persp = 3.4 / (3.4 + pz * sinT);
          const x1 = cx + px * scale * persp * 0.9;
          const y1 = cy + pz * cosT * scale * persp * 0.9;
          const [r, g, b] = colors[k];
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.bezierCurveTo(x0 + (x1 - x0) * 0.55, y0, x0 + (x1 - x0) * 0.45, y1, x1, y1);
          if (input.state === 'live') {
            ctx.setLineDash([]);
            ctx.strokeStyle = `rgba(${r},${g},${b},${0.55 + smoothLevel * 0.4})`;
            ctx.lineWidth = 1.25;
          } else if (input.state === 'idle') {
            ctx.setLineDash([]);
            ctx.strokeStyle = `rgba(${r},${g},${b},0.32)`;
            ctx.lineWidth = 1;
          } else {
            ctx.setLineDash([2, 5]);
            ctx.strokeStyle = 'rgba(111,137,166,0.35)';
            ctx.lineWidth = 1;
          }
          ctx.stroke();
          ctx.setLineDash([]);
          if (input.state === 'live' && !reduced) {
            // Travelling pulse along the live wire.
            const t = ((now / 1400 + k * 0.27) % 1) ** 1.2;
            const bx = (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * (x0 + (x1 - x0) * 0.55) + 3 * (1 - t) * t * t * (x0 + (x1 - x0) * 0.45) + t ** 3 * x1;
            const by = (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * y0 + 3 * (1 - t) * t * t * y1 + t ** 3 * y1;
            ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
            ctx.beginPath();
            ctx.arc(bx, by, 2.2, 0, TAU);
            ctx.fill();
          }
          ctx.fillStyle = input.state === 'missing' ? 'rgba(111,137,166,0.6)' : `rgb(${r},${g},${b})`;
          ctx.fillRect(x0 - 3, y0 - 3, 6, 6);
        });
      }

      ctx.globalCompositeOperation = 'lighter';
      const t = now / 1000;
      for (const p of particles) {
        const tintIndex = p.tint;
        const tintInput = tintIndex >= 0 ? state.inputs[tintIndex] : null;
        if (p.spike > 0 && (!tintInput || tintInput.state === 'missing')) continue;
        const jitter = reduced ? 0 : Math.sin(t * 3 + p.phase) * wobble;
        const tube = rTube * (1 + jitter + p.spike * (tintInput?.state === 'live' ? 1 + smoothLevel : 0.5));
        const u = p.u + angle;
        const ringR = R + tube * Math.cos(p.v);
        const x = ringR * Math.cos(u);
        const z = ringR * Math.sin(u);
        const y = tube * Math.sin(p.v);
        // tilt around X axis
        const yy = y * sinT + z * cosT;
        const zz = -y * cosT + z * sinT;
        const persp = 3.4 / (3.4 + zz);
        const sx = cx + x * scale * persp;
        const sy = cy + yy * scale * persp;
        const depth = (1 - zz) / 2; // 0 far .. 1 near
        let [r, g, b] = base;
        if (tintIndex >= 0) [r, g, b] = colors[tintIndex];
        const alpha = Math.max(0.05, Math.min(1, 0.18 + depth * 0.55 + smoothLevel * 0.35 + (awake ? 0.15 : 0)));
        const size = (compact ? 1.1 : 1.35) * persp * (p.spike > 0 ? 0.9 : 1);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }
      ctx.globalCompositeOperation = 'source-over';

      if (!reduced && document.visibilityState === 'visible') raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      if (document.visibilityState === 'visible') raf = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Reduced motion: redraw on resize only.
    const redraw = reduced ? window.setInterval(() => requestAnimationFrame(draw), 500) : 0;
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (redraw) window.clearInterval(redraw);
    };
  }, [inputCount, compact, showInputs]);

  return (
    <div ref={wrapRef} className={`core ${compact ? 'is-compact' : ''}`}>
      <canvas ref={canvasRef} role="img" aria-label={label} />
      {showInputs && (
        <ul className="core-inputs" aria-label="What JARVIS is connected to">
          {inputs.map((input, k) => (
            <li
              key={input.id}
              className={`core-input is-${input.state}`}
              style={{ top: `${((k + 1) / (inputs.length + 1)) * 100}%`, ['--wire' as string]: input.color }}
            >
              <span className="core-input-label">{input.label}</span>
              <span className="core-input-detail">{input.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
