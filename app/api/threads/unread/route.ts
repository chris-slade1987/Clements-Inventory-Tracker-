import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { unreadCount } from "@/lib/threads";

export const runtime = "nodejs";

// Lightweight poll target for the notification bell.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ count: 0 });
  const count = await unreadCount(user.id).catch(() => 0);
  return NextResponse.json({ count });
}
