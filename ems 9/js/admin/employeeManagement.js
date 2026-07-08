/* admin/employeeManagement.js — team list + add / remove employees. */

const session = EMS.requirePerm("employees", "../employee/login.html", "../employee/dashboard.html");
if (session) {

  document.getElementById("whoName").textContent = session.name;
  document.getElementById("logoutBtn").addEventListener("click", () => EMS.logout("../employee/login.html"));

  const rows     = document.getElementById("employeeRows");
  const alert    = document.getElementById("alert");
  const posSelect = document.getElementById("eposition");

  /* Higher tiers get a stronger badge; keeps the hierarchy readable. */
  const posBadge = { 3: "paid", 2: "in-progress", 1: "assigned" };

  /* Fill the Position picker from the single source of truth. */
  posSelect.innerHTML = EMS.listPositions()
    .map(p => `<option value="${p}">${p}</option>`).join("");
  posSelect.value = "Field Agent";

  function render() {
    rows.innerHTML = EMS.getEmployees().map(emp => {
      /* how many unresolved complaints this employee is holding */
      const active = EMS.complaintsForEmployee(emp.id)
                        .filter(k => k.status !== "Resolved").length;
      const pos = EMS.positionLabel(emp);
      return `
        <tr>
          <td><strong>${emp.id}</strong></td>
          <td>${emp.name}<br /><span class="muted" style="font-size:.78rem;">${emp.email}</span></td>
          <td><span class="badge ${posBadge[EMS.tierOf(emp)] || "assigned"}">${pos}</span></td>
          <td>${emp.dept}</td>
          <td>${active ? `<span class="badge in-progress">${active} open</span>` : `<span class="muted">free</span>`}</td>
          <td><button class="btn btn-danger btn-sm" data-del="${emp.id}">Remove</button></td>
        </tr>`;
    }).join("") ||
    `<tr class="empty"><td colspan="6">No employees yet.</td></tr>`;
  }

  rows.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-del]");
    if (btn && confirm("Remove this employee? Their open complaints return to the unassigned queue.")) {
      EMS.removeEmployee(btn.dataset.del);
      render();
    }
  });

  document.getElementById("addBtn").addEventListener("click", () => {
    const ok = V.validate([
      { id: "ename",     checks: [[V.required, "Name is required"]] },
      { id: "eemail",    checks: [[V.required, "Email is required"], [V.email, "Enter a valid email"]] },
      { id: "ephone",    checks: [[V.required, "Mobile number is required"], [V.phone, "Enter a valid 10-digit mobile"]] },
      { id: "epassword", checks: [[V.required, "Password is required"], [V.minLen(6), "Use at least 6 characters"]] },
    ]);
    if (!ok) return;

    const emp = EMS.addEmployee({
      name:  document.getElementById("ename").value.trim(),
      email: document.getElementById("eemail").value.trim(),
      phone: document.getElementById("ephone").value.trim(),
      dept:  document.getElementById("edept").value,
      position: posSelect.value,
      password: document.getElementById("epassword").value,
    });

    alert.innerHTML = `Added <strong>${emp.name}</strong> (${emp.id}) as ${EMS.positionLabel(emp)}.`;
    alert.classList.add("show");
    ["ename", "eemail", "ephone", "epassword"].forEach(id => document.getElementById(id).value = "");
    render();
  });

  V.liveClear(["ename", "eemail", "ephone", "epassword"]);
  render();
}
