/* Every page links a Google Fonts stylesheet. That request is
   render-blocking, so on a machine with no route to fonts.googleapis.com
   the "load" event never fires and every navigation hangs. The suite
   tests the app, not the CDN, so external requests are stubbed out —
   which also keeps the run hermetic and fast. */

const base = require("@playwright/test");

const test = base.test.extend({
  page: async ({ page }, use) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    await use(page);
  },
});

module.exports = { test, expect: base.expect };
