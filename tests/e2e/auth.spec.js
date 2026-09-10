const { test, expect } = require("./fixtures");
const { CUSTOMER, MANAGER, AGENT, loginCustomer, loginEmployee } = require("./helpers");

test.describe("authentication and access control", () => {
  test("a wrong password is rejected without creating a session", async ({ page }) => {
    await page.goto("/customer/login.html");
    await page.fill("#email", CUSTOMER.email);
    await page.fill("#password", "not-the-password");
    await page.click("#loginBtn");
    await expect(page.locator("#alert")).toHaveText("No account matches that email and password.");
    await expect(page).toHaveURL(/customer\/login\.html$/);
    expect(await page.evaluate(() => sessionStorage.getItem("ems_session"))).toBeNull();
  });

  test("a malformed email fails client-side validation", async ({ page }) => {
    await page.goto("/customer/login.html");
    await page.fill("#email", "not-an-email");
    await page.fill("#password", CUSTOMER.password);
    await page.click("#loginBtn");
    await expect(page.locator("#email").locator("xpath=ancestor::div[contains(@class,'field')][1]"))
      .toHaveClass(/invalid/);
    await expect(page).toHaveURL(/customer\/login\.html$/);
  });

  test("valid customer credentials reach the dashboard", async ({ page }) => {
    await loginCustomer(page);
    await expect(page.locator("#greeting")).toHaveText("Hello, Anita");
    await expect(page.locator("#whoName")).toHaveText(CUSTOMER.name);
    await expect(page.locator("#whoMeta")).toHaveText("Meter " + CUSTOMER.meter);
  });

  test("a signed-out visitor is bounced off the customer dashboard", async ({ page }) => {
    await page.goto("/customer/dashboard.html");
    await page.waitForURL("**/customer/login.html");
    await expect(page.locator("h1")).toHaveText("Welcome back");
  });

  test("a signed-out visitor is bounced off the employee dashboard", async ({ page }) => {
    await page.goto("/employee/dashboard.html");
    await page.waitForURL("**/employee/login.html");
    await expect(page.locator("h1")).toHaveText("Employee sign in");
  });

  test("logging out clears the session and returns to the login page", async ({ page }) => {
    await loginCustomer(page);
    await page.click("#logoutBtn");
    await page.waitForURL("**/customer/login.html");
    expect(await page.evaluate(() => sessionStorage.getItem("ems_session"))).toBeNull();
  });

  test("a customer session cannot be used on employee pages", async ({ page }) => {
    await loginCustomer(page);
    await page.goto("/employee/dashboard.html");
    await page.waitForURL("**/employee/login.html");
  });

  test("a Field Agent is redirected away from a manager-only page", async ({ page }) => {
    await loginEmployee(page, AGENT);
    await page.goto("/admin/employeeManagement.html");
    await page.waitForURL("**/employee/dashboard.html");
  });

  test("a Grid Manager reaches the manager-only page", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/employeeManagement.html");
    await expect(page.locator("h1")).toHaveText("Employee management");
  });
});
