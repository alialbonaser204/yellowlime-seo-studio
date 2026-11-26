import { useEffect, useRef } from 'react';

/**
 * A soft white light on a coloured "stage" that follows the mouse with a
 * delay, like a spotlight. Without a mouse (phone, tablet, or before the
 * first real movement) it rests on the element given by `anchorSelector`.
 *
 * Drawn on a canvas that fills its parent; put it as the first child of a
 * `position: relative` element and give the content a higher z-index.
 */
export function Spotlight({
  stageColor,
  anchorSelector,
  ease = 0.07,
  glow = 1,
}: {
  /** Colour of the stage, painted over white. */
  stageColor: string;
  /** Where the light rests without a mouse (default: the centre). */
  anchorSelector?: string;
  /** Share of the distance to the mouse covered per frame. */
  ease?: number;
  /** Strength of the light (1 = full; lower for a dark stage). */
  glow?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;

    const MAX_DPR = 2;
    const hasMouse = window.matchMedia('(hover: hover)');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    let width = 0, height = 0;
    let x = 0, y = 0, targetX = 0, targetY = 0;
    let mouseSeen = false;
    let frame = 0;
    let resizeFrame = 0;

    const radius = () => Math.max(220, 0.55 * Math.min(width, height));

    const rest = () => {
      const anchor = anchorSelector ? document.querySelector(anchorSelector) : null;
      const box = canvas.getBoundingClientRect();
      if (anchor) {
        const a = anchor.getBoundingClientRect();
        targetX = a.left + a.width / 2 - box.left;
        targetY = a.top + a.height / 2 - box.top;
      } else {
        targetX = width / 2;
        targetY = height / 2;
      }
    };

    const draw = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = stageColor;
      ctx.fillRect(0, 0, width, height);
      const r = radius();
      const light = ctx.createRadialGradient(x, y, 0, x, y, r);
      light.addColorStop(0, `rgba(255,255,255,${0.98 * glow})`);
      light.addColorStop(0.35, `rgba(255,255,255,${0.75 * glow})`);
      light.addColorStop(0.7, `rgba(255,255,255,${0.22 * glow})`);
      light.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = light;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };

    const tick = () => {
      frame = 0;
      if (reduceMotion.matches) {
        x = targetX; y = targetY;
      } else {
        x += (targetX - x) * ease;
        y += (targetY - y) * ease;
      }
      draw();
      // Only keep animating while the light is still moving.
      if (Math.abs(targetX - x) > 0.3 || Math.abs(targetY - y) > 0.3) frame = requestAnimationFrame(tick);
      else { x = targetX; y = targetY; }
    };
    const start = () => { if (!frame) frame = requestAnimationFrame(tick); };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = box.width;
      height = box.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!mouseSeen || !hasMouse.matches) { rest(); x = targetX; y = targetY; }
      draw();
    };

    const onMove = (event: PointerEvent) => {
      if (!hasMouse.matches || event.pointerType !== 'mouse') return;
      // Some browsers send a "move" on load without real movement.
      if (!mouseSeen && event.movementX === 0 && event.movementY === 0) return;
      const box = canvas.getBoundingClientRect();
      targetX = event.clientX - box.left;
      targetY = event.clientY - box.top;
      mouseSeen = true;
      start();
    };
    const onHoverChange = () => { if (!hasMouse.matches) { mouseSeen = false; rest(); start(); } };
    const onResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resize); };

    // The canvas position on the page changes when scrolling; keep the light
    // under the mouse by recalculating on the next move.
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', onResize);
    hasMouse.addEventListener('change', onHoverChange);
    // Fonts and images can shift the logo after the first paint.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    observer?.observe(canvas);
    resize();

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', onResize);
      hasMouse.removeEventListener('change', onHoverChange);
      observer?.disconnect();
    };
  }, [stageColor, anchorSelector, ease, glow]);

  return <canvas ref={ref} className="spotlight-canvas" aria-hidden="true" />;
}
