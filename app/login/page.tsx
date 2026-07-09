import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in — Clements Inventory" };

export default async function LoginPage() {
  // Already signed in → go straight to the app.
  if (await getSessionUser()) redirect("/dashboard");

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <span className="grid place-items-center h-14 w-14 rounded-2xl bg-brand-600 text-white text-2xl font-bold">
            C
          </span>
          <h1 className="mt-3 text-xl font-semibold text-ink">
            Clements Inventory
          </h1>
          <p className="text-sm text-muted">Manager sign in</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted">
          Sandbox login:{" "}
          <span className="font-medium">manager@clementspest.com</span> /{" "}
          <span className="font-medium">clements123</span>
        </p>
      </div>
    </div>
  );
}
