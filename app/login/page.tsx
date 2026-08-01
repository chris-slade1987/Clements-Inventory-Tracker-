import { redirect } from "next/navigation";
import { getSessionUser, homePath } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in — CanopyOS" };

export default async function LoginPage() {
  // Already signed in → go straight to the right home.
  const existing = await getSessionUser();
  if (existing) redirect(homePath(existing));

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10 bg-forest-grad">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/canopyos-wordmark.png" alt="CanopyOS" className="h-12 w-auto" />
          <p className="mt-4 text-sm text-mint">Sign in</p>
        </div>
        <LoginForm />
        <div className="mt-8 flex flex-col items-center gap-1.5">
          <p className="text-[11px] tracking-[0.2em] uppercase text-mint/70">
            Vero Beach · Stuart · Orlando · Naples
          </p>
          <p className="text-[11px] text-mint/55">Clements Internal Platform</p>
          <p className="text-[11px] text-mint/45">© 2026 Clements Pest Control Services</p>
        </div>
      </div>
    </div>
  );
}
