"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type Row,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { parseAsArrayOf, parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableToolbar, type FacetFilter } from "./data-table-toolbar";
import { DataTablePagination } from "./data-table-pagination";

const multiValue: FilterFn<unknown> = (row, columnId, value: string[]) => {
  if (!value?.length) return true;
  const cell = row.getValue(columnId);
  if (Array.isArray(cell)) return cell.some((v) => value.includes(String(v)));
  return value.includes(String(cell ?? ""));
};

function defaultSearchText(original: unknown): string {
  if (!original || typeof original !== "object") return String(original ?? "");
  return Object.values(original as Record<string, unknown>)
    .filter((v) => typeof v === "string" || typeof v === "number")
    .join(" ");
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  searchPlaceholder?: string;
  searchText?: (row: TData) => string;
  filters?: FacetFilter[];
  toolbar?: React.ReactNode;
  getRowHref?: (row: TData) => string | null;
  initialSort?: { id: string; desc: boolean };
  initialHidden?: string[];
  pageSize?: number;
  emptyMessage?: string;
  /** Prefix for URL params when a page shows more than one table. */
  urlKey?: string;
}

/**
 * The shadcn data-table pattern: search, faceted filters, sorting, pagination and
 * column visibility. Search, filters, sort and page live in the URL (nuqs) so views
 * can be bookmarked and shared.
 */
export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = "Search…",
  searchText,
  filters = [],
  toolbar,
  getRowHref,
  initialSort,
  initialHidden = [],
  pageSize = 20,
  emptyMessage = "No results.",
  urlKey = "",
}: DataTableProps<TData>) {
  const router = useRouter();
  const keys = React.useMemo(() => {
    const map: Record<
      string,
      | ReturnType<typeof parseAsString.withDefault>
      | ReturnType<typeof parseAsInteger.withDefault>
      | ReturnType<typeof parseAsArrayOf<string>>
    > = {
      [`${urlKey}q`]: parseAsString.withDefault(""),
      [`${urlKey}page`]: parseAsInteger.withDefault(1),
      [`${urlKey}sort`]: parseAsString.withDefault(
        initialSort ? `${initialSort.id}.${initialSort.desc ? "desc" : "asc"}` : "",
      ),
    };
    for (const f of filters) map[`${urlKey}${f.columnId}`] = parseAsArrayOf(parseAsString);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter column ids are static per table
  }, [urlKey, filters.map((f) => f.columnId).join(",")]);
  const [params, setParams] = useQueryStates(keys, { history: "replace", shallow: true });

  const q = (params[`${urlKey}q`] as string) ?? "";
  const page = (params[`${urlKey}page`] as number) ?? 1;
  const sortParam = (params[`${urlKey}sort`] as string) ?? "";
  const sorting: SortingState = sortParam
    ? [{ id: sortParam.split(".")[0], desc: sortParam.endsWith(".desc") }]
    : [];
  const columnFilters: ColumnFiltersState = filters
    .map((f) => ({
      id: f.columnId,
      value: (params[`${urlKey}${f.columnId}`] as string[] | null) ?? [],
    }))
    .filter((f) => f.value.length > 0);

  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() =>
    Object.fromEntries(initialHidden.map((id) => [id, false])),
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter: q,
      columnVisibility,
      pagination: { pageIndex: Math.max(0, page - 1), pageSize },
    },
    filterFns: { multiValue },
    defaultColumn: { filterFn: multiValue as FilterFn<TData> },
    globalFilterFn: (row: Row<TData>, _id, value: string) => {
      const text = (
        searchText ? searchText(row.original) : defaultSearchText(row.original)
      ).toLowerCase();
      return value
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((term) => text.includes(term));
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      void setParams({
        [`${urlKey}sort`]: s ? `${s.id}.${s.desc ? "desc" : "asc"}` : null,
        [`${urlKey}page`]: null,
      });
    },
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnFilters) : updater;
      const update: Record<string, string[] | null> = {};
      for (const f of filters) {
        const v = next.find((n) => n.id === f.columnId)?.value as string[] | undefined;
        update[`${urlKey}${f.columnId}`] = v && v.length ? v : null;
      }
      void setParams({ ...update, [`${urlKey}page`]: null });
    },
    onGlobalFilterChange: (value: string) =>
      void setParams({ [`${urlKey}q`]: value || null, [`${urlKey}page`]: null }),
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater({ pageIndex: page - 1, pageSize }) : updater;
      void setParams({ [`${urlKey}page`]: next.pageIndex > 0 ? next.pageIndex + 1 : null });
    },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    autoResetPageIndex: false,
  });

  return (
    <div className="space-y-3">
      <DataTableToolbar table={table} searchPlaceholder={searchPlaceholder} filters={filters}>
        {toolbar}
      </DataTableToolbar>
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className="first:pl-4 last:pr-4"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const href = getRowHref?.(row.original) ?? null;
                return (
                  <TableRow
                    key={row.id}
                    className={href ? "cursor-pointer" : undefined}
                    onClick={(e) => {
                      if (!href) return;
                      const target = e.target as HTMLElement;
                      if (target.closest("a,button,input,[role=checkbox],[role=menuitem]")) return;
                      if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
                      else router.push(href);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="first:pl-4 last:pr-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground h-28 text-center"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} />
    </div>
  );
}
