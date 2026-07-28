import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/storage";
import {
  jobByApplyToken,
  createCandidate,
  sourceFromChannel,
  notifyNewApplicant,
  sendApplicantConfirmation,
} from "@/lib/ats";

export const runtime = "nodejs";
export const maxDuration = 60;

// PUBLIC — no login. The public job-application "front door": an applicant on a
// per-job apply link (linked from Indeed / the company careers page) submits
// their details + résumé and a Candidate is created in that job's container.
// Intentionally resilient: it never leaks internals in error messages, and the
// HR/supervisor alert + applicant confirmation email are both best-effort (a
// failure there must never fail the application itself).

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_RESUME_EXT = /\.(pdf|doc|docx)$/i;
const ALLOWED_RESUME_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Please submit the application form." }, { status: 400 });
  }

  try {
    const fd = await req.formData();

    // Honeypot: a hidden field real people never fill. If it's set, silently
    // accept and drop as spam (return 200 so bots get no signal).
    if (str(fd.get("website"))) return NextResponse.json({ ok: true });

    const token = str(fd.get("token"));
    const firstName = str(fd.get("firstName"));
    const lastName = str(fd.get("lastName"));
    const phone = str(fd.get("phone"));
    const email = str(fd.get("email"));
    const addressStreet = str(fd.get("addressStreet"));
    const addressCity = str(fd.get("addressCity"));
    const addressState = str(fd.get("addressState"));
    const addressZip = str(fd.get("addressZip"));
    // "Tell us about yourself" — cap at ~250 words server-side (trust nothing
    // from the client). Trim to the first 250 whitespace-separated tokens.
    let about = str(fd.get("about"));
    if (about) {
      const words = about.split(/\s+/);
      if (words.length > 250) about = words.slice(0, 250).join(" ");
    }

    if (!token) return NextResponse.json({ error: "This application link is invalid." }, { status: 400 });
    if (!firstName || !lastName) return NextResponse.json({ error: "Please enter your first and last name." }, { status: 400 });
    if (!phone) return NextResponse.json({ error: "Please enter your best phone number." }, { status: 400 });
    if (!email || !EMAIL_RE.test(email)) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });

    const job = await jobByApplyToken(token);
    if (!job || job.status !== "open") {
      return NextResponse.json({ error: "This position is no longer accepting applications." }, { status: 400 });
    }

    // Résumé is required. Validate type + size before storing.
    const file = fd.get("resume");
    if (!file || typeof file !== "object" || !("arrayBuffer" in file) || (file as File).size === 0) {
      return NextResponse.json({ error: "Please attach your résumé (PDF or Word)." }, { status: 400 });
    }
    const f = file as File;
    if (f.size > MAX_RESUME_BYTES) {
      return NextResponse.json({ error: "That file is too large. Please keep your résumé under 10 MB." }, { status: 400 });
    }
    if (!ALLOWED_RESUME_EXT.test(f.name) && !ALLOWED_RESUME_MIME.has(f.type)) {
      return NextResponse.json({ error: "Please upload a PDF or Word document." }, { status: 400 });
    }

    const buf = Buffer.from(await f.arrayBuffer());
    const resumePath = await saveUpload(buf, f.name, f.type || "application/octet-stream", "resumes");

    const candidate = await createCandidate(
      {
        jobId: job.id,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        email,
        phone,
        source: sourceFromChannel(str(fd.get("src"))),
        resumePath,
        resumeName: f.name,
        addressStreet,
        addressCity,
        addressState,
        addressZip,
        about,
      },
      "Applicant (self-applied)",
    );

    // Best-effort notifications — never fail the application if these throw.
    await notifyNewApplicant(candidate, job).catch(() => {});
    await sendApplicantConfirmation(candidate, job).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch {
    // Never leak internals from a public endpoint.
    return NextResponse.json({ error: "Something went wrong submitting your application. Please try again." }, { status: 500 });
  }
}
