import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { contentTypeForKey, readFileByKey } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");
  if (key.includes("..")) return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  if (!key.startsWith("public/")) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const file = await readFileByKey(key);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const type = contentTypeForKey(key);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": type,
      "Cache-Control": key.startsWith("public/")
        ? "public, max-age=86400"
        : "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      ...(type === "image/svg+xml" ? { "Content-Security-Policy": "script-src 'none'" } : {}),
    },
  });
}
