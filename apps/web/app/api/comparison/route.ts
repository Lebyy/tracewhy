import { readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const MAX_COMPARISON_BYTES = 128 * 1024 * 1024;

export async function GET() {
  const path = process.env.TRACEWHY_COMPARISON;
  if (!path) {
    return NextResponse.json({ error: "No comparison is attached to this local report server." }, { status: 404 });
  }
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > MAX_COMPARISON_BYTES) {
      return NextResponse.json({ error: "The comparison exceeds the local report safety limit." }, { status: 413 });
    }
    const data = JSON.parse(await readFile(path, "utf8"));
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the attached comparison." }, { status: 500 });
  }
}
