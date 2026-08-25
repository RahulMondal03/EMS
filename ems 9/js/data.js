/* ============================================================
   data.js — single source of truth for the whole demo.
   Data lives in localStorage so it survives page navigation
   and reloads during the presentation. Call EMS.resetDemo()
   from the console to restore the seed data at any time.
   ============================================================ */

const EMS = (() => {

  const STORE_KEY = "ems_data_v2";   // bumped: v1 had no employee positions

  /* ---------- Roles & positions ----------
     There are only two kinds of account: customers and employees.
     Every employee holds a POSITION, and the position decides what
     that person can see and do. Positions are tiered:

       Grid Manager (tier 3) — full control of the grid. Sets tariffs,
         generates bills, manages customers and staff, sees the whole
         complaint board, and routes complaints down to anyone below.
       Supervisor  (tier 2) — runs day-to-day operations: billing,
         customer accounts and the complaint board, and can assign
         complaints down to field agents.
       Field Agent (tier 1) — works the complaints assigned to them
         and looks up customer accounts in the field.

     A position grants a set of capability keys (see PERMS below). The
     nav, page guards and buttons all read from these keys, so power
     follows the position automatically.                              */
  const POSITIONS = {
    "Grid Manager": {
      tier: 3,
      perms: ["work", "overview", "complaints", "assign", "lookup",
              "billing", "customers", "policies", "employees"],
    },
    "Supervisor": {
      tier: 2,
      perms: ["work", "overview", "complaints", "assign", "lookup",
              "billing", "customers"],
    },
    "Field Agent": {
      tier: 1,
      perms: ["work", "lookup"],
    },
  };
  const DEFAULT_POSITION = "Field Agent";

  /* ---------- Seed data (used on first load / after reset) ---------- */
  function seedData() {
    return {
      customers: [
        { id: "C1001", name: "Anita Menon",  email: "anita@example.com",  phone: "9876543210",
          address: "12 Palm Grove, Kochi", meterNo: "MTR-58291", password: "anita123" },
        { id: "C1002", name: "Ravi Kumar",   email: "ravi@example.com",   phone: "9812345678",
          address: "44 Lake View, Trivandrum", meterNo: "MTR-77410", password: "ravi123" },
      ],

      employees: [
        { id: "E501", name: "Suresh Nair", email: "suresh@voltgrid.com", phone: "9900112233",
          dept: "Field Operations", position: "Grid Manager", password: "suresh123" },
        { id: "E502", name: "Priya Das",   email: "priya@voltgrid.com",  phone: "9900445566",
          dept: "Billing Support",  position: "Supervisor",   password: "priya123" },
        { id: "E503", name: "Arjun Rao",   email: "arjun@voltgrid.com",  phone: "9900778899",
          dept: "Line Maintenance", position: "Field Agent",  password: "arjun123" },
      ],

      policies: [
        { id: "P1", name: "Domestic — Slab A (0–200 units)", ratePerUnit: 4.5,
          description: "Standard household tariff for monthly usage up to 200 units." },
        { id: "P2", name: "Domestic — Slab B (201–500 units)", ratePerUnit: 6.25,
          description: "Household tariff for monthly usage between 201 and 500 units." },
        { id: "P3", name: "Green Rooftop Rebate", ratePerUnit: 3.75,
          description: "Discounted rate for homes with registered rooftop solar panels." },
      ],

      bills: [
        { id: "B9001", customerId: "C1001", month: "May 2026",  units: 182, amount: 819.0,
          dueDate: "2026-06-15", status: "Paid" },
        { id: "B9002", customerId: "C1001", month: "June 2026", units: 214, amount: 1237.5,
          dueDate: "2026-07-15", status: "Unpaid" },
        { id: "B9003", customerId: "C1002", month: "June 2026", units: 158, amount: 711.0,
          dueDate: "2026-07-15", status: "Unpaid" },
      ],

      complaints: [
        { id: "K7001", customerId: "C1002", type: "Power outage",
          description: "Frequent power cuts in Lake View area every evening after 7 pm.",
          status: "Open", assignedTo: null, createdAt: "2026-06-28 10:14",
          updates: [ { at: "2026-06-28 10:14", what: "Complaint registered", note: "" } ] },
      ],

      payments: [
        { id: "T3001", billId: "B9001", customerId: "C1001", amount: 819.0,
          method: "Card", date: "2026-06-10 18:22" },
      ],

      nextIds: { customer: 1003, employee: 504, policy: 4, bill: 9004, complaint: 7002, payment: 3002 },
    };
  }

  /* ---------- Load / save ---------- */
  function load() {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
    const fresh = seedData();
    localStorage.setItem(STORE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function save(data) {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  }

  function resetDemo() {
    localStorage.removeItem(STORE_KEY);
    sessionStorage.clear();
    location.reload();
  }

  /* ---------- Small utilities ---------- */
  const now = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const money = (n) => "₹" + Number(n).toFixed(2);

  /* ---------- Integer-list helpers ----------
     Numbers reach the store from form fields, from older records and
     from hand-edited localStorage, so a "list of units" is not
     guaranteed to hold whole numbers. validateIntegerList() sorts a
     list into the entries that really are integers and the ones that
     are not, so callers can reject or report the bad entries instead
     of letting a "1.5" or an "abc" turn a total into NaN.
     Accepts an array or a single string of separated values:
       validateIntegerList("120, 60, x")
         -> { ok: false, integers: [120, 60], invalid: ["x"] }        */
  const listEntries = (values) => {
    if (Array.isArray(values)) return values;
    if (values === null || values === undefined) return [];
    return String(values).split(/[\s,;]+/).filter((s) => s !== "");
  };

  function validateIntegerList(values) {
    const integers = [];
    const invalid  = [];
    listEntries(values).forEach((v) => {
      const raw = typeof v === "number" ? v : String(v).trim();
      const n   = typeof raw === "number" ? raw : Number(raw);
      if (raw === "" || !Number.isInteger(n)) invalid.push(v);
      else integers.push(n);
    });
    return { ok: invalid.length === 0, integers, invalid };
  }

  /* Total of the whole numbers in a list. Non-integer entries are left
     out rather than poisoning the sum with NaN. */
  const sumIntegers = (values) =>
    validateIntegerList(values).integers.reduce((a, b) => a + b, 0);

  const nextId = (kind, prefix) => {
    const d = load();
    const id = prefix + d.nextIds[kind];
    d.nextIds[kind] += 1;
    save(d);
    return id;
  };

  /* ---------- Session (who is logged in) ---------- */
  function setSession(role, id, name) {
    sessionStorage.setItem("ems_session", JSON.stringify({ role, id, name }));
  }
  function getSession() {
    const raw = sessionStorage.getItem("ems_session");
    return raw ? JSON.parse(raw) : null;
  }
  function logout(toLogin) {
    sessionStorage.removeItem("ems_session");
    location.href = toLogin;
  }
  /* Redirect to login if the visitor is not signed in with the right role. */
  function requireRole(role, loginPage) {
    const s = getSession();
    if (!s || s.role !== role) { location.href = loginPage; return null; }
    return s;
  }

  /* Require a signed-in employee (any position). */
  function requireEmployee(loginPage) {
    return requireRole("employee", loginPage);
  }

  /* Require an employee who holds a specific capability. Not signed in
     → login page; signed in but lacking the capability → their own
     dashboard (so a field agent can't reach a manager-only screen).  */
  function requirePerm(perm, loginPage, dashPage) {
    const s = requireEmployee(loginPage);
    if (!s) return null;
    const emp = findEmployee(s.id);
    if (!emp || !can(emp, perm)) { location.href = dashPage; return null; }
    return s;
  }

  /* ---------- Auth ---------- */
  function loginCustomer(email, password) {
    return load().customers.find(c => c.email === email && c.password === password) || null;
  }
  function loginEmployee(email, password) {
    return load().employees.find(e => e.email === email && e.password === password) || null;
  }

  /* ---------- Customers ---------- */
  const getCustomers   = () => load().customers;
  const findCustomer   = (id) => load().customers.find(c => c.id === id) || null;
  const customerByMail = (email) => load().customers.find(c => c.email === email) || null;

  function addCustomer(cust) {
    const d = load();
    cust.id = "C" + d.nextIds.customer;
    cust.meterNo = cust.meterNo || ("MTR-" + Math.floor(10000 + Math.random() * 89999));
    d.nextIds.customer += 1;
    d.customers.push(cust);
    save(d);
    return cust;
  }
  function removeCustomer(id) {
    const d = load();
    d.customers = d.customers.filter(c => c.id !== id);
    save(d);
  }

  /* ---------- Employees ---------- */
  const getEmployees = () => load().employees;
  const findEmployee = (id) => load().employees.find(e => e.id === id) || null;

  /* ----- Position & permissions ----- */
  const listPositions = () => Object.keys(POSITIONS);
  const positionLabel = (emp) => (emp && emp.position) ? emp.position : DEFAULT_POSITION;
  const positionOf    = (emp) => POSITIONS[positionLabel(emp)] || POSITIONS[DEFAULT_POSITION];
  const tierOf        = (emp) => positionOf(emp).tier;
  const permsOf       = (emp) => positionOf(emp).perms;
  const can           = (emp, perm) => permsOf(emp).includes(perm);

  /* Employees this person is allowed to route complaints to: anyone on
     a strictly lower tier. A Grid Manager reaches supervisors and field
     agents; a Supervisor reaches field agents; a Field Agent, no one.  */
  function assignableEmployees(emp) {
    if (!emp || !can(emp, "assign")) return [];
    const myTier = tierOf(emp);
    return load().employees.filter(e => e.id !== emp.id && tierOf(e) < myTier);
  }

  function addEmployee(emp) {
    const d = load();
    emp.id = "E" + d.nextIds.employee;
    emp.position = POSITIONS[emp.position] ? emp.position : DEFAULT_POSITION;
    d.nextIds.employee += 1;
    d.employees.push(emp);
    save(d);
    return emp;
  }
  function removeEmployee(id) {
    const d = load();
    d.employees = d.employees.filter(e => e.id !== id);
    /* unassign this employee from any open complaints */
    d.complaints.forEach(k => { if (k.assignedTo === id && k.status !== "Resolved") { k.assignedTo = null; k.status = "Open"; } });
    save(d);
  }

  /* ---------- Policies ---------- */
  const getPolicies = () => load().policies;

  function addPolicy(p) {
    const d = load();
    p.id = "P" + d.nextIds.policy;
    d.nextIds.policy += 1;
    d.policies.push(p);
    save(d);
  }
  function updatePolicy(id, fields) {
    const d = load();
    const p = d.policies.find(x => x.id === id);
    if (p) Object.assign(p, fields);
    save(d);
  }
  function removePolicy(id) {
    const d = load();
    d.policies = d.policies.filter(p => p.id !== id);
    save(d);
  }

  /* ---------- Bills & payments ---------- */
  const getBills = () => load().bills;
  const billsForCustomer = (customerId) => load().bills.filter(b => b.customerId === customerId);
  const findBill = (id) => load().bills.find(b => b.id === id) || null;

  /* ---------- Billing engine ----------
     Bills are generated from metered consumption using tiered slab
     tariffs. The slab rates are read live from the policy table, so
     editing a policy in Policy Management changes what new bills cost.
     Two modes:
       "standard" — first 200 units at Slab A, the rest at Slab B.
       "green"    — flat Green Rooftop rate for solar homes.
     A fixed monthly service charge is added on top of energy usage.  */
  const SLAB_LIMIT     = 200;   // units before the higher slab kicks in
  const SERVICE_CHARGE = 50;    // fixed ₹/month connection charge

  /* Pull the three tariff rates from policies, matched by id first and
     then by keyword, with sensible fallbacks if a policy was removed. */
  function tariffRates() {
    const ps = load().policies;
    const byId = (id) => ps.find(p => p.id === id);
    const byWord = (w) => ps.find(p => p.name.toLowerCase().includes(w));
    const rate = (p, fb) => (p ? Number(p.ratePerUnit) : fb);
    return {
      slabA: rate(byId("P1") || byWord("slab a"), 4.5),
      slabB: rate(byId("P2") || byWord("slab b"), 6.25),
      green: rate(byId("P3") || byWord("green"),  3.75),
    };
  }

  /* Pure calculator: units + mode -> an itemised breakdown.
     `units` may be a single value or a list of meter readings, either
     as an array ([120, 60]) or as one separated string ("120, 60").
     Every reading has to be a whole number of units: fractions, blanks,
     text and negative readings are refused, reported back in `invalid`
     and left out of the total instead of skewing the bill.
     Returns { units, readings, invalid, unitsValid, mode,
               lines:[{label,amount}], energy, serviceCharge, total,
               rates }.                                             */
  function computeBill(units, mode) {
    const checked  = validateIntegerList(units);
    const readings = checked.integers.filter((n) => n >= 0);
    const invalid  = checked.invalid.concat(checked.integers.filter((n) => n < 0));

    units = readings.reduce((a, b) => a + b, 0);
    const r = tariffRates();
    const lines = [];
    let energy = 0;

    if (mode === "green") {
      energy = units * r.green;
      lines.push({ label: `${units} units × ₹${r.green.toFixed(2)} · Green rooftop`, amount: energy });
    } else {
      const t1 = Math.min(units, SLAB_LIMIT);
      const t2 = Math.max(0, units - SLAB_LIMIT);
      if (t1 > 0) {
        const amt = t1 * r.slabA;
        energy += amt;
        lines.push({ label: `${t1} units × ₹${r.slabA.toFixed(2)} · Slab A`, amount: amt });
      }
      if (t2 > 0) {
        const amt = t2 * r.slabB;
        energy += amt;
        lines.push({ label: `${t2} units × ₹${r.slabB.toFixed(2)} · Slab B`, amount: amt });
      }
      if (units === 0) lines.push({ label: "No consumption recorded", amount: 0 });
    }

    const total = energy + SERVICE_CHARGE;
    return { units, readings, invalid, unitsValid: invalid.length === 0,
             mode: mode || "standard", lines, energy,
             serviceCharge: SERVICE_CHARGE, total: Math.round(total * 100) / 100, rates: r };
  }

  /* Create a bill for a customer. Pass { customerId, month, units,
     amount, dueDate }; id and Unpaid status are filled in here.     */
  function addBill(bill) {
    /* Last line of defence: a bill is metered in whole units, so refuse
       anything a form (or a caller) let through as a fraction or text. */
    const checked = validateIntegerList([bill.units]);
    if (!checked.ok || checked.integers[0] < 0)
      throw new TypeError("addBill: units must be a whole number, got " + JSON.stringify(bill.units));
    bill.units = checked.integers[0];

    const d = load();
    bill.id = "B" + d.nextIds.bill;
    bill.status = bill.status || "Unpaid";
    d.nextIds.bill += 1;
    d.bills.push(bill);
    save(d);
    return bill;
  }

  /* Marks a bill as paid and records the transaction. Returns the payment. */
  function payBill(billId, method) {
    const d = load();
    const bill = d.bills.find(b => b.id === billId);
    if (!bill || bill.status === "Paid") return null;
    bill.status = "Paid";
    const payment = {
      id: "T" + d.nextIds.payment,
      billId: bill.id,
      customerId: bill.customerId,
      amount: bill.amount,
      method,
      date: now(),
    };
    d.nextIds.payment += 1;
    d.payments.push(payment);
    save(d);
    return payment;
  }

  /* ---------- Complaints ---------- */
  const getComplaints = () => load().complaints;
  const findComplaint = (id) => load().complaints.find(k => k.id === id) || null;
  const complaintsForCustomer = (cid) => load().complaints.filter(k => k.customerId === cid);
  const complaintsForEmployee = (eid) => load().complaints.filter(k => k.assignedTo === eid);

  function addComplaint(customerId, type, description) {
    const d = load();
    const k = {
      id: "K" + d.nextIds.complaint,
      customerId, type, description,
      status: "Open", assignedTo: null, createdAt: now(),
      updates: [{ at: now(), what: "Complaint registered", note: "" }],
    };
    d.nextIds.complaint += 1;
    d.complaints.push(k);
    save(d);
    return k;
  }

  /* Admin action: hand a complaint to an employee. */
  function assignComplaint(complaintId, employeeId) {
    const d = load();
    const k = d.complaints.find(x => x.id === complaintId);
    const e = d.employees.find(x => x.id === employeeId);
    if (!k || !e) return;
    k.assignedTo = employeeId;
    k.status = "Assigned";
    k.updates.push({ at: now(), what: "Assigned to " + e.name, note: "" });
    save(d);
  }

  /* Employee action: move the complaint along its lifecycle. */
  function updateComplaintStatus(complaintId, status, note) {
    const d = load();
    const k = d.complaints.find(x => x.id === complaintId);
    if (!k) return;
    k.status = status;
    k.updates.push({ at: now(), what: "Status changed to " + status, note: note || "" });
    save(d);
  }

  /* Turn a status string into the matching badge CSS class. */
  const badgeClass = (status) => status.toLowerCase().replace(/\s+/g, "-");

  /* ---------- Public API ---------- */
  return {
    resetDemo, now, money, badgeClass,
    validateIntegerList, sumIntegers,
    setSession, getSession, logout, requireRole, requireEmployee, requirePerm,
    loginCustomer, loginEmployee,
    getCustomers, findCustomer, customerByMail, addCustomer, removeCustomer,
    getEmployees, findEmployee, addEmployee, removeEmployee,
    listPositions, positionLabel, positionOf, tierOf, permsOf, can, assignableEmployees,
    getPolicies, addPolicy, updatePolicy, removePolicy,
    getBills, billsForCustomer, findBill, payBill,
    tariffRates, computeBill, addBill,
    getComplaints, findComplaint, complaintsForCustomer, complaintsForEmployee,
    addComplaint, assignComplaint, updateComplaintStatus,
  };
})();
