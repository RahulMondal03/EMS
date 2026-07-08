# VoltGrid — Electricity Management System (demo)

A front-end-only demo built with plain HTML, CSS and JavaScript.
No frameworks, no build step, no backend — data lives in `localStorage`
via the shared store in `js/data.js`.

## Run it
Open `index.html` in a browser. (For best results serve the folder,
e.g. `python -m http.server`, but double-clicking works too.)

## How the code is organised (quick map for the viva)
The project is deliberately simple: every page is an HTML file with its
own small JavaScript file, and they all share one data file.

- `index.html` — the landing page with the two portals (Customer, Employee).
- `css/` — all styling. `style.css` (layout + theme), `components.css`
  (buttons, tables, cards, the footer) and `landing.css` (landing page).
- `js/data.js` — **the heart of the app.** One object called `EMS` that
  holds every piece of data (customers, employees, bills, complaints…)
  and every function that reads or changes it. Data is saved in the
  browser's `localStorage`, so it survives refreshes. Positions and
  their permissions are defined here too.
- `js/chrome.js` — shared page furniture. It builds the staff top-bar
  menu **from the signed-in employee's position** (so each person only
  sees the links they're allowed to) and adds the footer to every page.
  This is why the individual staff pages don't repeat that code.
- `js/validation.js` — tiny form-validation helper used by the forms.
- `customer/`, `employee/`, `admin/` — the actual pages. Each `.html`
  page has a matching `.js` file in `js/<folder>/` with the same name.

A typical page script does three things: (1) check who is logged in
with `EMS.requireRole` / `EMS.requirePerm`, (2) read data from `EMS`,
(3) build the table rows as HTML text and drop them into the page.

## Roles

There are just **two kinds of account: Customer and Employee.** There is no
separate admin login — administrative power lives inside the employee role and
is decided by each employee's **position**:

| Position     | Tier | Can do                                                                                     |
|--------------|------|--------------------------------------------------------------------------------------------|
| Grid Manager | 3    | Everything: tariffs/policies, billing, customers, staff, the complaint board, and routing complaints down to anyone below. |
| Supervisor   | 2    | Billing, customers, the complaint board, and routing complaints down to field agents. No policy or staff management. |
| Field Agent  | 1    | Works only the complaints assigned to them, plus customer lookup.                          |

The navigation, page guards and buttons are all driven by the position, so each
person only sees the links and controls their position allows. Complaints can
only be routed **downward**: a Grid Manager can assign to supervisors and field
agents, a Supervisor can assign to field agents, and a Field Agent cannot assign
at all. Positions are hardcoded in the seed data and can be set when adding new
staff on the **Team** page.

## Demo credentials
| Role     | Position      | Email                | Password  |
|----------|---------------|----------------------|-----------|
| Customer | —             | anita@example.com    | anita123  |
| Customer | —             | ravi@example.com     | ravi123   |
| Employee | Grid Manager  | suresh@voltgrid.com  | suresh123 |
| Employee | Supervisor    | priya@voltgrid.com   | priya123  |
| Employee | Field Agent   | arjun@voltgrid.com   | arjun123  |

## Demo script (complaint lifecycle)
1. **Customer** logs in → *New complaint* → submit.
2. **Grid Manager / Supervisor** logs in → *Complaints* → pick a lower-tier
   employee in the "Assign to" dropdown.
3. **Field Agent** (the assignee) logs in → *My work* shows the complaint →
   *Update* → set "Resolved" with a note.
4. **Customer** opens *My complaints* → sees the full timeline, note included.

Payments: *Bills → Pay now → Card or UPI → success receipt* (bill flips to Paid).

## Generating bills (Grid Manager or Supervisor)
Employee (with billing access) → **Billing** → pick a customer, enter the metered units and a tariff
mode (Standard slabs or Green rooftop). VoltGrid applies the slab rates from
Policy Management, shows a live itemised breakdown, and creates an Unpaid bill
that appears instantly on the customer's Bills page and dashboard.

Billing rule (tiered slabs): first 200 units at the Slab A rate, the rest at
Slab B; Green rooftop bills at the flat green rate. A fixed ₹50 service charge
is added on top. Edit any rate in Policy Management and new bills follow it.



## Reset the demo data
Open the browser console and run: `EMS.resetDemo()`
