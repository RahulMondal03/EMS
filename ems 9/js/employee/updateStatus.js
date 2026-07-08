/* employee/updateStatus.js — move a complaint along its lifecycle. */

const session = EMS.requireRole("employee", "login.html");
if (session) {

  // Top bar (name, nav, logout) is built once in js/chrome.js

  const id = new URLSearchParams(location.search).get("id");
  const k  = id ? EMS.findComplaint(id) : null;

  if (!k || k.status === "Resolved") {
    location.href = "dashboard.html";              // nothing to update
  } else {
    document.getElementById("title").textContent = "Update " + k.id;
    document.getElementById("subtitle").textContent = k.type + " — currently “" + k.status + "”";
    document.getElementById("backLink").href = "complaintDetails.html?id=" + k.id;

    document.getElementById("saveBtn").addEventListener("click", () => {
      const ok = V.validate([
        { id: "note", checks: [[V.required, "Add a short note for the customer"], [V.minLen(10), "A few more words (10+ characters)"]] },
      ]);
      if (!ok) return;

      const status = document.getElementById("status").value;
      const note   = document.getElementById("note").value.trim();

      EMS.updateComplaintStatus(k.id, status, note);

      const alert = document.getElementById("alert");
      alert.innerHTML = `Saved — ${k.id} is now <strong>${status}</strong>. Returning to your queue…`;
      alert.classList.add("show");
      setTimeout(() => location.href = "dashboard.html", 1200);
    });

    V.liveClear(["note"]);
  }
}
