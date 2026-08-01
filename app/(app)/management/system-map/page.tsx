import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { getSystemMap, interconnectionMermaid, processFlows } from "@/lib/system-map";
import SystemMapClient from "./SystemMapClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "System Map — Canopy OS" };

export default async function SystemMapPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(user.role === "admin" || user.seniorLeadership)) redirect("/management");

  const domains = getSystemMap();

  return (
    <>
      <PageHeader
        title="System Map"
        subtitle="A living process map auto-generated from the portal's own workflow registry (docs/WORKFLOWS.md). Admin & senior leadership only."
      />
      <SystemMapClient
        domains={domains}
        interconnection={interconnectionMermaid()}
        flows={processFlows}
      />
    </>
  );
}
