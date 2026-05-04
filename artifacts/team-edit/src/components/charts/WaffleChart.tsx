interface Props {
  cells: string[];   // 100 hex colors, one per cell
  width: number;
  height: number;
}

const COLS = 10;
const ROWS = 10;
const GAP  = 2;

export function WaffleChart({ cells, width, height }: Props) {
  if (width < 10 || height < 10) return null;

  const cellW = (width  - GAP * (COLS - 1)) / COLS;
  const cellH = (height - GAP * (ROWS - 1)) / ROWS;
  const r     = Math.min(2.5, cellW / 3);

  return (
    <svg width={width} height={height}>
      <defs>
        <style>{`
          @keyframes wfl-pop {
            from { opacity: 0; transform: scale(0.3); }
            to   { opacity: 1; transform: scale(1);   }
          }
        `}</style>
      </defs>
      {cells.map((color, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x   = col * (cellW + GAP);
        const y   = row * (cellH + GAP);
        return (
          <rect
            key={i}
            x={x} y={y}
            width={cellW} height={cellH}
            rx={r}
            fill={color}
            style={{
              transformBox: "fill-box",
              transformOrigin: "center",
              animation: `wfl-pop 0.18s cubic-bezier(0.34,1.56,0.64,1) ${i * 6}ms both`,
            }}
          />
        );
      })}
    </svg>
  );
}
