import type { LatLng } from "@/lib/routes/geo";

export interface MapMarker {
  label: string;
  number: string;
  lat: number;
  lng: number;
  fixed: boolean;
  approximate: boolean;
}

const W = 640;
const H = 400;
const PAD = 48;

/**
 * Route map. With Google Maps set up: a Static Maps image (fetched through our server so the
 * key stays private). Without it: a plain SVG plot of the stops scaled from their
 * coordinates (no map tiles, nothing loaded from outside).
 */
export function RouteMap({
  start,
  startLabel,
  markers,
  proposedPath,
  currentPath,
  staticMapSrc,
}: {
  start: LatLng | null;
  startLabel: string;
  markers: MapMarker[];
  proposedPath: LatLng[];
  currentPath: LatLng[];
  staticMapSrc: string | null;
}) {
  if (staticMapSrc)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- proxied Google Static Maps image
      <img
        src={staticMapSrc}
        alt="Route map"
        className="aspect-[640/400] w-full rounded-md border object-cover"
      />
    );

  const all = [...(start ? [start] : []), ...markers];
  if (!all.length)
    return (
      <div className="text-muted-foreground flex aspect-[640/400] items-center justify-center rounded-md border text-sm">
        Nothing to show on the map.
      </div>
    );
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const meanLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cos = Math.cos((meanLat * Math.PI) / 180);
  const minX = Math.min(...lngs) * cos;
  const maxX = Math.max(...lngs) * cos;
  const minY = -Math.max(...lats);
  const maxY = -Math.min(...lats);
  const spanX = Math.max(maxX - minX, 0.01);
  const spanY = Math.max(maxY - minY, 0.01);
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;
  const project = (p: LatLng) => ({
    x: offX + (p.lng * cos - minX) * scale,
    y: offY + (-p.lat - minY) * scale,
  });
  const line = (path: LatLng[]) =>
    path
      .map(project)
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
  // Scale bar: 1 degree of latitude ≈ 111.32 km.
  const pxPerKm = scale / 111.32;
  const barKm = [1, 2, 5, 10, 20, 50].find((km) => km * pxPerKm >= 60) ?? 50;
  const s = start ? project(start) : null;

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Route map drawn from the stops' coordinates"
        data-testid="route-svg"
        className="bg-muted/30 w-full rounded-md border"
      >
        {currentPath.length > 1 && (
          <polyline
            points={line(currentPath)}
            fill="none"
            className="stroke-muted-foreground/50"
            strokeWidth={2}
            strokeDasharray="6 5"
          />
        )}
        {proposedPath.length > 1 && (
          <polyline
            points={line(proposedPath)}
            fill="none"
            className="stroke-primary"
            strokeWidth={3}
            strokeLinejoin="round"
          />
        )}
        {s && (
          <g>
            <rect
              x={s.x - 9}
              y={s.y - 9}
              width={18}
              height={18}
              rx={3}
              className="fill-foreground"
            />
            <text
              x={s.x}
              y={s.y + 4}
              textAnchor="middle"
              className="fill-background text-[11px] font-semibold"
            >
              H
            </text>
            <text x={s.x + 13} y={s.y + 4} className="fill-foreground text-[11px]">
              {startLabel}
            </text>
          </g>
        )}
        {markers.map((m) => {
          const p = project(m);
          return (
            <g key={m.number} data-testid="route-marker">
              <circle
                cx={p.x}
                cy={p.y}
                r={11}
                className={m.fixed ? "fill-destructive" : "fill-primary"}
                strokeDasharray={m.approximate ? "3 2" : undefined}
              />
              <text
                x={p.x}
                y={p.y + 4}
                textAnchor="middle"
                className="fill-primary-foreground text-[11px] font-semibold"
              >
                {m.label}
              </text>
              <text x={p.x + 14} y={p.y - 8} className="fill-muted-foreground text-[10px]">
                {m.number}
              </text>
            </g>
          );
        })}
        <g transform={`translate(${PAD - 16},${H - 16})`}>
          <line
            x1={0}
            x2={barKm * pxPerKm}
            y1={0}
            y2={0}
            className="stroke-foreground"
            strokeWidth={2}
          />
          <text x={barKm * pxPerKm + 6} y={4} className="fill-muted-foreground text-[10px]">
            {barKm} km
          </text>
        </g>
      </svg>
      <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-primary inline-block h-0.5 w-5" /> Proposed route
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="border-muted-foreground inline-block w-5 border-t-2 border-dashed" />{" "}
          Current order
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-destructive inline-block size-2.5 rounded-full" /> Keeps its time
        </span>
        <span>Straight lines between stops, drawn from map coordinates (no map tiles).</span>
      </figcaption>
    </figure>
  );
}
