/* employee/complaintDetails.js — full view of one complaint (?id=K7001). */

const session = EMS.requireRole("employee", "login.html");
if (session) {

  // Top bar (name, nav, logout) is built once in js/chrome.js

  const id = new URLSearchParams(location.search).get("id");
  const k  = id ? EMS.findComplaint(id) : null;

  if (!k) {
    location.href = "dashboard.html";              // bad or missing id
  } else {
    const customer = EMS.findCustomer(k.customerId);

    document.getElementById("title").textContent = k.id + " · " + k.type;
    document.getElementById("subtitle").innerHTML =
      `Raised ${k.createdAt} · <span class="badge ${EMS.badgeClass(k.status)}">${k.status}</span>`;

    document.getElementById("detailRows").innerHTML = `
      <div class="row"><span>Customer</span><span>${customer ? customer.name : k.customerId}</span></div>
      <div class="row"><span>Phone</span><span>${customer ? customer.phone : "—"}</span></div>
      <div class="row"><span>Meter no.</span><span>${customer ? customer.meterNo : "—"}</span></div>
      <div class="row"><span>Address</span><span>${customer ? customer.address : "—"}</span></div>
      <div class="row"><span>Issue</span><span style="max-width:60%; text-align:right;">${k.description}</span></div>`;

    /* Hide the update button once resolved. */
    const updateLink = document.getElementById("updateLink");
    if (k.status === "Resolved") updateLink.style.display = "none";
    else updateLink.href = "updateStatus.html?id=" + k.id;

    document.getElementById("timeline").innerHTML = k.updates.map(u => `
      <li>
        <div class="t-when">${u.at}</div>
        <div class="t-what">${u.what}</div>
        ${u.note ? `<div class="t-note">“${u.note}”</div>` : ""}
      </li>`).join("");
  }
}
