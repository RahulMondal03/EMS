/* Shared sign-in helpers and the demo credentials seeded by js/data.js. */

const CUSTOMER = { email: "anita@example.com", password: "anita123", name: "Anita Menon", meter: "MTR-58291" };
const MANAGER  = { email: "suresh@voltgrid.com", password: "suresh123", name: "Suresh Nair" };
const AGENT    = { email: "arjun@voltgrid.com", password: "arjun123", name: "Arjun Rao" };

async function loginCustomer(page, who = CUSTOMER) {
  await page.goto("/customer/login.html");
  await page.fill("#email", who.email);
  await page.fill("#password", who.password);
  await page.click("#loginBtn");
  await page.waitForURL("**/customer/dashboard.html");
}

async function loginEmployee(page, who = MANAGER) {
  await page.goto("/employee/login.html");
  await page.fill("#email", who.email);
  await page.fill("#password", who.password);
  await page.click("#loginBtn");
  await page.waitForURL("**/employee/dashboard.html");
}

/* Read the demo store straight out of localStorage — used to assert on
   state the UI only shows indirectly. */
async function store(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("ems_data_v2")));
}

module.exports = { CUSTOMER, MANAGER, AGENT, loginCustomer, loginEmployee, store };
