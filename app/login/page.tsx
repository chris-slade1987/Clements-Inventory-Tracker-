import { redirect } from "next/navigation";
import { getSessionUser, homePath } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in — Clements Command & Control" };

export default async function LoginPage() {
  // Already signed in → go straight to the right home.
  const existing = await getSessionUser();
  if (existing) redirect(homePath(existing));

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10 bg-forest-grad">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clements-mark.svg" alt="Clements" className="h-16 w-16" />
          <h1 className="mt-4 text-2xl font-light tracking-tight text-white">
            Clements Command &amp; Control
          </h1>
          <p className="text-sm text-mint">Manager sign in</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-[11px] tracking-widest uppercase text-mint/80">
          Vero Beach · Stuart · Orlando · Naples
        </p>
      </div>
    </div>
  );
}
