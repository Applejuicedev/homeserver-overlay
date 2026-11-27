interface SparklineProps {
  values: number[];
  color?: string;
  height?: number;
}

export function Sparkline({ values, color = "var(--accent)", height = 40 }: SparklineProps) {
  if (values.length < 2) {
    return (
      <svg width="100%" height={height}>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="chart-empty-label">
          Sammle Daten…
        </text>
      </svg>
    );
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });

  const linePoints = coords.map(([x, y]) => `${x},${y.toFixed(1)}`).join(" ");
  const areaPoints = `0,${height} ${linePoints} 100,${height}`;

  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <polygon points={areaPoints} fill={color} fillOpacity="0.14" stroke="none" />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
