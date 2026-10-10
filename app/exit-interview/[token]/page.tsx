import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { EXIT_INTERVIEW, EXIT_INTERNAL_KEYS } from "@/lib/separation";
import ExitInterviewClient from "./ExitInterviewClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exit interview — Clements Pest Control" };

// PUBLIC, no-login exit interview the former employee fills from the link emailed
// to their personal address. HR-internal items are stripped from the form.
export default async function ExitInterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sep = await prisma.employeeSeparation.findUnique({
    where: { exitToken: token },
    include: { employee: { select: { name: true } } },
  });
  const sections = EXIT_INTERVIEW
    .map((s) => ({ title: s.title, items: s.items.filter((it) => !EXIT_INTERNAL_KEYS.includes(it.key)) }))
    .filter((s) => s.items.length);

  return (
    <div className="min-h-screen bg-forest-grad px-4 py-10 flex justify-center">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clements-mark.svg" alt="Clements" className="h-12 w-12" />
          <h1 className="mt-3 text-xl font-light tracking-tight text-white">Clements Pest Control</h1>
        </div>

        {!sep ? (
          <Panel><p className="text-sm text-slate-600">This exit-interview link is not valid or has expired. Please contact Clements HR.</p></Panel>
        ) : sep.exitStatus === "completed" ? (
          <Panel>
            <h2 className="text-lg font-semibold text-slate-900">Thank you</h2>
            <p className="mt-1 text-sm text-slate-600">Your exit interview has already been submitted. No further action is needed.</p>
          </Panel>
        ) : (
          <ExitInterviewClient token={token} name={sep.employee.name} sections={sections} />
        )}
      </div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-white p-6 shadow-xl">{children}</div>;
}
