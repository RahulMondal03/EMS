/* admin/customerManagement.js — searchable customer directory. */

const session = EMS.requirePerm("customers", "../employee/login.html", "../employee/dashboard.html");
if (session) {

  // Top bar (name, nav, logout) is built once in js/chrome.js

  const esc    = EMS.esc;
  const rows   = document.getElementById("customerRows");
  const search = document.getElementById("search");

  function render() {
    const q = search.value.trim().toLowerCase();
    const list = EMS.getCustomers().filter(c =>
      !q || [c.name, c.email, c.phone, c.meterNo].some(v => String(v || "").toLowerCase().includes(q)));

    rows.innerHTML = list.map(c => `
      <tr>
        <td><strong>${esc(c.id)}</strong></td>
        <td>${esc(c.name)}</td>
        <td>${esc(c.email)}</td>
        <td>${esc(c.phone)}</td>
        <td>${esc(c.meterNo)}</td>
        <td>${esc(c.address)}</td>
        <td><button class="btn btn-danger btn-sm" data-del="${esc(c.id)}">Remove</button></td>
      </tr>`).join("") ||
      `<tr class="empty"><td colspan="7">No customers match “${esc(search.value)}”.</td></tr>`;
  }

  search.addEventListener("input", render);

  rows.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-del]");
    if (btn && confirm("Remove this customer account?")) {
      EMS.removeCustomer(btn.dataset.del);
      render();
    }
  });

  render();
}
