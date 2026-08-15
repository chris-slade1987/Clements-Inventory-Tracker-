import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { recipientOptions } from "@/lib/threads";

export const runtime = "nodejs";
export const maxDuration = 20;

// People the current user can start a discussion with (for the compose modal).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ options: [] }, { status: 401 });
  const options = await recipientOptions(user).catch(() => []);
  return NextResponse.json({ options });
}
