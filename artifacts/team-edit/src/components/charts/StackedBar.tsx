import { Text } from "@visx/text";

export interface StackedSegment {
  label: string;
  value: number;
  color: string;
}

interface Props {
  data: StackedSegment[];
  width: number;
  height: number;
}

const EASE    = "cubic-bezier(0.16,1,0.3,1)";
const BAR_H   = 24;
const LBL_PAD = 14;
const GAP     = 3;

export function StackedBar({ data, width, height }: Props) {
  if (width < 10 || height < 10) return null;

  const active    = data.filter(d => d.value > 0);
  const total     = active.reduce((s, d) => s + d.value, 0) || 1;
  const totalGaps = Math.max(0, active.length - 1) * GAP;
  const availW    = width - totalGaps;
  const barY      = Math.max(0, (height - BAR_H - LBL_PAD) / 2);
  const r         = Math.min(8, BAR_H / 2);

  let x = 0;
  const segments = active.map((d, i) => {
    const segW = Math.round((d.value / total) * availW);
    const seg  = { ...d, sx: x, segW, i };
    x += segW + GAP;
    return seg;
  });

  return (
    <svg width={width} height={height}>
      <defs>
        <style>{`
          @keyframes stk-growX {
            from { transform: scaleX(0); }
            to   { transform: scaleX(1); }
          }
          @keyframes stk-fadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
        `}</style>
      </defs>

      {active.length === 0 && (
        <rect x={0} y={barY} width={width} height={BAR_H} rx={r}
          fill="hsl(var(--muted))" opacity={0.4} />
      )}

      {segments.map((seg, i) => {
        const isFirst = i === 0;
        const isLast  = i === segments.length - 1;
        const tl = isFirst ? r : 1;
        const tr = isLast  ? r : 1;
        const delay = `${i * 0.1}s`;

        const d = `
          M ${seg.sx + tl},${barY}
          L ${seg.sx + seg.segW - tr},${barY}
          Q ${seg.sx + seg.segW},${barY} ${seg.sx + seg.segW},${barY + tr}
          L ${seg.sx + seg.segW},${barY + BAR_H - tr}
          Q ${seg.sx + seg.segW},${barY + BAR_H} ${seg.sx + seg.segW - tr},${barY + BAR_H}
          L ${seg.sx + tl},${barY + BAR_H}
          Q ${seg.sx},${barY + BAR_H} ${seg.sx},${barY + BAR_H - tl}
          L ${seg.sx},${barY + tl}
          Q ${seg.sx},${barY} ${seg.sx + tl},${barY}
          Z
        `;

        return (
          <g key={seg.label}>
            <path
              d={d}
              fill={seg.color}
              opacity={0.85}
              style={{
                transformBox: "fill-box",
                transformOrigin: "left center",
                animation: `stk-growX 0.55s ${EASE} ${delay} both`,
              }}
            />

            {seg.segW > 22 && (
              <Text
                x={seg.sx + seg.segW / 2}
                y={barY + BAR_H / 2}
                textAnchor="middle"
                verticalAnchor="middle"
                fontSize={seg.segW > 40 ? 11 : 9}
                fontWeight={700}
                fill="white"
                fontFamily="inherit"
                style={{ animation: `stk-fadeIn 0.3s ease ${parseFloat(delay) + 0.4}s both` }}
              >
                {seg.value}
              </Text>
            )}

            <Text
              x={seg.sx + seg.segW / 2}
              y={barY + BAR_H + 11}
              textAnchor="middle"
              fontSize={8}
              fontWeight={600}
              fill={seg.color}
              fontFamily="inherit"
              style={{ animation: `stk-fadeIn 0.3s ease ${parseFloat(delay) + 0.2}s both` }}
            >
              {seg.label}
            </Text>
          </g>
        );
      })}
    </svg>
  );
}
