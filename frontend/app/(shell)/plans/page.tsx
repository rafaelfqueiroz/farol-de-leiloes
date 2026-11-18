import PlansPage from '@/app/components/plans/PlansPage';

// SPEC-012 BR-012-05: the plans page is PUBLIC (owner decision 11): a visitor sees the catalogue and
// is asked to sign in to subscribe. The one switch is this folder: it lives in `(shell)`, which has
// the guest top bar; moving it into `(shell)/(authenticated)` (which adds `RequireAuthentication`)
// makes it private again, and nothing else changes. DESIGN.md §6.
export default function Page() {
  return <PlansPage />;
}
