import { redirect } from "next/navigation";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAccessRights, getLevelGrants, getUserOverrides, listManageableUsers } from "@/lib/access";
import AccessRightsClient from "./AccessRightsClient";

export const dynamic = "force-dynamic";

export default async function AccessRightsPage() {
  const user = await requireUser();
  if (!canManageAccessRights(user)) redirect(homePath(user));

  const [levelGrants, overrides, users] = await Promise.all([
    getLevelGrants(),
    getUserOverrides(),
    listManageableUsers(),
  ]);

  return (
    <AccessRightsClient
      levelGrants={levelGrants}
      overrides={overrides}
      users={users}
      me={user.name}
    />
  );
}
