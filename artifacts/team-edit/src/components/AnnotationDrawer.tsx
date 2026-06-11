import { useState, useRef, useEffect, useCallback } from "react";
import { X, Pen, ArrowUpRight, Square, RotateCcw, Check } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
// Coordenadas normalizadas 0-1 (estilo Frame.io)

export interface PenShape {
  tool: "pen";
  color: string;
  size: number;
  points: number[];   // [x0,y0, x1,y1, ...] — todas normalizadas
}
export interface ArrowShape {
  tool: "arrow";
  color: string;
  size: number;
  x1: number; y1: number;
  x2: number; y2: number;
}
export interface RectShape {
  tool: "rect";
  color: string;
  size: number;
  x: number; y: number;
  w: number; h: number;
}
export type AnnotationShape = PenShape | ArrowShape | RectShape;

// ── Paleta ────────────────────────────────────────────────────────────────────

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ffffff"];
const STROKE  = 0.004;   // espessura relativa (normalizada)

// ── ShapeEl — renderiza uma shape em SVG normalizado 0-1 ──────────────────────

export function ShapeEl({ shape }: { shape: AnnotationShape }) {
  if (shape.tool === "pen") {
    const pts = [];
    for (let i = 0; i < shape.points.length; i += 2)
      pts.push(`${shape.points[i]},${shape.points[i + 1]}`);
    return (
      <polyline points={pts.join(" ")} fill="none"
        stroke={shape.color} strokeWidth={shape.size}
        strokeLinecap="round" strokeLinejoin="round" />
    );
  }

  if (shape.tool === "arrow") {
    const { x1, y1, x2, y2, color, size } = shape;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return null;
    const angle = Math.atan2(dy, dx);
    const hl = Math.min(size * 6, len * 0.4);
    const hx1 = x2 - hl * Math.cos(angle - Math.PI / 6);
    const hy1 = y2 - hl * Math.sin(angle - Math.PI / 6);
    const hx2 = x2 - hl * Math.cos(angle + Math.PI / 6);
    const hy2 = y2 - hl * Math.sin(angle + Math.PI / 6);
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color} strokeWidth={size} strokeLinecap="round" />
        <polygon points={`${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`} fill={color} />
      </g>
    );
  }

  if (shape.tool === "rect") {
    const { x, y, w, h, color, size } = shape;
    if (w < 0.002 || h < 0.002) return null;
    return (
      <rect x={x} y={y} width={w} height={h}
        fill="none" stroke={color} strokeWidth={size} rx={size} />
    );
  }

  return null;
}

// ── AnnotationDrawer ──────────────────────────────────────────────────────────

interface Props {
  frameDataUrl: string;
  initial?: AnnotationShape[];
  onSave: (shapes: AnnotationShape[]) => void;
  onCancel: () => void;
}

type Tool = "pen" | "arrow" | "rect";

