// SPEC-003 BR-003-07: the Lighthouse CI puppeteer script (collect.puppeteerScript). It runs once
// per URL, before that URL's runs, in the Chrome the runs then use. It does two things:
//
// 1. Signs the route's account in the way the app does (POST /api/auth/login through the BFF,
//    the token kept in localStorage; see e2e/support/session.ts) and leaves the token there, or
//    removes it for a public route, so a public page is never measured signed in.
// 2. Opens the page once, unmeasured, so the measured runs see the server as a visitor does after
//    the first request (Next's route and the database's working set warm), not its cold start.
//
// Lighthouse resets the HTTP cache and the cache/service-worker stores before every run but
// keeps local storage, so each measured run is still a cold-cache load.
'use strict';

const { ACCOUNTS } = require('./accounts.cjs');
const { measuredRoutes } = require('./lighthouse-config.cjs');

const TOKEN_KEY = 'token';

function routeOf(url) {
  const { pathname, search } = new URL(url);
  const route = measuredRoutes().find((candidate) => candidate.path === `${pathname}${search}`);
  if (!route) throw new Error(`perf/login: ${pathname}${search} is not a measured route`);
  return route;
}

module.exports = async function login(browser, { url }) {
  const route = routeOf(url);
  const { origin } = new URL(url);
  const page = await browser.newPage();
  try {
    // Any document of the origin gives access to its local storage; robots.txt is the lightest.
    await page.goto(`${origin}/robots.txt`, { waitUntil: 'load' });
    if (route.as === 'public') {
      await page.evaluate((key) => window.localStorage.removeItem(key), TOKEN_KEY);
    } else {
      const account = ACCOUNTS[route.as];
      if (!account) throw new Error(`perf/login: no seeded account for "${route.as}"`);
      const token = await page.evaluate(async (credentials) => {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(credentials),
        });
        if (!response.ok) throw new Error(`sign-in answered ${response.status}`);
        return (await response.json()).accessToken;
      }, account);
      await page.evaluate(
        (key, value) => window.localStorage.setItem(key, value),
        TOKEN_KEY,
        token,
      );
    }
    // The unmeasured visit.
    await page.goto(url, { waitUntil: 'networkidle0' });
  } finally {
    await page.close();
  }
};
