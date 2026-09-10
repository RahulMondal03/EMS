const { test, expect } = require("./fixtures");
const { MANAGER, loginEmployee, store } = require("./helpers");

test.describe("bill generation", () => {
  test("the live preview applies the tiered slab tariff", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/billing.html");
    await page.fill("#units", "250");
    /* 200 × ₹4.50 (Slab A) + 50 × ₹6.25 (Slab B) + ₹50 service = ₹1262.50 */
    await expect(page.locator("#preview")).toContainText("200 units × ₹4.50 · Slab A");
    await expect(page.locator("#preview")).toContainText("50 units × ₹6.25 · Slab B");
    await expect(page.locator("#preview .row.total")).toContainText("₹1262.50");
  });

  test("the green rooftop mode uses the flat rebate rate", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/billing.html");
    await page.fill("#units", "250");
    await page.check('input[name="mode"][value="green"]');
    /* 250 × ₹3.75 + ₹50 = ₹987.50 */
    await expect(page.locator("#preview")).toContainText("Green rooftop");
    await expect(page.locator("#preview .row.total")).toContainText("₹987.50");
  });

  test("generating a bill records it and shows it in the recent log", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/billing.html");
    await page.selectOption("#customer", "C1002");
    await page.fill("#month", "August 2026");
    await page.fill("#units", "250");
    await page.fill("#due", "2026-09-15");
    await page.click("#generateBtn");

    await expect(page.locator("#alert")).toContainText("B9004");
    await expect(page.locator("#recentRows")).toContainText("August 2026");

    const data = await store(page);
    const bill = data.bills.find((b) => b.id === "B9004");
    expect(bill.customerId).toBe("C1002");
    expect(bill.units).toBe(250);
    expect(bill.amount).toBe(1262.5);
    expect(bill.status).toBe("Unpaid");
  });

  test("editing a tariff policy changes what a new bill costs", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/policyManagement.html");
    await page.locator("#policyRows tr", { hasText: "Slab A" }).locator('button:has-text("Edit")').click();
    await page.fill("#prate", "5.00");
    await page.click("#saveBtn");
    await expect(page.locator("#policyRows")).toContainText("₹5.00");

    await page.goto("/admin/billing.html");
    await page.fill("#units", "100");
    /* 100 × ₹5.00 + ₹50 service = ₹550.00, up from ₹500.00 at the old rate */
    await expect(page.locator("#preview .row.total")).toContainText("₹550.00");
  });
});
