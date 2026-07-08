/* customer/complaintStatus.js — each complaint gets a card + timeline. */

const session = EMS.requireRole("customer", "login.html");
if (session) {

  const me = EMS.findCustomer(session.id);
  document.getElementById("whoName").textContent = me.name;
  document.getElementById("whoMeta").textContent = "Meter " + me.meterNo;
  document.getElementById("logoutBtn").addEventListener("click", () => EMS.logout("login.html"));

  const list = document.getElementById("complaintList");
  const complaints = EMS.complaintsForCustomer(me.id).slice().reverse();

  if (!complaints.length) {
    list.innerHTML = `
      <div class="glass center" style="padding:44px;">
        <h2>No complaints yet</h2>
        <p class="muted mt-1">If something goes wrong, we're one click away.</p>
        <a class="btn btn-primary mt-2" href="registerComplaint.html">Register a complaint</a>
      </div>`;
  } else {
    list.innerHTML = complaints.map(k => {
      const assignee = k.assignedTo ? EMS.findEmployee(k.assignedTo) : null;
      const timeline = k.updates.map(u => `
        <li>
          <div class="t-when">${u.at}</div>
          <div class="t-what">${u.what}</div>
          ${u.note ? `<div class="t-note">“${u.note}”</div>` : ""}
        </li>`).join("");

      return `
        <div class="glass">
          <div class="card-head">
            <div>
              <h2>${k.id} · ${k.type}</h2>
              <p class="muted">Raised ${k.createdAt}${assignee ? " · handled by " + assignee.name : ""}</p>
            </div>
            <span class="badge ${EMS.badgeClass(k.status)}">${k.status}</span>
          </div>
          <p style="font-size:0.92rem;">${k.description}</p>
          <ul class="timeline mt-2">${timeline}</ul>
        </div>`;
    }).join("");
  }
}
