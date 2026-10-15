import type { getRouteOverview } from "@/server/routes/queries";

type Overview = Awaited<ReturnType<typeof getRouteOverview>>;

/** Located / missing address counts and the depot's status (Integrations and Settings). */
export function RouteOverviewText({ overview }: { overview: Overview }) {
  const { depot } = overview;
  return (
    <span className="block space-y-1" data-testid="route-overview">
      <span className="block">
        <strong className="text-foreground">{overview.located}</strong> site address
        {overview.located === 1 ? "" : "es"} on the map
        {overview.located > 0 &&
          ` (${[
            overview.google && `${overview.google} by Google`,
            overview.approximate && `${overview.approximate} at the suburb centre`,
            overview.seeded && `${overview.seeded} demo`,
          ]
            .filter(Boolean)
            .join(", ")})`}
        , <strong className="text-foreground">{overview.missing}</strong> missing
        {overview.failed > 0 && ` (${overview.failed} couldn't be found)`}.
      </span>
      <span className="block">
        Depot:{" "}
        {!depot.address
          ? "no business address yet (Settings → Business)."
          : depot.located
            ? `${depot.address}, on the map${depot.source === "SUBURB" ? " (suburb centre, approximate)" : ""}.`
            : `${depot.address}, not on the map yet${depot.error ? ` – ${depot.error}` : ""}.`}
      </span>
    </span>
  );
}
