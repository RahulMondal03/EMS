/* customer/viewPayBill.js — list all bills; "Pay now" starts checkout. */

const session = EMS.requireRole("customer", "login.html");
if (session) {

  const me = EMS.findCustomer(session.id);
  document.getElementById("whoName").textContent = me.name;
  document.getElementById("whoMeta").textContent = "Meter " + me.meterNo;
  document.getElementById("logoutBtn").addEventListener("click", () => EMS.logout("login.html"));

  const esc  = EMS.esc;
  const rows = document.getElementById("billRows");
  const bills = EMS.billsForCustomer(me.id).slice().reverse();

  rows.innerHTML = bills.map(b => `
    <tr>
      <td><strong>${esc(b.id)}</strong></td>
      <td>${esc(b.month)}</td>
      <td>${esc(b.units)}</td>
      <td><strong>${EMS.money(b.amount)}</strong></td>
      <td>${esc(b.dueDate)}</td>
      <td><span class="badge ${EMS.badgeClass(b.status)}">${esc(b.status)}</span></td>
      <td>${b.status === "Unpaid"
            ? `<button class="btn btn-primary btn-sm" data-bill="${esc(b.id)}">Pay now</button>`
            : `<span class="muted">Paid</span>`}</td>
    </tr>`).join("") ||
    `<tr class="empty"><td colspan="7">No bills on this account yet.</td></tr>`;

  /* One listener for every "Pay now" button (event delegation). */
  rows.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-bill]");
    if (!btn) return;
    sessionStorage.setItem("ems_pending_bill", btn.dataset.bill);  // hand the bill to checkout
    location.href = "payment.html";
  });
}
