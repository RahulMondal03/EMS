/* employee/dashboard.js — the personal complaint queue. */

const session = EMS.requireRole("employee", "login.html");
if (session) {

  const me = EMS.findEmployee(session.id);
  // Top bar (name, nav, logout) is built once in js/chrome.js
  document.getElementById("greeting").textContent = "Hello, " + me.name.split(" ")[0];

  const mine = EMS.complaintsForEmployee(me.id);

  /* --- Stat cards --- */
  document.getElementById("statAssigned").textContent =
    mine.filter(k => k.status === "Assigned").length;
  document.getElementById("statProgress").textContent =
    mine.filter(k => k.status === "In Progress").length;
  document.getElementById("statResolved").textContent =
    mine.filter(k => k.status === "Resolved").length;

  /* --- Queue table --- */
  const rows = document.getElementById("queueRows");
  rows.innerHTML = mine.slice().reverse().map(k => {
    const c = EMS.findCustomer(k.customerId);
    return `
      <tr>
        <td><strong>${k.id}</strong></td>
        <td>${c ? c.name : k.customerId}</td>
        <td>${k.type}</td>
        <td>${k.createdAt}</td>
        <td><span class="badge ${EMS.badgeClass(k.status)}">${k.status}</span></td>
        <td style="white-space:nowrap;">
          <a class="btn btn-ghost btn-sm" href="complaintDetails.html?id=${k.id}">View</a>
          ${k.status !== "Resolved"
            ? `<a class="btn btn-primary btn-sm" href="updateStatus.html?id=${k.id}">Update</a>` : ""}
        </td>
      </tr>`;
  }).join("") ||
  `<tr class="empty"><td colspan="6">No complaints assigned to you yet — a manager or supervisor routes them to your queue.</td></tr>`;
}
