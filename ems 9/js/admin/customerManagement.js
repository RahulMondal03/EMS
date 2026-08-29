/* admin/customerManagement.js — searchable customer directory. */

const session = EMS.requirePerm("customers", "../employee/login.html", "../employee/dashboard.html");
if (session) {

  // Top bar (name, nav, logout) is built once in js/chrome.js

  const rows   = document.getElementById("customerRows");
  const search = document.getElementById("search");

  function render() {
    const q = search.value.trim().toLowerCase();
    const list = EMS.getCustomers().filter(c =>
      !q || [c.name, c.email, c.meterNo].some(v => v.toLowerCase().includes(q)));

    rows.innerHTML = list.map(c => `
      <tr>
        <td><strong>${c.id}</strong></td>
        <td>${EMS.esc(c.name)}</td>
        <td>${EMS.esc(c.email)}</td>
        <td>${EMS.esc(c.phone)}</td>
        <td>${EMS.esc(c.meterNo)}</td>
        <td>${EMS.esc(c.address)}</td>
        <td><button class="btn btn-danger btn-sm" data-del="${c.id}">Remove</button></td>
      </tr>`).join("") ||
      `<tr class="empty"><td colspan="7">No customers match “${EMS.esc(search.value)}”.</td></tr>`;
  }

  search.addEventListener("input", render);

  rows.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-del]");
    if (btn && confirm("Remove this customer account? Their bills, payments and complaints are deleted too.")) {
      EMS.removeCustomer(btn.dataset.del);
      render();
    }
  });

  render();
}
