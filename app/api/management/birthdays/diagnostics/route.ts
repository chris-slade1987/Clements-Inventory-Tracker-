import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// Must match BIRTHDAY_REPORT_KEY in scripts/backfill-birthdays.ts (kept as a
// literal here so the route doesn't bundle the script).
const BIRTHDAY_REPORT_KEY = "employee_birthdays_report";

export const runtime = "nodejs";
export const maxDuration = 20;

// Admin-only: the result of the last employee-birthday backfill (matched count +
// any unmatched rows), plus a live count of how many active employees now have a
// birthday on file. Lets us confirm the prod load and mop up stragglers without
// direct DB access.
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [setting, withBirthday, activeTotal] = await Promise.all([
    prisma.setting.findUnique({ where: { key: BIRTHDAY_REPORT_KEY } }).catch(() => null),
    prisma.employee.count({ where: { status: "active", birthMonth: { not: null }, birthDay: { not: null } } }).catch(() => 0),
    prisma.employee.count({ where: { status: "active" } }).catch(() => 0),
  ]);

  let report: unknown = null;
  try { report = setting ? JSON.parse(setting.value) : null; } catch { report = setting?.value ?? null; }

  return NextResponse.json({
    build: { tag: "birthdays-1" },
    lastBackfill: report,
    live: { activeEmployees: activeTotal, withBirthdayOnFile: withBirthday },
  });
}
