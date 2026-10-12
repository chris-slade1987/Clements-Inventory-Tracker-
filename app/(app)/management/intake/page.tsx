import { redirect } from "next/navigation";

// Document Intake is now the "Add" tab of the unified Documents page. Keep this
// route working for old links / bookmarks by redirecting to it.
export default function IntakeRedirect() {
  redirect("/management/documents?tab=add");
}
