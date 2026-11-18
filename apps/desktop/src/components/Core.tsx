import { useEffect, useRef } from 'react';
import { isWindowShown, onWindowShownChange } from '../state/platform';
import { count } from '../state/perf';

/**
 * The JARVIS Core: a flaming gold sun drawn on canvas. A molten centre with
 * swirling filaments, a broken shell of glowing arcs, a corona of flame
 * tongues and drifting embers. Station lines run in from the labelled inputs
 * on the left. The microphone level feeds the flames; waking makes the sun
 * contract, then flare.
 */

export type WireState = 'live' | 'idle' | 'missing';

export interface CoreInput {
  id: string;
  label: string;
  detail: string;
  state: WireState;
}

interface CoreProps {
  inputs: CoreInput[];
  level: number;
  mode: 'idle' | 'listening' | 'awake';
  /** Increment to fire the wake flare. */
  pulseKey: number;
  showInputs?: boolean;
  label: string;
}

const TAU = Math.PI * 2;

interface Ring {
  /** Orientation of the ring's plane. */
  tiltX: number;
  tiltZ: number;
  speed: number;
  radius: number;
  /** Which of the ring's segments are lit (the shell is broken, not whole). */
  lit: boolean[];
  width: number;
}

interface Ember {
  angle: number;
  dist: number;
  speed: number;
  life: number;
  max: number;
  size: number;
}

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const SEGMENTS = 72;

function makeRings(): Ring[] {
  const rand = seeded(11);
  return Array.from({ length: 11 }, (_, i) => {
    const lit: boolean[] = [];
    let on = rand() > 0.4;
    for (let j = 0; j < SEGMENTS; j++) {
      // Runs of lit and dark segments, like fragments of a shell.
      if (rand() < 0.16) on = !on;
      lit.push(on);
    }
    return {
      tiltX: (rand() - 0.5) * Math.PI,
      tiltZ: rand() * Math.PI,
      speed: (0.05 + rand() * 0.12) * (i % 2 ? 1 : -1),
      // Shells inside the sphere as well as around it: the reference is a sphere of fragments.
      radius: i < 4 ? 0.5 + rand() * 0.35 : 0.9 + rand() * 0.38,
      lit,
      width: 0.8 + rand() * 1.4,
    };
  });
}

/** Cheap smooth noise around the rim: a few sine octaves. */
const rimNoise = (a: number, t: number) =>
  0.5 + 0.28 * Math.sin(a * 3 + t * 1.1) + 0.14 * Math.sin(a * 7 - t * 1.9) + 0.08 * Math.sin(a * 13 + t * 3.3);

function makeGlow(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 196, 77, 0.55)');
  grad.addColorStop(0.35, 'rgba(255, 150, 30, 0.22)');
  grad.addColorStop(0.7, 'rgba(255, 110, 10, 0.06)');
  grad.addColorStop(1, 'rgba(255, 100, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return c;
}