export function AnnotationDrawer({ frameDataUrl, initial = [], onSave, onCancel }: Props) {
  const svgRef   = useRef<SVGSVGElement>(null);
  const imgRef   = useRef<HTMLImageElement>(null);

  const [shapes,  setShapes]  = useState<AnnotationShape[]>(initial);
  const [tool,    setTool]    = useState<Tool>("pen");
  const [color,   setColor]   = useState(COLORS[0]);
  const [drawing, setDrawing] = useState(false);
  const [preview, setPreview] = useState<AnnotationShape | null>(null);

  // Aspect ratio do frame — usado no viewBox para strokes uniformes
  const [ar, setAr] = useState(16 / 9);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalHeight > 0) setAr(img.naturalWidth / img.naturalHeight);
    };
    img.src = frameDataUrl;
  }, [frameDataUrl]);

  // viewBox: "0 0 {ar} 1" — 1 unidade = altura do frame
  // Strokes são uniformes em X e Y

  const toNorm = useCallback((e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } => {
    const svg = svgRef.current!;
    const r   = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(ar, ((e.clientX - r.left) / r.width)  * ar)),
      y: Math.max(0, Math.min(1,   (e.clientY - r.top)  / r.height)),
    };
  }, [ar]);

  const startRef  = useRef<{ x: number; y: number } | null>(null);
  const ptsRef    = useRef<number[]>([]);

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const { x, y } = toNorm(e);
    setDrawing(true);
    startRef.current = { x, y };
    if (tool === "pen") {
      ptsRef.current = [x, y];
      setPreview({ tool: "pen", color, size: STROKE, points: [x, y] });
    }
  };

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawing || !startRef.current) return;
    const { x, y } = toNorm(e);
    const { x: x1, y: y1 } = startRef.current;
    if (tool === "pen") {
      ptsRef.current = [...ptsRef.current, x, y];
      setPreview({ tool: "pen", color, size: STROKE, points: [...ptsRef.current] });
    } else if (tool === "arrow") {
      setPreview({ tool: "arrow", color, size: STROKE, x1, y1, x2: x, y2: y });
    } else {
      setPreview({
        tool: "rect", color, size: STROKE,
        x: Math.min(x1, x), y: Math.min(y1, y),
        w: Math.abs(x - x1), h: Math.abs(y - y1),
      });
    }
  };

  const onMouseUp = () => {
    if (drawing && preview) setShapes(s => [...s, preview]);
    setPreview(null);
    setDrawing(false);
    startRef.current = null;
    ptsRef.current   = [];
  };

  const viewBox = `0 0 ${ar} 1`;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: "rgba(0,0,0,0.96)" }}>

      {/* ── Toolbar ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 border-b border-white/10"
        style={{ height: 48 }}>

        {/* Ferramentas */}
        <div className="flex items-center gap-0.5 p-1 rounded-lg" style={{ background: "rgba(255,255,255,0.08)" }}>
          {([
            { id: "pen",   Icon: Pen,          label: "Lápis" },
            { id: "arrow", Icon: ArrowUpRight,  label: "Seta" },
            { id: "rect",  Icon: Square,        label: "Retângulo" },
          ] as const).map(({ id, Icon, label }) => (
            <button key={id} onClick={() => setTool(id)} title={label}
              className="h-8 w-8 flex items-center justify-center rounded-md transition-colors"
              style={{
                background: tool === id ? "white" : "transparent",
                color:      tool === id ? "black" : "rgba(255,255,255,0.6)",
              }}>
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        {/* Cores */}
        <div className="flex items-center gap-2">
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} title={c}
              className="rounded-full transition-all"
              style={{
                background: c,
                width:  color === c ? 20 : 16,
                height: color === c ? 20 : 16,
                outline: color === c ? "2px solid rgba(255,255,255,0.7)" : "none",
                outlineOffset: 2,
              }} />
          ))}
        </div>

        <div className="flex-1" />

        {/* Undo */}
        <button onClick={() => setShapes(s => s.slice(0, -1))}
          disabled={shapes.length === 0}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors disabled:opacity-30"
          style={{ color: "rgba(255,255,255,0.6)" }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <RotateCcw className="h-3 w-3" />Desfazer
        </button>

        {/* Limpar */}
        {shapes.length > 0 && (
          <button onClick={() => setShapes([])}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "rgba(239,68,68,0.9)")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>
            Limpar tudo
          </button>
        )}

        {/* Salvar */}
        <button onClick={() => onSave(shapes)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white transition-opacity hover:opacity-85"
          style={{ background: "hsl(var(--primary))" }}>
          <Check className="h-3.5 w-3.5" />
          {shapes.length === 0 ? "Sem anotação" : "Salvar anotação"}
        </button>

        {/* Fechar */}
        <button onClick={onCancel}
          className="h-8 w-8 flex items-center justify-center rounded-md transition-colors"
          style={{ color: "rgba(255,255,255,0.4)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "white")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Canvas ── */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-8">
        <div className="relative select-none" style={{ lineHeight: 0, maxWidth: "100%", maxHeight: "100%" }}>
          <img ref={imgRef} src={frameDataUrl} alt="frame"
            className="block max-w-full max-h-[calc(100vh-120px)] object-contain"
            draggable={false} />

          <svg ref={svgRef}
            viewBox={viewBox}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            style={{ cursor: "crosshair", touchAction: "none" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}>
            {shapes.map((s, i) => <ShapeEl key={i} shape={s} />)}
            {preview && <ShapeEl shape={preview} />}
          </svg>
        </div>
      </div>

      {/* ── Dica ── */}
      <div className="shrink-0 flex items-center justify-center pb-3">
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
          {tool === "pen" && "Clique e arraste para desenhar"}
          {tool === "arrow" && "Clique e arraste para criar uma seta"}
          {tool === "rect" && "Clique e arraste para criar um retângulo"}
        </span>
      </div>
    </div>
  );
}
