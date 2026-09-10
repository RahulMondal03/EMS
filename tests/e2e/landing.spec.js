const { test, expect } = require("./fixtures");

test.describe("landing page", () => {
  test("shows both portal doors and the demo credentials", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("h1")).toContainText("Meter to money");
    await expect(page.locator(".lp-door")).toHaveCount(2);
    await expect(page.locator('.lp-door[href="customer/login.html"] h3')).toHaveText("Customer");
    await expect(page.locator('.lp-door[href="employee/login.html"] h3')).toHaveText("Employee");
    await expect(page.locator(".lp-foot")).toContainText("anita@example.com");
  });

  test("the shared footer is rendered by chrome.js", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("footer.site-footer")).toHaveCount(1);
    await expect(page.locator(".site-footer")).toContainText("VoltGrid Energy");
  });

  test("the customer door leads to the customer login", async ({ page }) => {
    await page.goto("/index.html");
    await page.click('.lp-door[href="customer/login.html"]');
    await expect(page).toHaveURL(/customer\/login\.html$/);
    await expect(page.locator("h1")).toHaveText("Welcome back");
  });
});
