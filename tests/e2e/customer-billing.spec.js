const { test, expect } = require("./fixtures");
const { loginCustomer, store } = require("./helpers");

test.describe("customer bills and payment", () => {
  test("the dashboard totals the outstanding balance", async ({ page }) => {
    await loginCustomer(page);
    await expect(page.locator("#statDue")).toHaveText("₹1237.50");
    await expect(page.locator("#billRows tr")).toHaveCount(2);
  });

  test("the bill list marks B9002 unpaid and offers Pay now", async ({ page }) => {
    await loginCustomer(page);
    await page.goto("/customer/viewPayBill.html");
    const unpaid = page.locator("#billRows tr", { hasText: "B9002" });
    await expect(unpaid.locator(".badge")).toHaveText("Unpaid");
    await expect(unpaid.locator('button[data-bill="B9002"]')).toHaveText("Pay now");
    /* the already-paid bill offers no button */
    await expect(page.locator('#billRows tr:has-text("B9001") button')).toHaveCount(0);
  });

  test("paying by UPI records the payment and marks the bill paid", async ({ page }) => {
    await loginCustomer(page);
    await page.goto("/customer/viewPayBill.html");
    await page.click('button[data-bill="B9002"]');
    await page.waitForURL("**/customer/payment.html");

    await expect(page.locator("#billSummary")).toContainText("June 2026");
    await expect(page.locator("#billSummary .row.total")).toContainText("₹1237.50");

    await page.check('input[name="method"][value="UPI"]');
    await expect(page.locator("#upiField")).toBeVisible();
    await page.fill("#upi", "anita@okbank");
    await page.click("#proceedBtn");

    await page.waitForURL("**/customer/paymentSuccess.html");
    await expect(page.locator("h1")).toHaveText("Payment successful");
    await expect(page.locator("#receipt")).toContainText("UPI");
    await expect(page.locator("#receipt .row.total")).toContainText("₹1237.50");

    const data = await store(page);
    expect(data.bills.find((b) => b.id === "B9002").status).toBe("Paid");
    expect(data.payments.filter((p) => p.billId === "B9002")).toHaveLength(1);
    expect(data.payments.find((p) => p.billId === "B9002").method).toBe("UPI");
  });

  test("a malformed UPI id blocks the payment", async ({ page }) => {
    await loginCustomer(page);
    await page.goto("/customer/viewPayBill.html");
    await page.click('button[data-bill="B9002"]');
    await page.waitForURL("**/customer/payment.html");
    await page.check('input[name="method"][value="UPI"]');
    await page.fill("#upi", "nope");
    await page.click("#proceedBtn");
    await expect(page).toHaveURL(/payment\.html$/);
    const data = await store(page);
    expect(data.bills.find((b) => b.id === "B9002").status).toBe("Unpaid");
  });

  test("paying by card validates the form, then completes", async ({ page }) => {
    await loginCustomer(page);
    await page.goto("/customer/viewPayBill.html");
    await page.click('button[data-bill="B9002"]');
    await page.waitForURL("**/customer/payment.html");
    await page.click("#proceedBtn");                       // Card is the default method
    await page.waitForURL("**/customer/cardDetails.html");

    /* an incomplete card number is refused */
    await page.fill("#cardName", "Anita Menon");
    await page.fill("#cardNumber", "4111");
    await page.fill("#expiry", "08/30");
    await page.fill("#cvv", "123");
    await page.click("#payBtn");
    await expect(page).toHaveURL(/cardDetails\.html$/);

    /* the live preview formats the number in groups of four */
    await page.fill("#cardNumber", "4111111111111111");
    await expect(page.locator("#pvNum")).toHaveText("4111 1111 1111 1111");
    await expect(page.locator("#pvName")).toHaveText("ANITA MENON");

    await page.click("#payBtn");
    await page.waitForURL("**/customer/paymentSuccess.html");
    await expect(page.locator("#receipt")).toContainText("Card");

    const data = await store(page);
    expect(data.bills.find((b) => b.id === "B9002").status).toBe("Paid");
  });

  test("opening checkout with no pending bill returns to the bill list", async ({ page }) => {
    await loginCustomer(page);
    await page.goto("/customer/payment.html");
    await page.waitForURL("**/customer/viewPayBill.html");
  });
});
