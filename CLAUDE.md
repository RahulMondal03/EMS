# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## What this project is

**VoltGrid** — a front-end-only demo of an Electricity Management System (EMS):
metering, billing, payments and complaint handling for a utility, with separate
customer and staff portals.

It is a **college/demo project**, not a production app. Keep that in mind before
proposing architectural upgrades: simplicity and readability for a viva/demo are
deliberate design goals here.

## Critical facts before you touch anything

- **The app itself has no build step, no backend and no framework.** Plain HTML +
  CSS + vanilla ES6 JavaScript loaded with `<script src>` tags. Nothing under
  `ems 9/` is compiled, bundled or transpiled, and the app has no runtime
  dependencies.
- **The repository root does have a `package.json`** — but only for the Playwright
  end-to-end suite in `tests/`. It adds no dependency to the app. See
  [End-to-end tests](#end-to-end-tests) for how to install and run it. There is no
  linter config and no CI workflow.
- **All source lives in the `ems 9/` subdirectory** — note the space in the folder
  name. Always quote paths in shell commands: `cd "ems 9"`, `cat "ems 9/js/data.js"`.
- **All data lives in the browser's `localStorage`**, under the key `ems_data_v2`,
  managed exclusively by `js/data.js`. The signed-in user lives in `sessionStorage`
  under `ems_session`.
- **Passwords are stored in plain text in seed data and localStorage.** This is
  intentional for the demo. Do not "fix" it by adding hashing/crypto unless asked —
  there is no server to do it properly, and it would break the documented demo
  credentials. Do not treat the demo credentials in `README.md` as a secret leak.

## Running it

```bash
cd "ems 9"
python3 -m http.server 8000     # then open http://localhost:8000
```

Or, from the repository root, using the same server the tests use:

```bash
npm run serve                   # then open http://127.0.0.1:4173
```

Double-clicking `index.html` also works, but serving the folder is preferred.

**Verifying a change** means two things: run the end-to-end suite
(`npm run test:e2e`, see below), and open the affected page in a browser to click
through the flow. Nothing needs compiling. To get a browser back to a clean state,
open the console and run `EMS.resetDemo()` (clears localStorage + sessionStorage
and reloads).

## End-to-end tests

The app is covered by a **Playwright** suite that drives a real headless Chromium
through the actual pages. It lives at the **repository root**, not inside
`ems 9/` — the app directory stays dependency-free, and the space in its name
makes it a poor place to put a `node_modules`.

### Install

```bash
npm install                     # installs @playwright/test at the repo root
npx playwright install chromium # downloads the browser (once per machine)
```

`npx playwright install chromium` is a separate step because npm only installs the
Playwright *library*; the browser binary is fetched separately. Skip it if
`PLAYWRIGHT_BROWSERS_PATH` already points at an installed Chromium.

### Run

```bash
npm run test:e2e                # the whole suite, headless
npm run test:e2e -- --headed    # watch it drive a visible browser
npm run test:e2e -- tests/e2e/complaints.spec.js   # one file
npm run test:e2e -- -g "green rooftop"             # one test by name
npm run test:e2e:report         # open the HTML report (written on CI runs)
```

**You do not need to start a server first.** `playwright.config.js` has a
`webServer` block that boots `tests/static-server.js` on port 4173 and waits for
it. Set `PORT` to move it. If a server is already listening there it is reused
(except under `CI=1`, which always starts its own).

### Layout

```
tests/
├── static-server.js            zero-dependency static server over "ems 9/"
└── e2e/
    ├── fixtures.js             the `test`/`expect` every spec imports
    ├── helpers.js              demo credentials + sign-in helpers + store reader
    ├── landing.spec.js         landing page and the shared footer
    ├── auth.spec.js            sign-in, validation, guards, position-based access
    ├── customer-billing.spec.js  bill list, UPI and card checkout, receipts
    ├── complaints.spec.js      file → assign → work → resolve, end to end
    ├── staff.spec.js           position-driven nav, overview, lookup, team admin
    └── billing-engine.spec.js  slab/green tariff maths and bill generation
```

### The three things that will bite you

1. **Import `test` and `expect` from `./fixtures`, never from `@playwright/test`
   directly.** Every page `<head>` links a Google Fonts stylesheet, which is
   render-blocking: on a machine with no route to `fonts.googleapis.com` the
   `load` event never fires and *every* navigation times out at 30s. `fixtures.js`
   aborts all off-origin requests, which fixes that and keeps the run hermetic.
   Getting this wrong does not look like a font problem — it looks like the whole
   suite hanging.
2. **State resets per test, not per file.** Playwright gives each test a fresh
   browser context, so `localStorage` starts empty and `js/data.js` re-seeds the
   demo fixture. Tests therefore always start from the seed data (bills `B9001`–
   `B9003`, complaint `K7001`, customers `C1001`/`C1002`, employees `E501`–`E503`)
   and never need to clean up. Do not write a test that depends on another test
   having run.
3. **Assert on the store, not just the DOM, for anything that mutates.**
   `helpers.js` exports `store(page)`, which reads `ems_data_v2` back out of
   `localStorage`. A green screen with an unwritten record is the failure mode
   worth catching here.

### Conventions

- Sign in with `loginCustomer(page)` / `loginEmployee(page, MANAGER)` from
  `helpers.js` rather than re-filling the login form; the credential constants
  (`CUSTOMER`, `MANAGER`, `AGENT`) live there too.
- Prefer the app's own ids (`#statDue`, `#billRows`, `select[data-assign="K7001"]`)
  as selectors — they are stable and they document which element the app owns.
  Scope loose class selectors to their container: `.badge.unpaid` alone matches
  both a card header and a table row.
- Navigation is `location.href` assignment, so wait for it with
  `page.waitForURL("**/customer/dashboard.html")` rather than a bare click.
- A rejected form is asserted by *staying put* — check the URL is unchanged and
  the store is unmutated, plus `.field.invalid` where the message matters.

### When you change the app

Add or update a spec in the same change. A new page needs at least its guard
tested (signed-out visitor is redirected) and its happy path; a new business rule
in `data.js` needs an assertion on the resulting store.

## Directory layout

```
.
├── CLAUDE.md               this file
├── package.json            devDependency + scripts for the e2e suite ONLY
├── playwright.config.js    Playwright config (starts the static server itself)
├── bubblesort.py           unrelated standalone script
├── tests/
│   ├── static-server.js    zero-dependency static server over "ems 9/"
│   └── e2e/                the Playwright specs
└── ems 9/                  ← the application
    ├── index.html          landing page — two portal cards (Customer, Employee)
    ├── README.md           user-facing overview, demo credentials, demo script
    ├── css/
    │   ├── style.css       design tokens, layout, "liquid glass" theme, forms, topbar
    │   ├── components.css  tables, badges, alerts, timeline, bill summary, footer
    │   └── landing.css     landing page only
    ├── js/
    │   ├── data.js         THE store: all state + all business logic (~410 lines)
    │   ├── chrome.js       shared page furniture: staff nav + site footer
    │   ├── validation.js   reusable form validators (`V`)
    │   ├── customer/       one script per customer page
    │   ├── employee/       one script per employee page
    │   └── admin/          one script per admin-capability page
    ├── customer/           customer-portal HTML pages
    ├── employee/           field/staff HTML pages
    └── admin/              management HTML pages (still the *employee* role)
```

## The one rule that shapes everything

**Every HTML page has exactly one matching JS file with the same name, in the
mirrored `js/` folder.** `admin/billing.html` → `js/admin/billing.js`;
`customer/viewPayBill.html` → `js/customer/viewPayBill.js`.

The only deliberate exception: `js/customer/payment.js` serves **both**
`payment.html` and `paymentSuccess.html`, branching on which DOM elements exist
(`#billSummary` vs `#receipt`).

When adding a page, add both files and keep the names in sync.

## Architecture

### `js/data.js` — the single source of truth

An IIFE exposing one global `EMS` object. Everything else in the app reads and
writes state **only** through it. Never touch `localStorage` for domain data from
a page script.

Internals: `load()` reads (and seeds on first run) the store, `save(data)` writes
it back, `seedData()` returns the demo fixture, `nextIds` drives ID generation.
Entity ID prefixes: customers `C####`, employees `E###`, policies `P#`, bills
`B####`, complaints `K####`, payments `T####`.

Key exported groups:

| Area | Functions |
|---|---|
| Session/guards | `setSession`, `getSession`, `logout`, `requireRole`, `requireEmployee`, `requirePerm` |
| Auth | `loginCustomer`, `loginEmployee` |
| Customers | `getCustomers`, `findCustomer`, `customerByMail`, `addCustomer`, `removeCustomer` |
| Employees | `getEmployees`, `findEmployee`, `addEmployee`, `removeEmployee` |
| Positions/perms | `listPositions`, `positionLabel`, `positionOf`, `tierOf`, `permsOf`, `can`, `assignableEmployees` |
| Policies (tariffs) | `getPolicies`, `addPolicy`, `updatePolicy`, `removePolicy` |
| Billing | `tariffRates`, `computeBill`, `addBill`, `getBills`, `billsForCustomer`, `findBill`, `payBill` |
| Complaints | `getComplaints`, `findComplaint`, `complaintsForCustomer`, `complaintsForEmployee`, `addComplaint`, `assignComplaint`, `updateComplaintStatus` |
| Utilities | `now`, `money`, `badgeClass`, `resetDemo` |

Adding domain behaviour means adding a function in `data.js` **and** exporting it
from the returned object at the bottom — an unexported helper is invisible to pages.

### `js/chrome.js` — shared page furniture

Runs on `DOMContentLoaded` on every page. Two jobs:

1. **Staff navigation.** The employee/admin top bar is *not* hand-written per page.
   A page opts in with `<nav id="vg-nav" data-active="billing"></nav>` and
   `chrome.js` renders the links from `NAV_ITEMS`, filtered by the signed-in
   employee's permissions (`EMS.can`). It also fills `#whoName` / `#whoMeta` and
   wires `#logoutBtn`. **Do not duplicate that code in a staff page script** — the
   scripts carry the comment `// Top bar (name, nav, logout) is built once in js/chrome.js`.
   To add a staff nav link, add an entry to `NAV_ITEMS` with the capability key it
   requires; hrefs there are written relative to a page one folder deep (`../employee/…`).
2. **Site footer**, appended to `<body>` on every page including the landing page.

Customer pages have a **hand-written** `<nav>` in their HTML and set
`#whoName` / `#whoMeta` / `#logoutBtn` themselves — `chrome.js` only builds nav for
the employee role.

### `js/validation.js` — form validation

An IIFE exposing the global `V`. Checks return `true` when valid: `required`,
`email`, `phone` (10-digit Indian mobile), `minLen(n)`, `number`, `positive`,
`cardNumber`, `cvv`, `upiId`, `expiry` (MM/YY, must be future).

Usage pattern, repeated on every form:

```js
const ok = V.validate([
  { id: "email", checks: [[V.required, "Email is required"],
                          [V.email,    "Enter a valid email"]] },
]);
if (!ok) return;
```

`validate()` shows only the first failing message per field. It relies on the
markup shape `<div class="field"> <label> <input id="…"> <div class="error-msg"></div> </div>` —
it adds `.invalid` to the `.field` and writes the message into `.error-msg`. New
form fields must follow that structure. Call `V.liveClear([...ids])` at the bottom
of the script so errors clear as the user types.

## Roles, positions and permissions

There are only **two account kinds: `customer` and `employee`.** There is no admin
login — the `admin/` folder is just employee pages that require higher permissions.

Every employee holds a **position** defining a tier and a set of capability keys
(`POSITIONS` in `data.js`):

| Position | Tier | Capabilities |
|---|---|---|
| Grid Manager | 3 | work, overview, complaints, assign, lookup, billing, customers, policies, employees |
| Supervisor | 2 | work, overview, complaints, assign, lookup, billing, customers |
| Field Agent | 1 | work, lookup |

`DEFAULT_POSITION` is Field Agent. Nav links, page guards and in-page controls all
read from these keys, so granting a capability automatically grants the UI.

**Complaints route downward only:** `assignableEmployees(emp)` returns employees on
a strictly lower tier, so a Grid Manager can assign to supervisors and field agents,
a Supervisor to field agents, a Field Agent to no one.

Every page script starts with a guard, and all page logic sits inside `if (session)`:

```js
// customer page
const session = EMS.requireRole("customer", "login.html");

// any signed-in employee
const session = EMS.requireRole("employee", "login.html");

// employee holding a specific capability
const session = EMS.requirePerm("billing", "../employee/login.html", "../employee/dashboard.html");
```

`requirePerm` sends a signed-out visitor to the login page and an under-privileged
employee to their own dashboard. A new staff page **must** have the matching guard —
the nav hiding a link is not access control.

## Domain rules

**Billing** (`computeBill` in `data.js`) is a pure calculator: units + mode → an
itemised breakdown. Two modes:
- `"standard"` — first `SLAB_LIMIT` (200) units at the Slab A rate, the remainder at Slab B.
- `"green"` — every unit at the flat Green Rooftop rate.

A fixed `SERVICE_CHARGE` (₹50) is added on top; the total is rounded to 2 decimals.
Rates are read **live** from the policy table by `tariffRates()` (matched by id
`P1`/`P2`/`P3`, then by name keyword, with hardcoded fallbacks), so editing a policy
in Policy Management changes what new bills cost. Keep `computeBill` pure — the
billing page calls it on every keystroke to render the live preview and again on
submit before `EMS.addBill()`.

**Complaint lifecycle:** `Open` → `Assigned` → `In Progress` → `Resolved`. Every
transition appends to `complaint.updates[]` (`{ at, what, note }`), which the
customer's complaint-status page and the employee's detail page render as a
timeline. Removing an employee unassigns their unresolved complaints back to `Open`.

**Bill/payment:** bills are `Unpaid` or `Paid`. `payBill(billId, method)` flips the
bill and records a payment; it returns `null` for a missing or already-paid bill.

**Payment checkout hand-off** uses `sessionStorage` (not query params):
`viewPayBill` writes `ems_pending_bill` → `payment.html` reads it → UPI pays inline,
Card goes to `cardDetails.html` → both write `ems_last_payment` and clear
`ems_pending_bill` → `paymentSuccess.html` renders the receipt from it. Pages opened
without the expected key redirect back rather than erroring.

Complaint pages hand off with a query param instead: `updateStatus.html?id=K7001`,
read via `new URLSearchParams(location.search).get("id")`.

## Coding conventions

- **Vanilla ES6 only.** No frameworks, no bundler, no imports/modules, no `npm`
  dependencies. The only external resource is the Google Fonts stylesheet (Sora +
  Inter) linked in every page `<head>`.
- **Globals by design:** `EMS` (data.js), `V` (validation.js). Page scripts run in
  global scope and commonly declare `const session` / `const me` at the top.
- **Rendering is template-literal HTML strings assigned to `innerHTML`.** Tables
  build rows with `.map(...).join("")` and fall back with `||` to an empty-state row:
  ```js
  rows.innerHTML = list.map(x => `<tr>…</tr>`).join("") ||
    `<tr class="empty"><td colspan="6">Nothing here yet.</td></tr>`;
  ```
  Keep `colspan` in sync with the `<thead>` column count.
- **Event delegation** for anything inside a rendered table: one listener on the
  `<tbody>`, using `e.target.closest("button[data-del]")` and `dataset` attributes
  (`data-bill`, `data-del`, `data-edit`, `data-assign`). Don't attach listeners
  per row — they die on the next re-render.
- Re-render by calling the page's local `render()` after any mutation; there is no
  reactivity.
- Format money with `EMS.money(n)` (₹ + 2 decimals) and timestamps with `EMS.now()`
  (`YYYY-MM-DD HH:MM`). Never format either by hand.
- Status badges: `<span class="badge ${EMS.badgeClass(status)}">${status}</span>`.
  `badgeClass` lowercases and hyphenates, so the status string must match a class in
  `components.css`: `open`, `assigned`, `in-progress`, `resolved`, `paid`, `unpaid`,
  `overdue`. Adding a status means adding its badge rule too.
- Inline alerts: an `<div id="alert" class="alert success">` already in the markup;
  set `.textContent` / `.innerHTML` then `alert.classList.add("show")` (it is hidden
  until `.show`). Use `confirm()` for destructive actions — the codebase already does.
- **Comment style matters here.** Every file opens with a `/* … */` banner saying what
  it does and why; non-obvious logic gets a short explanatory comment in plain prose.
  Match that tone — this project is read by examiners as much as run.
- Naming: `camelCase` for JS and file names (`viewPayBill.js`, `complaintManagement.js`),
  `kebab-case` for CSS classes, short DOM ids used directly as validation rule ids.

## CSS

Three stylesheets, all hand-written plain CSS with no preprocessor:
- `style.css` — design tokens in `:root` (`--accent` emerald `#2e7d32`, `--ink`,
  `--glass-fill`, `--glass-blur`, `--glass-shadow`, `--radius`, font vars), the
  aurora background, the "liquid glass" surface recipe, layout (`.page`, `.grid`,
  `.cols-2`), the top bar and form fields.
- `components.css` — `.glass-table`, `.badge`, `.alert`, `.timeline`,
  `.bill-summary`, `.method-pick`, `.card-preview`, `.site-footer`.
- `landing.css` — landing page only.

Reuse the tokens and existing classes (`.glass`, `.btn`/`.btn-primary`/`.btn-ghost`/
`.btn-danger`/`.btn-sm`, `.muted`, `.eyebrow`, `.field`, `.table-wrap`) rather than
introducing new colors or one-off components. Page HTML does use occasional inline
`style="…"` for small layout tweaks; that's accepted, but prefer a class when the
same tweak appears more than once.

## Adding a new page — checklist

1. Create `<area>/<name>.html`; copy the `<head>` (fonts + `style.css` +
   `components.css`) and the topbar block from a sibling page.
2. Staff page: use `<nav id="vg-nav" data-active="<capability-key>"></nav>` and let
   `chrome.js` fill it. Customer page: hand-write the four-link `<nav>`.
3. Script tags at the end of `<body>`, in this order:
   `../js/data.js`, `../js/chrome.js`, `../js/validation.js` (only if the page has a
   form), then `../js/<area>/<name>.js` last.
4. Create `js/<area>/<name>.js` starting with the appropriate `EMS.requireRole` /
   `EMS.requirePerm` guard, with all logic inside `if (session)`.
5. New capability? Add the key to the relevant positions' `perms` in `data.js` and a
   `NAV_ITEMS` entry in `chrome.js`.
6. New state or business rule? Put it in `data.js` and export it — not in the page.
7. Update `ems 9/README.md` if the change affects the demo script, roles table or
   credentials.
8. Add a spec under `tests/e2e/` covering the page's guard and its happy path, and
   run `npm run test:e2e`.

## Demo credentials (from `README.md`)

| Role | Position | Email | Password |
|---|---|---|---|
| Customer | — | anita@example.com | anita123 |
| Customer | — | ravi@example.com | ravi123 |
| Employee | Grid Manager | suresh@voltgrid.com | suresh123 |
| Employee | Supervisor | priya@voltgrid.com | priya123 |
| Employee | Field Agent | arjun@voltgrid.com | arjun123 |

## Known rough edges (don't "fix" without being asked)

- Rendered values are interpolated straight into `innerHTML` without escaping — XSS
  is possible in principle, but there is no server or other user to attack in a
  local demo.
- Plain-text passwords (see above).
- `js/admin/employeeManagement.js` sets `#whoName` and the logout handler itself,
  duplicating `chrome.js`. Harmless, but if you touch that file, prefer deleting the
  duplication over copying it elsewhere.
- `load()`/`save()` re-read and rewrite the whole store on every call. Fine at this
  data size; don't optimise it.
- The store key is `ems_data_v2`. If you change the shape of seed data in a way that
  breaks existing saved state, bump the key (there is no migration logic) and say so.
