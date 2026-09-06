/* customer/dashboard.js — stats + recent bills and complaints. */

const session = EMS.requireRole("customer", "login.html");
if (session) {

  const me = EMS.findCustomer(session.id);

  /* Top bar */
  document.getElementById("whoName").textContent = me.name;
  document.getElementById("whoMeta").textContent = "Meter " + me.meterNo;
  document.getElementById("logoutBtn").addEventListener("click", () => EMS.logout("login.html"));
  document.getElementById("greeting").textContent = "Hello, " + me.name.split(" ")[0];

  const esc        = EMS.esc;
  const bills      = EMS.billsForCustomer(me.id);
  const complaints = EMS.complaintsForCustomer(me.id);

  /* --- Stat cards --- */
  const unpaid = bills.filter(b => b.status === "Unpaid");
  let due = 0;                                   // add up the unpaid amounts
  for (const b of unpaid) due += b.amount;
  document.getElementById("statDue").textContent = EMS.money(due);
  document.getElementById("statDueNote").textContent =
    unpaid.length ? unpaid.length + " unpaid bill(s)" : "You're all settled ✨";

  const latest = bills[bills.length - 1];
  if (latest) {
    document.getElementById("statUnits").innerHTML = esc(latest.units) + " <small>units</small>";
    document.getElementById("statUnitsNote").textContent = latest.month;
  }

  const open = complaints.filter(k => k.status !== "Resolved").length;
  document.getElementById("statComplaints").textContent = open;
  document.getElementById("statComplaintsNote").textContent =
    complaints.length ? complaints.length + " total raised" : "No complaints yet";

  /* --- Recent bills table (latest 3) --- */
  const billRows = document.getElementById("billRows");
  billRows.innerHTML = bills.slice(-3).reverse().map(b => `
    <tr>
      <td><strong>${esc(b.month)}</strong></td>
      <td>${esc(b.units)}</td>
      <td>${EMS.money(b.amount)}</td>
      <td><span class="badge ${EMS.badgeClass(b.status)}">${esc(b.status)}</span></td>
    </tr>`).join("") ||
    `<tr class="empty"><td colspan="4">No bills on this account yet.</td></tr>`;

  /* --- Recent complaints table (latest 3) --- */
  const complaintRows = document.getElementById("complaintRows");
  complaintRows.innerHTML = complaints.slice(-3).reverse().map(k => `
    <tr>
      <td><strong>${esc(k.id)}</strong></td>
      <td>${esc(k.type)}</td>
      <td><span class="badge ${EMS.badgeClass(k.status)}">${esc(k.status)}</span></td>
    </tr>`).join("") ||
    `<tr class="empty"><td colspan="3">Nothing raised — hope it stays that way!</td></tr>`;
}
