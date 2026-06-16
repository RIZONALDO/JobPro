import { type AnnotationShape, ShapeEl } from "./AnnotationDrawer";

interface Props {
  annotations: string | null | undefined;
  className?: string;
  // "meet" = object-contain (vídeo, alinha com letterbox)
  // "slice" = object-cover (thumbnail, recorte)
  // "none"  = stretch (thumbnail simples sem preocupação de alinhamento)
  fit?: "meet" | "slice" | "none";
}

// Analisa JSON nos dois formatos:
//   novo:  { ar: number; shapes: AnnotationShape[] }
//   antigo: AnnotationShape[]   (array direto)
function parseAnnotations(raw: string): { ar: number; shapes: AnnotationShape[] } | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const ar = parsed.length > 0 && (parsed[0] as any)._ar ? (parsed[0] as any)._ar : 16 / 9;
      return { ar, shapes: parsed as AnnotationShape[] };
    }
    return { ar: parsed.ar ?? 16 / 9, shapes: parsed.shapes ?? [] };
  } catch { return null; }
}

export function AnnotationOverlay({ annotations, className = "", fit = "meet" }: Props) {
  if (!annotations) return null;
  const data = parseAnnotations(annotations);
  if (!data || !data.shapes.length) return null;

  const { ar, shapes } = data;
  const pAR = fit === "meet" ? "xMidYMid meet" : fit === "slice" ? "xMidYMid slice" : "none";

  return (
    <svg
      viewBox={`0 0 ${ar} 1`}
      preserveAspectRatio={pAR}
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}>
      {shapes.map((s, i) => <ShapeEl key={i} shape={s} />)}
    </svg>
  );
}
