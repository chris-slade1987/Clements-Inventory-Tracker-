import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import GpsSetupClient from "./GpsSetupClient";

export const dynamic = "force-dynamic";

// Admin-only GPS integration setup/diagnostics: see the live REST test + stored
// webhook events, and complete the Verizon subscription (visit the SubscribeURL).
export default async function GpsSetupPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/fleet");
  return (
    <>
      <PageHeader title="GPS Setup & Diagnostics" subtitle="Verizon Connect Reveal — connection test + subscription confirmation" />
      <GpsSetupClient />
    </>
  );
}
