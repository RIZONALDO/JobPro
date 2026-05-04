import { Pie } from "@visx/shape";
import { Group } from "@visx/group";
import { Text } from "@visx/text";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface Props {
  data: DonutSlice[];
  width: number;
  height: number;
  totalLabel?: string;
  total?: number;
}

const EASE = "cubic-bezier(0.16,1,0.3,1)";

export function DonutChart({ data, width, height, totalLabel = "total", total }: Props) {
  if (width < 10 || height < 10) return null;

  const radius      = Math.min(width, height) / 2;
  const innerRadius = radius * 0.58;
  const cx = width  / 2;
  const cy = height / 2;

  const displayData  = data.length > 0 ? data : [{ label: "Vazio", value: 1, color: "#e2e8f0" }];
  const displayTotal = total ?? data.reduce((s, d) => s + d.value, 0);

  return (
    <svg width={width} height={height}>
      <defs>
        <style>{`
          @keyframes dc-arcIn {
            from { opacity: 0; transform: scale(0.6) rotate(-30deg); }
            to   { opacity: 1; transform: scale(1)   rotate(0deg);   }
          }
          @keyframes dc-fadeUp {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 1; transform: translateY(0);   }
          }
        `}</style>
      </defs>

      <Group top={cy} left={cx}>
        <Pie
          data={displayData}
          pieValue={d => d.value}
          outerRadius={radius - 2}
          innerRadius={innerRadius}
          padAngle={0.03}
          cornerRadius={3}
        >
          {pie => pie.arcs.map((arc, i) => (
            <path
              key={i}
              d={pie.path(arc) ?? ""}
              fill={arc.data.color}
              opacity={data.length === 0 ? 0.3 : 1}
              style={{
                transformBox: "fill-box",
                transformOrigin: "center",
                animation: `dc-arcIn 0.55s ${EASE} ${i * 0.07}s both`,
              }}
            />
          ))}
        </Pie>

        <Text
          textAnchor="middle"
          verticalAnchor="end"
          y={4}
          fontSize={18}
          fontWeight={700}
          fill="hsl(var(--foreground))"
          fontFamily="inherit"
          style={{ animation: `dc-fadeUp 0.4s ease 0.35s both` }}
        >
          {displayTotal}
        </Text>
        <Text
          textAnchor="middle"
          verticalAnchor="start"
          y={6}
          fontSize={8}
          fill="#94a3b8"
          fontFamily="inherit"
          style={{ animation: `dc-fadeUp 0.4s ease 0.4s both` }}
        >
          {totalLabel}
        </Text>
      </Group>
    </svg>
  );
}
