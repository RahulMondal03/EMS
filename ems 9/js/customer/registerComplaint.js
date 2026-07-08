/* customer/registerComplaint.js — file a new complaint. */

const session = EMS.requireRole("customer", "login.html");
if (session) {

  const me = EMS.findCustomer(session.id);
  document.getElementById("whoName").textContent = me.name;
  document.getElementById("whoMeta").textContent = "Meter " + me.meterNo;
  document.getElementById("logoutBtn").addEventListener("click", () => EMS.logout("login.html"));

  document.getElementById("submitBtn").addEventListener("click", () => {
    const ok = V.validate([
      { id: "type",        checks: [[V.required, "Choose a complaint type"]] },
      { id: "description", checks: [[V.required, "Please describe the issue"], [V.minLen(15), "A little more detail helps the team (15+ characters)"]] },
    ]);
    if (!ok) return;

    const type = document.getElementById("type").value;
    const description = document.getElementById("description").value.trim();

    const complaint = EMS.addComplaint(me.id, type, description);

    /* Confirm inline, clear the form, and point to the status page. */
    const alert = document.getElementById("alert");
    alert.innerHTML = `Complaint <strong>${complaint.id}</strong> registered.
      Track it on the <a href="complaintStatus.html">status page</a>.`;
    alert.classList.add("show");
    document.getElementById("type").value = "";
    document.getElementById("description").value = "";
  });

  V.liveClear(["type", "description"]);
}
