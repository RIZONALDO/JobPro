import { scaleLinear, scaleBand } from "@visx/scale";
import { Group } from "@visx/group";
import { LinearGradient } from "@visx/gradient";
import { Text } from "@visx/text";

export interface HBarDatum {
  label: string;
  count: number;
  color: string;
}

interface Props {
  data: HBarDatum[];
  width: number;
  height: number;
}

const LABEL_W = 48;
const COUNT_W = 18;
const PAD = { top: 4, bottom: 4, right: 6 };
const EASE = "cubic-bezier(0.16,1,0.3,1)";

export function HBarChart({ data, width, height }: Props) {
  if (width < 10 || height < 10) return null;

  const innerW = width  - LABEL_W - COUNT_W - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const maxCount = Math.max(...data.map(d => d.count), 1);

  const yScale = scaleBand<string>({
    domain: data.map(d => d.label),
    range:  [0, innerH],
    padding: 0.35,
  });

  const xScale = scaleLinear<number>({
    domain: [0, maxCount],
    range:  [0, innerW],
  });

  const barH = yScale.bandwidth();

  return (
    <svg width={width} height={height}>
      <defs>
        <style>{`
          @keyframes hb-growX {
            from { transform: scaleX(0); }
            to   { transform: scaleX(1); }
          }
          @keyframes hb-fadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
        `}</style>
      </defs>

      {data.map((d, i) => (
        <LinearGradient
          key={i}
          id={`hb-grad-${i}`}
          from={d.color}
          to={d.color}
          fromOpacity={0.85}
          toOpacity={0.2}
          vertical={false}
        />
      ))}

      <Group left={LABEL_W} top={PAD.top}>
        {data.map((d, i) => {
          const y    = yScale(d.label) ?? 0;
          const barW = xScale(d.count);
          const r    = Math.min(4, barH / 2);
          const delay = `${i * 0.07}s`;

          return (
            <g key={d.label}>
              <Text
                x={-6}
                y={y + barH / 2}
                textAnchor="end"
                verticalAnchor="middle"
                fontSize={9}
                fill="#94a3b8"
                fontFamily="inherit"
              >
                {d.label}
              </Text>

              <rect
                x={0} y={y}
                width={innerW} height={barH}
                rx={r}
                fill="hsl(var(--muted))"
                opacity={0.5}
              />

              {barW > 0 && (
                <path
                  d={`
                    M ${0},${y}
                    L ${Math.max(0, barW - r)},${y}
                    Q ${barW},${y} ${barW},${y + r}
                    L ${barW},${y + barH - r}
                    Q ${barW},${y + barH} ${Math.max(0, barW - r)},${y + barH}
                    L ${0},${y + barH}
                    Z
                  `}
                  fill={`url(#hb-grad-${i})`}
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "left center",
                    animation: `hb-growX 0.55s ${EASE} ${delay} both`,
                  }}
                />
              )}

              <Text
                x={innerW + COUNT_W - 4}
                y={y + barH / 2}
                textAnchor="end"
                verticalAnchor="middle"
                fontSize={9}
                fontWeight={700}
                fill={d.count > 0 ? d.color : "#94a3b8"}
                fontFamily="inherit"
                style={{
                  animation: `hb-fadeIn 0.4s ease ${parseFloat(delay) + 0.3}s both`,
                }}
              >
                {d.count}
              </Text>
            </g>
          );
        })}
      </Group>
    </svg>
  );
}
