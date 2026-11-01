import type { ReactNode } from 'react';
import RequireAuthentication from '@/app/components/RequireAuthentication';

// #42: the signed-in pages share one authentication guard; each page keeps its own RequireRole
// or admin check.
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <RequireAuthentication>{children}</RequireAuthentication>;
}
