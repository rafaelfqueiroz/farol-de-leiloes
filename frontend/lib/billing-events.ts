// SPEC-012 owner decision 1: the billing notice is in the shell on every page AND on the office
// plan page. The page changes the plan (a change, a cancellation, an undo); this is how the shell's
// notice learns it must read the plan again, without a provider or a shared store for one fact.
const listeners = new Set<() => void>();

/** The office's plan changed or may have: whoever shows it should read it again. */
export function notifyBillingChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Subscribes to `notifyBillingChanged`; returns the unsubscribe function. */
export function onBillingChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
