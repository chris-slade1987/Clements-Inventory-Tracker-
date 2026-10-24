import { PageHeader, BackLink } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import WeatherSettingsClient from "./WeatherSettingsClient";

// Weather Ops settings — admin only. Rule thresholds, forecast locations, and the
// per-territory fertilizer blackout calendar. requireAdmin() redirects non-admins.
export const dynamic = "force-dynamic";

export default async function WeatherSettingsPage() {
  await requireAdmin();
  return (
    <>
      <BackLink href="/weather">Weather Ops</BackLink>
      <PageHeader title="Weather Ops — settings" subtitle="Rule thresholds, forecast locations, and fertilizer blackout windows" />
      <WeatherSettingsClient />
    </>
  );
}
