/* employee/complaintDetails.js — full view of one complaint (?id=K7001). */

const session = EMS.requireRole("employee", "login.html");
if (session) {

  // Top bar (name, nav, logout) is built once in js/chrome.js

  const me = EMS.findEmployee(session.id);
  const id = new URLSearchParams(location.search).get("id");
  const k  = id ? EMS.findComplaint(id) : null;

  /* Bad id, or a complaint this person has no business seeing (a field
     agent typing someone else's id into the address bar) → own queue. */
  if (!me || !k || !EMS.mayHandleComplaint(me, k)) {
    location.href = "dashboard.html";
  } else {
    const esc = EMS.esc;
    const customer = EMS.findCustomer(k.customerId);

    document.getElementById("title").textContent = k.id + " · " + k.type;
    document.getElementById("subtitle").innerHTML =
      `Raised ${esc(k.createdAt)} · <span class="badge ${EMS.badgeClass(k.status)}">${esc(k.status)}</span>`;

    document.getElementById("detailRows").innerHTML = `
      <div class="row"><span>Customer</span><span>${esc(customer ? customer.name : k.customerId)}</span></div>
      <div class="row"><span>Phone</span><span>${esc(customer ? customer.phone : "—")}</span></div>
      <div class="row"><span>Meter no.</span><span>${esc(customer ? customer.meterNo : "—")}</span></div>
      <div class="row"><span>Address</span><span>${esc(customer ? customer.address : "—")}</span></div>
      <div class="row"><span>Issue</span><span style="max-width:60%; text-align:right;">${esc(k.description)}</span></div>`;

    /* Hide the update button once resolved. */
    const updateLink = document.getElementById("updateLink");
    if (k.status === "Resolved") updateLink.style.display = "none";
    else updateLink.href = "updateStatus.html?id=" + encodeURIComponent(k.id);

    document.getElementById("timeline").innerHTML = k.updates.map(u => `
      <li>
        <div class="t-when">${esc(u.at)}</div>
        <div class="t-what">${esc(u.what)}</div>
        ${u.note ? `<div class="t-note">“${esc(u.note)}”</div>` : ""}
      </li>`).join("");
  }
}
