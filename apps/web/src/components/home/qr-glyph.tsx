// A decorative Swiss QR code: three finder squares, a deterministic scatter of modules and the
// Swiss cross in the middle, as on a real QR bill. It encodes nothing.
const SIZE = 25

function finder(x: number, y: number) {
  return (
    <g key={`f${x}${y}`}>
      <rect x={x} y={y} width={7} height={7} rx={1.2} fill="currentColor" />
      <rect x={x + 1} y={y + 1} width={5} height={5} rx={0.8} fill="var(--card)" />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.6} fill="currentColor" />
    </g>
  )
}

function reserved(x: number, y: number) {
  const inFinder = (fx: number, fy: number) =>
    x >= fx - 1 && x <= fx + 7 && y >= fy - 1 && y <= fy + 7
  const inCross = x >= 9 && x <= 15 && y >= 9 && y <= 15
  return inFinder(0, 0) || inFinder(SIZE - 7, 0) || inFinder(0, SIZE - 7) || inCross
}

const modules: [number, number][] = []
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (reserved(x, y)) continue
    if (((x * 7 + y * 13 + x * y * 3) ^ (x + y * 5)) % 5 < 2) modules.push([x, y])
  }
}

export function QrGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox={`-1 -1 ${SIZE + 2} ${SIZE + 2}`} className={className} aria-hidden>
      {modules.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x + 0.08}
          y={y + 0.08}
          width={0.84}
          height={0.84}
          rx={0.2}
          fill="currentColor"
        />
      ))}
      {finder(0, 0)}
      {finder(SIZE - 7, 0)}
      {finder(0, SIZE - 7)}
      <rect x={9.5} y={9.5} width={6} height={6} fill="var(--card)" />
      <rect x={10} y={10} width={5} height={5} fill="currentColor" />
      <rect x={12.1} y={10.8} width={0.8} height={3.4} fill="var(--card)" />
      <rect x={10.8} y={12.1} width={3.4} height={0.8} fill="var(--card)" />
    </svg>
  )
}
