/* customer/cardDetails.js — card entry with a live preview, then pay. */

const session = EMS.requireRole("customer", "login.html");
if (session) {

  const me = EMS.findCustomer(session.id);
  document.getElementById("whoName").textContent = me.name;
  document.getElementById("whoMeta").textContent = "Meter " + me.meterNo;
  document.getElementById("logoutBtn").addEventListener("click", () => EMS.logout("login.html"));

  const billId = sessionStorage.getItem("ems_pending_bill");
  const bill = billId ? EMS.findBill(billId) : null;
  if (!bill || bill.status === "Paid") location.href = "viewPayBill.html";

  /* ---------- Live card preview ---------- */
  const numberInput = document.getElementById("cardNumber");
  const nameInput   = document.getElementById("cardName");
  const expInput    = document.getElementById("expiry");

  numberInput.addEventListener("input", () => {
    /* keep digits only, group in fours: 1234 5678 ... */
    const digits = numberInput.value.replace(/\D/g, "").slice(0, 16);
    numberInput.value = digits.replace(/(.{4})/g, "$1 ").trim();
    document.getElementById("pvNum").textContent =
      numberInput.value || "•••• •••• •••• ••••";
  });
  nameInput.addEventListener("input", () => {
    document.getElementById("pvName").textContent =
      nameInput.value.toUpperCase() || "CARDHOLDER";
  });
  expInput.addEventListener("input", () => {
    /* auto-insert the slash after MM */
    let v = expInput.value.replace(/\D/g, "").slice(0, 4);
    if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2);
    expInput.value = v;
    document.getElementById("pvExp").textContent = v || "MM/YY";
  });

  /* ---------- Pay ---------- */
  document.getElementById("payBtn").addEventListener("click", () => {
    const ok = V.validate([
      { id: "cardName",   checks: [[V.required, "Name is required"]] },
      { id: "cardNumber", checks: [[V.required, "Card number is required"], [V.cardNumber, "Enter all 16 digits"]] },
      { id: "expiry",     checks: [[V.required, "Expiry is required"], [V.expiry, "Use MM/YY and a future date"]] },
      { id: "cvv",        checks: [[V.required, "CVV is required"], [V.cvv, "3 digits"]] },
    ]);
    if (!ok) return;

    const payment = EMS.payBill(bill.id, "Card");
    sessionStorage.setItem("ems_last_payment", JSON.stringify(payment));
    sessionStorage.removeItem("ems_pending_bill");
    location.href = "paymentSuccess.html";
  });

  V.liveClear(["cardName", "cardNumber", "expiry", "cvv"]);
}
