import { scaleBand } from "@visx/scale";
import { Group } from "@visx/group";
import { Text } from "@visx/text";

export type RiskLevel = "critical" | "warning" | "ok" | "none";

export interface ProjectBarDatum {
  name: string;
  color: string;
  pct: number;
  risk: RiskLevel;
  daysLeft: number | null;
}

interface Props {
  data: ProjectBarDatum[];
  width: number;
  height: number;
}

const LABEL_W = 62;
const META_W  = 36;
const PAD     = { top: 4, bottom: 4 };
const EASE    = "cubic-bezier(0.16,1,0.3,1)";
export const RISK_COLOR: Record<RiskLevel, string> = {
  critical: "#ef4444",
  warning:  "#f59e0b",
  ok:       "#22c55e",
  none:     "#94a3b8",
};

export function ProjectBars({ data, width, height }: Props) {
  if (width < 10 || height < 10 || data.length === 0) return null;

  const innerW = width - LABEL_W - META_W;
  const innerH = height - PAD.top - PAD.bottom;

  const yScale = scaleBand<string>({
    domain: data.map(d => d.name),
    range:  [0, innerH],
    padding: 0.32,
  });

  const barH = yScale.bandwidth();
  const r    = Math.min(3, barH / 2);

  return (
    <svg width={width} height={height}>
      <defs>
        <style>{`
          @keyframes pb-growX {
            from { transform: scaleX(0); }
            to   { transform: scaleX(1); }
          }
          @keyframes pb-fadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
        `}</style>
      </defs>
      <Group left={LABEL_W} top={PAD.top}>
        {data.map((d, i) => {
          const y      = yScale(d.name) ?? 0;
          const barW   = Math.max(0, (d.pct / 100) * innerW);
          const delay  = `${i * 0.07}s`;
          const rc     = RISK_COLOR[d.risk];
          const label  = d.name.length > 9 ? d.name.slice(0, 9) + "…" : d.name;

          const daysTxt = d.daysLeft === null ? "—"
            : d.daysLeft < 0  ? `${Math.abs(d.daysLeft)}d atr.`
            : d.daysLeft === 0 ? "hoje"
            : `${d.daysLeft}d`;

          return (
            <g key={d.name}>
              {/* Project name */}
              <Text
                x={-6} y={y + barH / 2}
                textAnchor="end" verticalAnchor="middle"
                fontSize={9} fill="#94a3b8" fontFamily="inherit"
              >
                {label}
              </Text>

              {/* Track */}
              <rect x={0} y={y} width={innerW} height={barH} rx={r}
                fill={d.color} opacity={0.13} />

              {/* Progress fill */}
              {barW > 0 && (
                <rect
                  x={0} y={y} width={barW} height={barH} rx={r}
                  fill={d.color} opacity={0.78}
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "left center",
                    animation: `pb-growX 0.6s ${EASE} ${delay} both`,
                  }}
                />
              )}

              {/* Risk dot */}
              <circle
                cx={innerW + 8} cy={y + barH / 2} r={3.5} fill={rc}
                style={{ animation: `pb-fadeIn 0.3s ease ${parseFloat(delay) + 0.5}s both` }}
              />

              {/* % and days */}
              <Text
                x={innerW + META_W - 2} y={y + barH / 2 - 3}
                textAnchor="end" verticalAnchor="end"
                fontSize={9} fontWeight={700} fill={rc} fontFamily="inherit"
                style={{ animation: `pb-fadeIn 0.3s ease ${parseFloat(delay) + 0.4}s both` }}
              >
                {`${d.pct}%`}
              </Text>
              <Text
                x={innerW + META_W - 2} y={y + barH / 2 + 3}
                textAnchor="end" verticalAnchor="start"
                fontSize={7} fill="#94a3b8" fontFamily="inherit"
                style={{ animation: `pb-fadeIn 0.3s ease ${parseFloat(delay) + 0.4}s both` }}
              >
                {daysTxt}
              </Text>
            </g>
          );
        })}
      </Group>
    </svg>
  );
}
