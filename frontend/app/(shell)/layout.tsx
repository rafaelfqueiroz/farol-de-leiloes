import type { ReactNode } from 'react';
import AppShell from '@/app/components/patterns/AppShell';

// #42 (DESIGN.md §6): one AppShell for every page in the group, never mounted per page. It is
// guest-capable, so the public auction detail shows the guest top bar to visitors and the full
// navigation to signed-in users.
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
