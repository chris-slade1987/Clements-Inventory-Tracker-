import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import ChangePasswordForm from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="My Account" subtitle={`Signed in as ${user.email}`} />
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Change password</div>
      <ChangePasswordForm />
    </>
  );
}