export function Core({ inputs, level, mode, pulseKey, showInputs = true, label }: CoreProps) {
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
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rings = makeRings();
    const glow = makeGlow();
    const rand = seeded(29);
    // Each flame tongue has its own size and phase, so the corona is ragged, not a comb.
    const tongueSeed = Array.from({ length: 120 }, () => ({ size: rand(), phase: rand() * TAU, lift: rand() }));
    const embers: Ember[] = Array.from({ length: 64 }, () => ({ angle: 0, dist: 0, speed: 0, life: 0, max: 0, size: 1 }));
    const spawn = (e: Ember, initial: boolean) => {
      e.angle = rand() * TAU;
      e.dist = 1 + rand() * 0.1;
      e.speed = 0.05 + rand() * 0.16;
      e.max = 1.5 + rand() * 2.5;
      e.life = initial ? rand() * e.max : 0;
      e.size = 0.8 + rand() * 1.6;
    };
    embers.forEach((e) => spawn(e, true));

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let last = performance.now();
    let smoothLevel = 0;
    let spin = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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

    let lastDrawn = 0;
    const draw = (now: number) => {
      // 30 frames a second is plenty and halves the cost on an 8 GB laptop.
      if (!reduced && now - lastDrawn < 32) {
        if (isWindowShown()) raf = requestAnimationFrame(draw);
        return;
      }
      lastDrawn = now;
      const started = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const state = live.current;
      smoothLevel += (state.level - smoothLevel) * 0.25;
      const awake = state.mode === 'awake';
      const heat = (awake ? 0.35 : state.mode === 'listening' ? 0.12 : 0) + smoothLevel * 0.9;
      const t = reduced ? 0 : now / 1000;
      spin += dt * (reduced ? 0 : awake ? 0.55 : 0.22);

      // Wake flare: quick contraction, then an overshooting bloom.
      const since = (now - state.pulseAt) / 1000;
      let flare = 0;
      if (since >= 0 && since < 1.8) {
        flare = since < 0.16 ? (-since / 0.16) * 0.14 : 0.3 * Math.exp(-(since - 0.16) * 2.6) * Math.cos((since - 0.16) * 4.2);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const wires = showInputs && width >= 520; // narrow screens: sun only
      const wireSpace = wires ? Math.min(240, width * 0.3) : 0;
      const cx = wireSpace + (width - wireSpace) * 0.5;
      const cy = height * 0.5;
      const R = Math.min((width - wireSpace) * 0.22, height * 0.3) * (1 + flare);

      // Station lines first so the sun's light sits over their ends.
      if (wires) {
        state.inputs.forEach((input, k) => {
          const y0 = height * ((k + 1) / (state.inputs.length + 1));
          const x0 = Math.min(150, wireSpace * 0.62);
          const ang = Math.PI * (0.72 + (0.56 * (k + 0.5)) / state.inputs.length);
          const x1 = cx + Math.cos(ang) * R * 1.08;
          const y1 = cy + Math.sin(ang) * R * 1.08;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + 18, y0);
          ctx.bezierCurveTo(x0 + (x1 - x0) * 0.55, y0, x0 + (x1 - x0) * 0.5, y1, x1, y1);
          if (input.state === 'live') {
            ctx.strokeStyle = `rgba(255, 190, 70, ${0.6 + smoothLevel * 0.4})`;
            ctx.lineWidth = 1.25;
          } else if (input.state === 'idle') {
            ctx.strokeStyle = 'rgba(236, 233, 226, 0.34)';
            ctx.lineWidth = 1;
          } else {
            ctx.setLineDash([2, 5]);
            ctx.strokeStyle = 'rgba(236, 233, 226, 0.2)';
            ctx.lineWidth = 1;
          }
          ctx.stroke();
          ctx.setLineDash([]);
          if (input.state === 'live' && !reduced) {
            const p = (now / 1500 + k * 0.27) % 1;
            const q = 1 - p;
            const bx = q ** 3 * (x0 + 18) + 3 * q * q * p * (x0 + (x1 - x0) * 0.55) + 3 * q * p * p * (x0 + (x1 - x0) * 0.5) + p ** 3 * x1;
            const by = q ** 3 * y0 + 3 * q * q * p * y0 + 3 * q * p * p * y1 + p ** 3 * y1;
            ctx.fillStyle = 'rgba(255, 214, 120, 0.95)';
            ctx.fillRect(bx - 1.5, by - 1.5, 3, 3);
          }
          ctx.fillStyle = input.state === 'live' ? '#ffbe46' : input.state === 'idle' ? 'rgba(236,233,226,0.7)' : 'rgba(236,233,226,0.3)';
          ctx.fillRect(x0 - 3, y0 - 3, 6, 6);
        });
      }

      ctx.globalCompositeOperation = 'lighter';

      // Halo.
      const halo = R * (3.1 + heat * 0.8 + Math.max(0, flare) * 3);
      ctx.globalAlpha = 0.75 + heat * 0.25;
      ctx.drawImage(glow, cx - halo / 2, cy - halo / 2, halo, halo);
      ctx.globalAlpha = 1;

      // Broken shell of arcs: rings on tilted planes, front brighter than back.
      for (const ring of rings) {
        const rot = spin * ring.speed * 4 + ring.tiltZ;
        const cosX = Math.cos(ring.tiltX);
        const sinX = Math.sin(ring.tiltX);
        const cosZ = Math.cos(rot);
        const sinZ = Math.sin(rot);
        const rr = R * ring.radius * (1 + heat * 0.06);
        let prev: [number, number, number] | null = null;
        for (let j = 0; j <= SEGMENTS; j++) {
          const a = (j / SEGMENTS) * TAU;
          // Circle in its plane, tilted about X, spun about Z.
          const x = Math.cos(a);
          const y0 = Math.sin(a) * cosX;
          const z = Math.sin(a) * sinX;
          const px = x * cosZ - y0 * sinZ;
          const py = x * sinZ + y0 * cosZ;
          const pt: [number, number, number] = [cx + px * rr, cy + py * rr * 0.96, z];
          if (prev && ring.lit[j % SEGMENTS]) {
            const depth = (z + prev[2]) / 2; // -1 back .. 1 front
            const flick = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 9 + j * 1.7 + ring.radius * 10);
            const alpha = (0.16 + 0.5 * (depth + 1) * 0.5 + heat * 0.25) * flick;
            ctx.strokeStyle = `rgba(255, ${150 + Math.round(60 * (depth + 1) * 0.5)}, 40, ${alpha})`;
            ctx.lineWidth = ring.width * (0.7 + (depth + 1) * 0.35);
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(pt[0], pt[1]);
            ctx.stroke();
          }
          prev = pt;
        }
      }

      // Corona: flame tongues licking off the rim, longer when the owner speaks.
      const tongues = tongueSeed.length;
      ctx.lineCap = 'round';
      for (let i = 0; i < tongues; i++) {
        const seed = tongueSeed[i];
        const a = (i / tongues) * TAU + spin * 0.15 + seed.phase * 0.02;
        const n = rimNoise(a, t + seed.phase);
        const burst = n * n * n * (0.4 + seed.size * 1.2);
        if (burst < 0.035) continue; // gaps in the corona
        const len = R * (0.03 + 0.26 * Math.min(1, burst)) * (1 + heat * 0.8 + Math.max(0, flare) * 1.6);
        const curl = Math.sin(t * 1.6 + seed.phase) * 0.35;
        const r0 = R * (0.82 + seed.lift * 0.14);
        const x0 = cx + Math.cos(a) * r0;
        const y0 = cy + Math.sin(a) * r0;
        const x2 = cx + Math.cos(a + curl * (len / R)) * (r0 + len);
        const y2 = cy + Math.sin(a + curl * (len / R)) * (r0 + len);
        const xc = cx + Math.cos(a + curl * 0.5 * (len / R)) * (r0 + len * 0.55);
        const yc = cy + Math.sin(a + curl * 0.5 * (len / R)) * (r0 + len * 0.55);
        ctx.strokeStyle = `rgba(255, ${100 + Math.round(n * 80)}, 20, ${0.1 + burst * 0.5 + heat * 0.12})`;
        ctx.lineWidth = 1.6 + burst * 5;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(xc, yc, x2, y2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 228, 160, ${0.08 + burst * 0.55})`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      // Molten body: a white-hot heart that falls off fast, so the shell fragments read against darker fire.
      const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      body.addColorStop(0, 'rgba(255, 250, 232, 0.95)');
      body.addColorStop(0.12, 'rgba(255, 226, 140, 0.8)');
      body.addColorStop(0.3, 'rgba(255, 170, 40, 0.38)');
      body.addColorStop(0.6, 'rgba(235, 110, 12, 0.16)');
      body.addColorStop(0.9, 'rgba(210, 70, 0, 0.1)');
      body.addColorStop(1, 'rgba(200, 60, 0, 0)');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();

      // Swirling filaments in the core.
      ctx.lineWidth = 1.1;
      for (let s = 0; s < 4; s++) {
        const base = spin * (s % 2 ? -1.3 : 1.1) + (s * TAU) / 4;
        ctx.strokeStyle = `rgba(255, 236, 170, ${0.28 + heat * 0.3})`;
        ctx.beginPath();
        for (let k = 0; k <= 28; k++) {
          const u = k / 28;
          const ang = base + u * 4.2;
          const rad = R * (0.08 + u * 0.5) * (1 + 0.08 * Math.sin(t * 3 + s + u * 6));
          const x = cx + Math.cos(ang) * rad;
          const y = cy + Math.sin(ang) * rad * 0.82;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Embers drifting off the surface.
      for (const e of embers) {
        if (!reduced) {
          e.life += dt;
          e.dist += e.speed * dt * (1 + heat * 1.5);
          if (e.life > e.max) spawn(e, false);
        }
        const fade = Math.sin(Math.PI * Math.min(1, e.life / e.max));
        const flick = reduced ? 1 : 0.6 + 0.4 * Math.sin(t * 14 + e.angle * 20);
        const x = cx + Math.cos(e.angle) * e.dist * R;
        const y = cy + Math.sin(e.angle) * e.dist * R;
        ctx.fillStyle = `rgba(255, ${170 + Math.round(fade * 60)}, 60, ${fade * flick * 0.85})`;
        ctx.fillRect(x - e.size / 2, y - e.size / 2, e.size, e.size);
      }

      // Wake shockwave.
      if (since >= 0.12 && since < 1.2) {
        const p = (since - 0.12) / 1.08;
        ctx.strokeStyle = `rgba(255, 200, 90, ${(1 - p) * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.1 + p * 1.6), 0, TAU);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'butt';
      count('coreFrames');
      count('coreMs', performance.now() - started);

      if (!reduced && isWindowShown()) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    // Pause entirely while JARVIS is hidden or the tab is in the background.
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      if (isWindowShown()) raf = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const offShown = onWindowShownChange(onVisibility);
    // Reduced motion: a still sun, redrawn on resize and state changes only.
    const redraw = reduced ? window.setInterval(() => requestAnimationFrame(draw), 500) : 0;
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      offShown();
      if (redraw) window.clearInterval(redraw);
    };
  }, [inputCount, showInputs]);

  return (
    <div ref={wrapRef} className="core">
      <canvas ref={canvasRef} role="img" aria-label={label} />
      {showInputs && (
        <ul className="core-inputs" aria-label="What JARVIS is connected to">
          {inputs.map((input, k) => (
            <li key={input.id} className={`core-input is-${input.state}`} style={{ top: `${((k + 1) / (inputs.length + 1)) * 100}%` }}>
              <span className="core-input-label">{input.label}</span>
              <span className="core-input-detail">{input.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
