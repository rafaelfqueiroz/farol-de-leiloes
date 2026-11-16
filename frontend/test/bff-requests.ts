// Shared by the BFF tests (SC-02): a browser request to a route handler carries the site's own
// `Origin` on a state-changing call and the session cookie when signed in. The tests run with
// NODE_ENV=test, so the cookie has its plain, non-production name.
import { PLAIN_SESSION_COOKIE } from '@/lib/session-cookie';

/** `NEXT_PUBLIC_SITE_URL`'s default, which the tests run with. */
export const SITE_ORIGIN = 'https://faroldosleiloes.com.br';

/** Headers of a same-site browser request. */
export const sameSite = { Origin: SITE_ORIGIN };

/** The header a browser sends once signed in; the token is whatever the test passes. */
export const sessionCookie = (token = 'token-a') => ({
  Cookie: `${PLAIN_SESSION_COOKIE}=${token}`,
});

/** A signed-in, same-site browser request. */
export const signedInSameSite = { ...sameSite, ...sessionCookie() };
