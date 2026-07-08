/* admin/policyManagement.js — add / edit / delete tariff policies. */

const session = EMS.requirePerm("policies", "../employee/login.html", "../employee/dashboard.html");
if (session) {

  // Top bar (name, nav, logout) is built once in js/chrome.js

  const rows      = document.getElementById("policyRows");
  const formTitle = document.getElementById("formTitle");
  const idField   = document.getElementById("policyId");
  const cancelBtn = document.getElementById("cancelBtn");
  const alert     = document.getElementById("alert");

  function render() {
    rows.innerHTML = EMS.getPolicies().map(p => `
      <tr>
        <td>
          <strong>${p.name}</strong><br />
          <span class="muted">${p.description}</span>
        </td>
        <td><strong>${EMS.money(p.ratePerUnit)}</strong></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-ghost btn-sm"  data-edit="${p.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del="${p.id}">Delete</button>
        </td>
      </tr>`).join("") ||
      `<tr class="empty"><td colspan="3">No policies yet — add the first one.</td></tr>`;
  }

  function clearForm() {
    idField.value = "";
    document.getElementById("pname").value = "";
    document.getElementById("prate").value = "";
    document.getElementById("pdesc").value = "";
    formTitle.textContent = "Add a policy";
    cancelBtn.style.display = "none";
  }

  /* Edit / delete via event delegation on the table. */
  rows.addEventListener("click", (e) => {
    const editBtn = e.target.closest("button[data-edit]");
    const delBtn  = e.target.closest("button[data-del]");

    if (editBtn) {
      const p = EMS.getPolicies().find(x => x.id === editBtn.dataset.edit);
      idField.value = p.id;
      document.getElementById("pname").value = p.name;
      document.getElementById("prate").value = p.ratePerUnit;
      document.getElementById("pdesc").value = p.description;
      formTitle.textContent = "Edit policy " + p.id;
      cancelBtn.style.display = "inline-flex";
      alert.classList.remove("show");
    }

    if (delBtn && confirm("Delete this policy?")) {
      EMS.removePolicy(delBtn.dataset.del);
      render();
      clearForm();
    }
  });

  cancelBtn.addEventListener("click", clearForm);

  document.getElementById("saveBtn").addEventListener("click", () => {
    const ok = V.validate([
      { id: "pname", checks: [[V.required, "Policy name is required"]] },
      { id: "prate", checks: [[V.required, "Rate is required"], [V.positive, "Rate must be a positive number"]] },
      { id: "pdesc", checks: [[V.required, "Description is required"]] },
    ]);
    if (!ok) return;

    const fields = {
      name: document.getElementById("pname").value.trim(),
      ratePerUnit: Number(document.getElementById("prate").value),
      description: document.getElementById("pdesc").value.trim(),
    };

    if (idField.value) {
      EMS.updatePolicy(idField.value, fields);
      alert.textContent = "Policy updated.";
    } else {
      EMS.addPolicy(fields);
      alert.textContent = "Policy added.";
    }
    alert.classList.add("show");
    render();
    clearForm();
  });

  V.liveClear(["pname", "prate", "pdesc"]);
  render();
}
