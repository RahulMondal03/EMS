/* ============================================================
   chrome.js — shared page furniture for every VoltGrid page.

   Two jobs:
   1. Employee navigation & identity. The top bar for staff pages is
      NOT hand-written per page — it is rendered here from the signed-in
      employee's POSITION, so each person only sees the links their
      position allows. Field agents get two links; a Grid Manager gets
      the whole console. Pages opt in with:
        <nav id="vg-nav" data-active="billing"></nav>
   2. A site footer on every page (staff, customer, and the landing
      page), so the site always has a header and a footer.
   ============================================================ */
(function () {

  /* ---- Which links exist, and the capability each one needs ---- */
  /* Paths are written relative to any page that lives one folder deep
     (employee/… or admin/…), so the same link works from either area. */
  const NAV_ITEMS = [
    { key: "work",        perm: "work",        label: "My work",        href: "../employee/dashboard.html" },
    { key: "overview",    perm: "overview",    label: "Overview",       href: "../admin/dashboard.html" },
    { key: "complaints",  perm: "complaints",  label: "Complaints",     href: "../admin/complaintManagement.html" },
    { key: "lookup",      perm: "lookup",      label: "Customer lookup", href: "../employee/customerLookup.html" },
    { key: "billing",     perm: "billing",     label: "Billing",        href: "../admin/billing.html" },
    { key: "customers",   perm: "customers",   label: "Customers",      href: "../admin/customerManagement.html" },
    { key: "policies",    perm: "policies",    label: "Policies",       href: "../admin/policyManagement.html" },
    { key: "employees",   perm: "employees",   label: "Team",           href: "../admin/employeeManagement.html" },
  ];

  /* Where "Log out" and failed guards should send someone. */
  function loginPath() {
    return location.pathname.includes("/admin/")
      ? "../employee/login.html"
      : "login.html";
  }

  /* ---- Render the staff top bar from the employee's position ---- */
  function renderEmployeeChrome() {
    const nav = document.getElementById("vg-nav");
    if (!nav || typeof EMS === "undefined") return;

    const session = EMS.getSession();
    if (!session || session.role !== "employee") return;

    const me = EMS.findEmployee(session.id);
    if (!me) return;

    const active = nav.getAttribute("data-active") || "";
    nav.innerHTML = NAV_ITEMS
      .filter(item => EMS.can(me, item.perm))
      .map(item =>
        `<a href="${item.href}"${item.key === active ? ' class="active"' : ""}>${item.label}</a>`)
      .join("");

    /* Identity badge: name + position · department. */
    const nameEl = document.getElementById("whoName");
    const metaEl = document.getElementById("whoMeta");
    if (nameEl) nameEl.textContent = me.name;
    if (metaEl) metaEl.textContent = EMS.positionLabel(me) + (me.dept ? " · " + me.dept : "");

    /* Log out — wired here so every staff page behaves the same. */
    const out = document.getElementById("logoutBtn");
    if (out) out.addEventListener("click", () => EMS.logout(loginPath()));
  }

  /* ---- Site footer (rendered on every page) ---- */
  function footerHTML() {
    const year = new Date().getFullYear();
    return `
    <footer class="site-footer">
      <div class="site-footer-inner">
        <div class="sf-brand">
          <div class="brand"><span class="bolt">⚡</span><span>VoltGrid<small>Electricity Management</small></span></div>
          <p>Metering, billing, payments and complaints for the whole grid — one connected system for customers and staff.</p>
          <p class="sf-status"><span class="dot"></span> Grid online · all services operational</p>
        </div>

        <div class="sf-cols">
          <div class="sf-col">
            <h4>Services</h4>
            <a href="#">View &amp; pay bills</a>
            <a href="#">Tariffs &amp; policies</a>
            <a href="#">New connection</a>
            <a href="#">Rooftop solar</a>
          </div>
          <div class="sf-col">
            <h4>Support</h4>
            <a href="#">Help center</a>
            <a href="#">Report an outage</a>
            <a href="#">Raise a complaint</a>
            <a href="#">Contact us</a>
          </div>
          <div class="sf-col">
            <h4>Company</h4>
            <a href="#">About VoltGrid</a>
            <a href="#">Careers</a>
            <a href="#">Newsroom</a>
            <a href="#">Sustainability</a>
          </div>
          <div class="sf-col sf-contact">
            <h4>Get in touch</h4>
            <a href="tel:1800111222">📞 1800-111-222 (24×7)</a>
            <a href="mailto:care@voltgrid.com">✉️ care@voltgrid.com</a>
            <span>Grid House, MG Road, Kochi 682001</span>
          </div>
        </div>
      </div>

      <div class="site-footer-bar">
        <span>© ${year} VoltGrid Energy. All rights reserved.</span>
        <nav class="sf-legal">
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">Cookies</a>
          <a href="#">Accessibility</a>
        </nav>
      </div>
    </footer>`;
  }

  function renderFooter() {
    if (document.querySelector(".site-footer")) return;   // never twice
    document.body.insertAdjacentHTML("beforeend", footerHTML());
  }

  /* ---- Boot ---- */
  document.addEventListener("DOMContentLoaded", () => {
    renderEmployeeChrome();
    renderFooter();
  });

})();
