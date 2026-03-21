import { useRef, useCallback, useEffect } from "react";

/* ─── Confetti Configuration ────────────────────────────────────── */

const PARTICLE_COUNT_MIN = 40;
const PARTICLE_COUNT_MAX = 60;
const DURATION_MS = 1500;
const GRAVITY = 0.12;
const AIR_RESISTANCE = 0.985;
const FADE_START = 0.7; // start fading at 70% of duration

const COLORS = [
  "#BFFF00", // lime
  "#6BE0FF", // sky
  "#C77DFF", // violet
  "#FFB86C", // peach
  "#8FBF00", // lime-dim
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  opacity: number;
}

/* ─── Canvas reference stored at module level ───────────────────── */

let canvasRef: HTMLCanvasElement | null = null;
let animFrameId: number | null = null;

function getCanvas(): HTMLCanvasElement | null {
  if (canvasRef && document.body.contains(canvasRef)) return canvasRef;
  canvasRef = document.getElementById("confetti-canvas") as HTMLCanvasElement | null;
  return canvasRef;
}

/* ─── Imperative trigger function ───────────────────────────────── */

export function triggerConfetti() {
  const canvas = getCanvas();
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Size canvas to viewport
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const count = PARTICLE_COUNT_MIN + Math.floor(Math.random() * (PARTICLE_COUNT_MAX - PARTICLE_COUNT_MIN + 1));
  const centerX = canvas.width / 2;
  const bottomY = canvas.height * 0.85;

  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
    const speed = 6 + Math.random() * 10;
    particles.push({
      x: centerX + (Math.random() - 0.5) * 40,
      y: bottomY,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 3,
      vy: Math.sin(angle) * speed - Math.random() * 2,
      width: 4 + Math.random() * 4,
      height: 4 + Math.random() * 4,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      opacity: 1,
    });
  }

  const startTime = performance.now();

  // Cancel any existing animation
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  function animate(now: number) {
    if (!ctx || !canvas) return;

    const elapsed = now - startTime;
    const progress = elapsed / DURATION_MS;

    if (progress >= 1) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      animFrameId = null;
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Global fade after FADE_START
    const globalAlpha = progress > FADE_START
      ? 1 - ((progress - FADE_START) / (1 - FADE_START))
      : 1;

    for (const p of particles) {
      // Physics
      p.vy += GRAVITY;
      p.vx *= AIR_RESISTANCE;
      p.vy *= AIR_RESISTANCE;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = globalAlpha * p.opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
      ctx.restore();
    }

    animFrameId = requestAnimationFrame(animate);
  }

  animFrameId = requestAnimationFrame(animate);
}

/* ─── Canvas Overlay Component ──────────────────────────────────── */

export function ConfettiCanvas() {
  return (
    <canvas
      id="confetti-canvas"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}

/* ─── Hook for components that want to trigger confetti ─────────── */

export function useConfetti() {
  const hasFiredRef = useRef(false);

  const fire = useCallback(() => {
    if (!hasFiredRef.current) {
      hasFiredRef.current = true;
      triggerConfetti();
    }
  }, []);

  const reset = useCallback(() => {
    hasFiredRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      hasFiredRef.current = false;
    };
  }, []);

  return { fire, reset };
}
