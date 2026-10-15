import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Report, ReportColumn, ReportRow } from "@/server/reports/queries";

function format(value: string | number | null | undefined, col: ReportColumn) {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "number") {
    if (col.type === "money") return formatCents(value);
    if (col.type === "percent") return `${value}%`;
    return value.toLocaleString("en-AU");
  }
  return value;
}

const numeric = (c: ReportColumn) =>
  c.type === "money" || c.type === "number" || c.type === "percent";

export function ReportTable({ report }: { report: Report }) {
  const cell = (row: ReportRow, c: ReportColumn, bold = false) => (
    <TableCell
      key={c.key}
      className={cn(
        numeric(c) && "text-right tabular-nums",
        bold && "font-semibold",
        "first:pl-4 last:pr-4",
      )}
    >
      {format(row[c.key], c)}
    </TableCell>
  );
  if (report.rows.length === 0)
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No data for this period.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {report.columns.map((c) => (
              <TableHead
                key={c.key}
                className={cn(numeric(c) && "text-right", "first:pl-4 last:pr-4")}
              >
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((row, i) => (
            <TableRow key={i}>{report.columns.map((c) => cell(row, c))}</TableRow>
          ))}
        </TableBody>
        {report.totals && (
          <TableFooter>
            <TableRow>{report.columns.map((c) => cell(report.totals!, c, true))}</TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
