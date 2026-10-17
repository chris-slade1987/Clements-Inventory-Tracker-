// Default loading skeleton for every authenticated route (rendered inside the
// shell during force-dynamic navigations, so mobile no longer freezes on a blank).
import { PageSkeleton } from "@/components/ui";

export default function Loading() {
  return <PageSkeleton tiles={4} rows={3} />;
}
