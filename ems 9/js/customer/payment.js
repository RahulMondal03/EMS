/* customer/payment.js — checkout step 1 (choose method) AND the
   success page receipt. The same file serves payment.html and
   paymentSuccess.html; it checks which elements exist on the page. */

const session = EMS.requireRole("customer", "login.html");
if (session) {

  const me = EMS.findCustomer(session.id);
  const whoName = document.getElementById("whoName");
  if (whoName) {
    whoName.textContent = me.name;
    document.getElementById("whoMeta").textContent = "Meter " + me.meterNo;
    document.getElementById("logoutBtn").addEventListener("click", () => EMS.logout("login.html"));
  }

  /* ============ payment.html — method picker ============ */
  const summary = document.getElementById("billSummary");
  if (summary) {
    const billId = sessionStorage.getItem("ems_pending_bill");
    const bill = billId ? EMS.findBill(billId) : null;

    /* No pending bill (page opened directly) → back to the bill list. */
    if (!bill || bill.status === "Paid") {
      location.href = "viewPayBill.html";
    } else {
      summary.innerHTML = `
        <div class="row"><span>Bill ID</span><span>${bill.id}</span></div>
        <div class="row"><span>Billing month</span><span>${bill.month}</span></div>
        <div class="row"><span>Units consumed</span><span>${bill.units}</span></div>
        <div class="row"><span>Due date</span><span>${bill.dueDate}</span></div>
        <div class="row total"><span>Total payable</span><span>${EMS.money(bill.amount)}</span></div>`;

      /* Show the UPI field only when UPI is selected. */
      const upiField = document.getElementById("upiField");
      document.querySelectorAll("input[name='method']").forEach(r =>
        r.addEventListener("change", () => {
          upiField.style.display = r.value === "UPI" && r.checked ? "block" : "none";
        }));

      document.getElementById("proceedBtn").addEventListener("click", () => {
        const method = document.querySelector("input[name='method']:checked").value;

        if (method === "Card") {
          location.href = "cardDetails.html";       // card entry has its own page
          return;
        }

        /* UPI pays right here after a quick validation. */
        const ok = V.validate([{ id: "upi",
          checks: [[V.required, "UPI ID is required"], [V.upiId, "Format looks like name@bank"]] }]);
        if (!ok) return;

        const payment = EMS.payBill(bill.id, "UPI");
        sessionStorage.setItem("ems_last_payment", JSON.stringify(payment));
        sessionStorage.removeItem("ems_pending_bill");
        location.href = "paymentSuccess.html";
      });
    }
  }

  /* ============ paymentSuccess.html — receipt ============ */
  const receipt = document.getElementById("receipt");
  if (receipt) {
    const raw = sessionStorage.getItem("ems_last_payment");
    if (!raw) {
      location.href = "dashboard.html";             // nothing to show
    } else {
      const p = JSON.parse(raw);
      const bill = EMS.findBill(p.billId);
      receipt.innerHTML = `
        <div class="row"><span>Transaction ID</span><span>${p.id}</span></div>
        <div class="row"><span>Bill</span><span>${bill.id} · ${bill.month}</span></div>
        <div class="row"><span>Method</span><span>${p.method}</span></div>
        <div class="row"><span>Paid on</span><span>${p.date}</span></div>
        <div class="row total"><span>Amount paid</span><span>${EMS.money(p.amount)}</span></div>`;
    }
  }
}
