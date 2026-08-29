/* admin/billing.js — generate a bill from metered units.
   Units + tariff mode run through EMS.computeBill(), which applies the
   slab rates from Policy Management, then EMS.addBill() records it. */

const session = EMS.requirePerm("billing", "../employee/login.html", "../employee/dashboard.html");
if (session) {

  // Top bar (name, nav, logout) is built once in js/chrome.js

  const customerSel = document.getElementById("customer");
  const monthInput  = document.getElementById("month");
  const unitsInput  = document.getElementById("units");
  const dueInput    = document.getElementById("due");
  const preview     = document.getElementById("preview");
  const recentRows  = document.getElementById("recentRows");
  const alert       = document.getElementById("alert");

  /* ---------- Defaults ---------- */
  /* Populate the customer dropdown */
  customerSel.insertAdjacentHTML("beforeend",
    EMS.getCustomers().map(c =>
      `<option value="${c.id}">${EMS.esc(c.name)} · ${c.id} · ${EMS.esc(c.meterNo)}</option>`).join(""));

  /* Default month = current month + year, e.g. "July 2026" */
  const d = new Date();
  monthInput.value = d.toLocaleString("en-US", { month: "long" }) + " " + d.getFullYear();

  /* Default due date = 21 days out */
  const due = new Date(d.getTime() + 21 * 864e5);
  dueInput.value = due.toISOString().slice(0, 10);

  /* ---------- Which tariff mode is selected ---------- */
  const currentMode = () =>
    document.querySelector('input[name="mode"]:checked').value;

  /* ---------- Live breakdown ---------- */
  function renderPreview() {
    const b = EMS.computeBill(unitsInput.value, currentMode());
    const lineRows = b.lines.map(l =>
      `<div class="row"><span>${l.label}</span><span>${EMS.money(l.amount)}</span></div>`).join("");
    preview.innerHTML = `
      ${lineRows}
      <div class="row"><span>Fixed service charge</span><span>${EMS.money(b.serviceCharge)}</span></div>
      <div class="row total"><span>Amount payable</span><span>${EMS.money(b.total)}</span></div>`;
  }

  /* ---------- Recent bills log ---------- */
  function renderRecent() {
    const rows = EMS.getBills().slice().reverse().slice(0, 12);
    recentRows.innerHTML = rows.map(b => {
      const c = EMS.findCustomer(b.customerId);
      return `
        <tr>
          <td><strong>${b.id}</strong></td>
          <td>${c ? EMS.esc(c.name) : b.customerId}</td>
          <td>${EMS.esc(b.month)}</td>
          <td><strong>${b.units}</strong></td>
          <td><strong>${EMS.money(b.amount)}</strong></td>
          <td>${b.dueDate}</td>
          <td><span class="badge ${EMS.badgeClass(b.status)}">${b.status}</span></td>
        </tr>`;
    }).join("") ||
    `<tr class="empty"><td colspan="7">No bills yet — generate the first one above.</td></tr>`;
  }

  /* ---------- Generate ---------- */
  document.getElementById("generateBtn").addEventListener("click", () => {
    const ok = V.validate([
      { id: "customer", checks: [[V.required, "Choose a customer"]] },
      { id: "month",    checks: [[V.required, "Billing month is required"]] },
      { id: "units",    checks: [[V.required, "Enter the units consumed"], [V.number, "Units must be a number"]] },
      { id: "due",      checks: [[V.required, "Set a due date"]] },
    ]);
    if (!ok) return;

    if (Number(unitsInput.value) < 0) {
      V.setError(unitsInput, "Units cannot be negative");
      return;
    }

    const b = EMS.computeBill(unitsInput.value, currentMode());
    const bill = EMS.addBill({
      customerId: customerSel.value,
      month: monthInput.value.trim(),
      units: Number(unitsInput.value),
      amount: b.total,
      dueDate: dueInput.value,
    });

    const who = EMS.findCustomer(bill.customerId);
    alert.textContent = `Bill ${bill.id} for ${who ? who.name : bill.customerId} created — ${EMS.money(bill.amount)} due ${bill.dueDate}.`;
    alert.classList.add("show");

    unitsInput.value = "";
    renderPreview();
    renderRecent();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* Live updates */
  unitsInput.addEventListener("input", () => { V.clearError(unitsInput); renderPreview(); });
  document.querySelectorAll('input[name="mode"]').forEach(r =>
    r.addEventListener("change", renderPreview));
  V.liveClear(["customer", "month", "due"]);

  renderPreview();
  renderRecent();
}
