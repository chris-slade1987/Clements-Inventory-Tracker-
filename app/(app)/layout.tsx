import AppShell from "@/components/AppShell";

// Layout for all authenticated app screens. Auth gating is wired in Prompt 1;
// for now this simply provides the persistent nav shell.
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
