import { scaleBand, scaleLinear } from "@visx/scale";
import { Group } from "@visx/group";
import { Bar } from "@visx/shape";
import { LinearGradient } from "@visx/gradient";
import { Text } from "@visx/text";

interface StatusBar {
  label: string;
  count: number;
  color: string;
  gradientId: string;
}

interface Props {
  data: StatusBar[];
  width: number;
  height: number;
}

const MARGIN = { top: 10, bottom: 22, left: 4, right: 4 };
const EASE   = "cubic-bezier(0.16,1,0.3,1)";

export function StatusBars({ data, width, height }: Props) {
  const innerW = width  - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top  - MARGIN.bottom;

  const maxCount = Math.max(...data.map(d => d.count), 1);

  const xScale = scaleBand<string>({
    domain: data.map(d => d.label),
    range:  [0, innerW],
    padding: 0.35,
  });

  const yScale = scaleLinear<number>({
    domain: [0, maxCount],
    range:  [innerH, 0],
    nice:   true,
  });

  const barW = xScale.bandwidth();

  return (
    <svg width={width} height={height}>
      <defs>
        <style>{`
          @keyframes sb-growY {
            from { transform: scaleY(0); }
            to   { transform: scaleY(1); }
          }
          @keyframes sb-fadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
        `}</style>
      </defs>

      {data.map(d => (
        <LinearGradient
          key={d.gradientId}
          id={d.gradientId}
          from={d.color}
          to={d.color}
          fromOpacity={0.9}
          toOpacity={0.25}
          vertical
        />
      ))}

      <Group left={MARGIN.left} top={MARGIN.top}>
        {data.map((d, i) => {
          const x     = xScale(d.label) ?? 0;
          const barH  = innerH - yScale(d.count);
          const y     = innerH - barH;
          const r     = Math.min(5, barW / 2);
          const delay = `${i * 0.06}s`;

          return (
            <g key={d.label}>
              {barH > 0 && (
                <path
                  d={`
                    M ${x},${y + r}
                    Q ${x},${y} ${x + r},${y}
                    L ${x + barW - r},${y}
                    Q ${x + barW},${y} ${x + barW},${y + r}
                    L ${x + barW},${y + barH}
                    L ${x},${y + barH}
                    Z
                  `}
                  fill={`url(#${d.gradientId})`}
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "bottom center",
                    animation: `sb-growY 0.55s ${EASE} ${delay} both`,
                  }}
                />
              )}
              {barH === 0 && (
                <Bar
                  x={x} y={innerH - 3}
                  width={barW} height={3}
                  rx={2}
                  fill={d.color}
                  opacity={0.15}
                />
              )}
              {d.count > 0 && (
                <Text
                  x={x + barW / 2}
                  y={y - 3}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={700}
                  fill={d.color}
                  fontFamily="inherit"
                  style={{
                    animation: `sb-fadeIn 0.4s ease ${parseFloat(delay) + 0.3}s both`,
                  }}
                >
                  {d.count}
                </Text>
              )}
              <Text
                x={x + barW / 2}
                y={innerH + 14}
                textAnchor="middle"
                fontSize={8}
                fill="#94a3b8"
                fontFamily="inherit"
              >
                {d.label}
              </Text>
            </g>
          );
        })}
      </Group>
    </svg>
  );
}
