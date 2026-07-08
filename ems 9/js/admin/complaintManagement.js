/* admin/complaintManagement.js — assign complaints to employees. */

const session = EMS.requirePerm("complaints", "../employee/login.html", "../employee/dashboard.html");
if (session) {

  // Top bar (name, nav, logout) is built once in js/chrome.js

  const me       = EMS.findEmployee(session.id);
  const canAssign = EMS.can(me, "assign");
  const rows     = document.getElementById("complaintRows");

  function render() {
    const complaints = EMS.getComplaints().slice().reverse();
    /* You may only route complaints down your own chain, so the picker
       is built from the people who sit below you in the hierarchy.      */
    const team = EMS.assignableEmployees(me);

    rows.innerHTML = complaints.map(k => {
      const c = EMS.findCustomer(k.customerId);
      const assignee = k.assignedTo ? EMS.findEmployee(k.assignedTo) : null;

      /* Unassigned + unresolved → show an assign dropdown, but only if
         this person is allowed to assign. Otherwise show who has it.    */
      let assignCell;
      if (k.status === "Open" && canAssign && team.length) {
        const options = team.map(e =>
          `<option value="${e.id}">${e.name} · ${EMS.positionLabel(e)}</option>`).join("");
        assignCell = `
          <select data-assign="${k.id}">
            <option value="">Choose employee…</option>
            ${options}
          </select>`;
      } else if (k.status === "Open") {
        assignCell = canAssign
          ? `<span class="muted">No one to assign to</span>`
          : `<span class="muted">Awaiting assignment</span>`;
      } else {
        assignCell = assignee ? `${assignee.name} · ${EMS.positionLabel(assignee)}` : "—";
      }

      return `
        <tr>
          <td><strong>${k.id}</strong></td>
          <td>${c ? c.name : k.customerId}</td>
          <td>${k.type}</td>
          <td style="max-width:280px;">${k.description}</td>
          <td><span class="badge ${EMS.badgeClass(k.status)}">${k.status}</span></td>
          <td>${assignCell}</td>
        </tr>`;
    }).join("") ||
    `<tr class="empty"><td colspan="6">No complaints in the system.</td></tr>`;
  }

  /* Assign as soon as an employee is picked from a dropdown. */
  rows.addEventListener("change", (e) => {
    const select = e.target.closest("select[data-assign]");
    if (!select || !select.value) return;
    EMS.assignComplaint(select.dataset.assign, select.value);
    render();
  });

  render();
}
