import { useEffect, useRef, useState } from 'react';
import { Check, X, ZoomIn } from 'lucide-react';

const VIEW = 280;
const OUTPUT = 512;

/**
 * Lets the user cut a square out of a photo: drag to move, use the slider (or
 * the mouse wheel) to zoom. The square always stays filled with the photo.
 * Returns a 512x512 image.
 */
export function SquareCropper({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (cropped: File) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Scale at which the photo just covers the square.
  const cover = natural ? Math.max(VIEW / natural.w, VIEW / natural.h) : 1;
  const scale = cover * zoom;
  const width = natural ? natural.w * scale : VIEW;
  const height = natural ? natural.h * scale : VIEW;

  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(VIEW - width, x)),
    y: Math.min(0, Math.max(VIEW - height, y)),
  });

  const onLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    setNatural({ w, h });
    const s = Math.max(VIEW / w, VIEW / h);
    setOffset({ x: (VIEW - w * s) / 2, y: (VIEW - h * s) / 2 });
  };

  const changeZoom = (next: number) => {
    const z = Math.min(4, Math.max(1, next));
    if (!natural) return setZoom(z);
    // Zoom around the centre of the square.
    const oldScale = cover * zoom, newScale = cover * z;
    const cx = (VIEW / 2 - offset.x) / oldScale, cy = (VIEW / 2 - offset.y) / oldScale;
    const w = natural.w * newScale, h = natural.h * newScale;
    setZoom(z);
    setOffset({
      x: Math.min(0, Math.max(VIEW - w, VIEW / 2 - cx * newScale)),
      y: Math.min(0, Math.max(VIEW - h, VIEW / 2 - cy * newScale)),
    });
  };

  const finish = () => {
    const img = imgRef.current;
    if (!img || !natural) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return setError('Bijsnijden lukt niet in deze browser.');
    const sx = -offset.x / scale, sy = -offset.y / scale, size = VIEW / scale;
    const keepTransparency = file.type === 'image/png' || file.type === 'image/webp';
    if (!keepTransparency) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, OUTPUT, OUTPUT); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, size, size, 0, 0, OUTPUT, OUTPUT);
    const type = keepTransparency ? 'image/png' : 'image/jpeg';
    canvas.toBlob((blob) => {
      if (!blob) return setError('Bijsnijden is mislukt. Probeer een andere foto.');
      const base = file.name.replace(/\.[^.]+$/, '') || 'profielfoto';
      onDone(new File([blob], `${base}-vierkant.${type === 'image/png' ? 'png' : 'jpg'}`, { type }));
    }, type, 0.9);
  };

  return <div className="cropper" data-testid="square-cropper">
    <div
      className="cropper-view"
      style={{ width: VIEW, height: VIEW }}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; }}
      onPointerMove={(e) => { if (!drag.current) return; setOffset(clamp(drag.current.ox + e.clientX - drag.current.x, drag.current.oy + e.clientY - drag.current.y)); }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onWheel={(e) => changeZoom(zoom - e.deltaY * 0.0015)}
    >
      {src && <img ref={imgRef} src={src} alt="" draggable={false} onLoad={onLoad} onError={() => setError('Deze foto kan niet worden geopend.')}
        style={{ width, height, transform: `translate(${offset.x}px, ${offset.y}px)` }} />}
      <span className="cropper-grid" aria-hidden="true" />
    </div>
    <label className="cropper-zoom"><ZoomIn size={15} /><span className="sr-only">Inzoomen</span>
      <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} data-testid="cropper-zoom" />
    </label>
    <p className="cropper-hint">Sleep de foto om hem te verplaatsen. Alles binnen het vierkant wordt de profielfoto.</p>
    {error && <p className="cropper-error">{error}</p>}
    <div className="cropper-actions">
      <button type="button" className="button button-ghost button-small" onClick={onCancel} data-testid="cropper-cancel"><X size={14} />Annuleren</button>
      <button type="button" className="button button-primary button-small" onClick={finish} disabled={!natural} data-testid="cropper-done"><Check size={14} />Bijsnijden</button>
    </div>
  </div>;
}
