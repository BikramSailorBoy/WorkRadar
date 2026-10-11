import { NextResponse } from "next/server";
import { hasKey } from "@/lib/ai";
import type { StatusResponse } from "@/lib/api-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body: StatusResponse = { live: hasKey() };
  return NextResponse.json(body);
}
