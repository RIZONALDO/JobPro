import { useEffect, useState } from "react";

interface Props {
  pct: number;
  width: number;
  height: number;
  label?: string;
}

const START_DEG = -215;
const END_DEG   =  35;
const SWEEP_DEG = END_DEG - START_DEG; // 250°
const EASE      = "cubic-bezier(0.16,1,0.3,1)";

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const toRad = (d: number) => (d - 90) * (Math.PI / 180);
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function GaugeChart({ pct, width, height, label = "concluído" }: Props) {
  if (width < 10 || height < 10) return null;

  const [active, setActive] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setActive(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const cx = width  / 2;
  const cy = height * 0.62;
  const r  = Math.min(cx - 10, cy - 8, 46);

  const totalLen  = r * (SWEEP_DEG * Math.PI / 180);
  const dashOffset = active ? totalLen * (1 - pct / 100) : totalLen;

  const color = pct >= 75 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444";
  const fullArc = arcPath(cx, cy, r, START_DEG, END_DEG);

  return (
    <svg width={width} height={height}>
      {/* Track */}
      <path d={fullArc} fill="none" strokeWidth={10} strokeLinecap="round"
        stroke="hsl(var(--muted))" opacity={0.45} />
      {/* Progress */}
      <path
        d={fullArc}
        fill="none"
        strokeWidth={10}
        strokeLinecap="round"
        stroke={color}
        strokeDasharray={totalLen}
        strokeDashoffset={dashOffset}
        style={{ transition: `stroke-dashoffset 0.9s ${EASE}` }}
      />
      {/* Dot at progress tip */}
      {pct > 2 && (() => {
        const tipDeg = START_DEG + (active ? pct / 100 : 0) * SWEEP_DEG;
        const toRad  = (d: number) => (d - 90) * (Math.PI / 180);
        const tx = cx + r * Math.cos(toRad(tipDeg));
        const ty = cy + r * Math.sin(toRad(tipDeg));
        return (
          <circle cx={tx} cy={ty} r={5} fill={color}
            style={{ transition: `cx 0.9s ${EASE}, cy 0.9s ${EASE}` }}
          />
        );
      })()}
      {/* Center: percentage */}
      <text
        x={cx} y={cy - 4}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize={22}
        fontWeight={700}
        fill="hsl(var(--foreground))"
        fontFamily="inherit"
      >
        {pct}%
      </text>
      <text
        x={cx} y={cy + 9}
        textAnchor="middle"
        fontSize={8}
        fill="#94a3b8"
        fontFamily="inherit"
      >
        {label}
      </text>
    </svg>
  );
}
