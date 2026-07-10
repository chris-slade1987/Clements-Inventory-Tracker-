import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in — Clements Inventory" };

export default async function LoginPage() {
  // Already signed in → go straight to the app.
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10 bg-forest-grad">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <span className="grid place-items-center h-14 w-14 rounded-2xl bg-emerald-grad text-[#05271c] text-2xl font-semibold shadow-xl shadow-brand-600/40">
            C
          </span>
          <h1 className="mt-4 text-2xl font-light tracking-tight text-white">
            Clements Inventory
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
