import OfficePlanPage from '@/app/components/plans/OfficePlanPage';

// SPEC-012 BR-012-11: the office's plan, for any current member. Signed in only; whether the
// caller has an office is the API's answer (FORBIDDEN / SUBSCRIPTION_NOT_FOUND show the empty state).
export default function Page() {
  return <OfficePlanPage />;
}
