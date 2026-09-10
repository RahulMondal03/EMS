const { test, expect } = require("./fixtures");
const { MANAGER, AGENT, loginEmployee, store } = require("./helpers");

test.describe("position-driven navigation", () => {
  test("a Grid Manager sees the whole console", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await expect(page.locator("#vg-nav a")).toHaveText([
      "My work", "Overview", "Complaints", "Customer lookup",
      "Billing", "Customers", "Policies", "Team",
    ]);
    await expect(page.locator("#whoMeta")).toHaveText("Grid Manager · Field Operations");
  });

  test("a Field Agent sees only their two links", async ({ page }) => {
    await loginEmployee(page, AGENT);
    await expect(page.locator("#vg-nav a")).toHaveText(["My work", "Customer lookup"]);
    await expect(page.locator("#whoMeta")).toHaveText("Field Agent · Line Maintenance");
  });
});

test.describe("admin overview", () => {
  test("the grid overview counts the seeded data", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/dashboard.html");
    await expect(page.locator("#statCustomers")).toHaveText("2");
    await expect(page.locator("#statEmployees")).toHaveText("3");
    await expect(page.locator("#statOpen")).toHaveText("1");
    await expect(page.locator("#statRevenue")).toHaveText("₹819.00");
  });
});

test.describe("customer lookup", () => {
  test("searching by meter number finds the account and its dues", async ({ page }) => {
    await loginEmployee(page, AGENT);
    await page.goto("/employee/customerLookup.html");
    await expect(page.locator("#results")).toContainText("Start typing");

    await page.fill("#search", "MTR-58291");
    await expect(page.locator("#results h2")).toContainText("Anita Menon");
    await expect(page.locator("#results .card-head .badge.unpaid")).toHaveText("₹1237.50 due");
  });

  test("searching by email finds the other account", async ({ page }) => {
    await loginEmployee(page, AGENT);
    await page.goto("/employee/customerLookup.html");
    await page.fill("#search", "ravi@example.com");
    await expect(page.locator("#results h2")).toContainText("Ravi Kumar");
  });

  test("an unknown search reports no match", async ({ page }) => {
    await loginEmployee(page, AGENT);
    await page.goto("/employee/customerLookup.html");
    await page.fill("#search", "zzzz");
    await expect(page.locator("#results")).toContainText("No customer matches");
  });
});

test.describe("team management", () => {
  test("a manager adds an employee to the roster", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/employeeManagement.html");
    await expect(page.locator("#employeeRows tr")).toHaveCount(3);

    await page.fill("#ename", "Meera Iyer");
    await page.fill("#eemail", "meera@voltgrid.com");
    await page.fill("#ephone", "9900123456");
    await page.selectOption("#eposition", "Supervisor");
    await page.fill("#epassword", "meera123");
    await page.click("#addBtn");

    await expect(page.locator("#employeeRows tr")).toHaveCount(4);
    await expect(page.locator("#employeeRows")).toContainText("Meera Iyer");

    const data = await store(page);
    const added = data.employees.find((e) => e.email === "meera@voltgrid.com");
    expect(added.id).toBe("E504");
    expect(added.position).toBe("Supervisor");
  });
});
