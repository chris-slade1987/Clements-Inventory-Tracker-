import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getHrEmail } from "@/lib/personnel";
import ComposeThread from "@/components/ComposeThread";
import Glyph from "@/components/Glyph";

export const dynamic = "force-dynamic";

// HR & Support — the employee's way to reach the People/HR team: send a question
// or request a meeting (both start an internal thread addressed to HR/Leadership,
// with replies landing in the Inbox), plus the self-service links they most often
// need. Available to every signed-in person.
export default async function MyHrPage() {
  const user = await requireUser();
  const hrEmail = await getHrEmail();

  return (
    <>
      <PageHeader title="HR & support" subtitle="Reach the People team — questions, requests, and time off" />

      {/* HR contact */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Glyph name="shield" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink">Human Resources</div>
            <div className="text-xs text-muted">
              Director of HR · April Williford ·{" "}
              <a href={`mailto:${hrEmail}`} className="text-brand-700 hover:underline">{hrEmail}</a>
            </div>
          </div>
        </div>
      </Card>

      {/* Message HR / request a meeting — both start an internal thread. */}
      <Card className="p-5 mb-5">
        <div className="text-sm font-medium text-ink">Message HR</div>
        <p className="mt-1 text-xs text-muted">
          Start a private conversation with the People team — HR/Leadership is{" "}
          <span className="font-medium text-ink">already selected</span> for you (you can add or remove people). Their reply arrives in your{" "}
          <Link href="/inbox" className="text-brand-700 hover:underline">Inbox</Link>.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ComposeThread
            variant="primary"
            label="Send HR a message"
            presetGroup="Leadership & HR"
            context={{ type: "hr", label: "HR request", subject: "Question for HR" }}
          />
          <ComposeThread
            variant="secondary"
            label="Request a meeting with HR"
            presetGroup="Leadership & HR"
            context={{ type: "hr", label: "Meeting request", subject: "Request: meeting with HR" }}
          />
        </div>
      </Card>

      {/* Common self-service destinations. */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Quick links</div>
        <ul className="divide-y divide-line">
          <HrLink href="/me/pto" glyph="calendar" title="Request time off" sub="Submit a PTO request and track its status" />
          <HrLink href="/resources/handbook" glyph="award" title="Employee Handbook" sub="Read and acknowledge company policies" />
          <HrLink href="/me/profile" glyph="star" title="My profile" sub="Your employee record, certifications, and documents" />
          <HrLink href="/inbox" glyph="megaphone" title="Inbox" sub="Replies to your messages and requests" />
        </ul>
      </Card>
    </>
  );
}

function HrLink({ href, glyph, title, sub }: { href: string; glyph: string; title: string; sub: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
          <Glyph name={glyph} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{title}</span>
          <span className="block text-xs text-muted">{sub}</span>
        </span>
        <span className="shrink-0 text-xs font-medium text-brand-700">Open →</span>
      </Link>
    </li>
  );
}
