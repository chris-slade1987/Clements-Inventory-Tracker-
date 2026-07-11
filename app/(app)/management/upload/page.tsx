import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import UploadClient from "./UploadClient";

export const dynamic = "force-dynamic";

export default async function UploadMbrPage() {
  await requireAdmin();
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  return (
    <>
      <PageHeader
        title="Upload MBR"
        subtitle="Add a month by uploading the Monthly Board Report. It reads the file, you review, then it updates the dashboard."
      />
      <UploadClient hasKey={hasKey} />
    </>
  );
}
