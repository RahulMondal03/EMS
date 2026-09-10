const { test, expect } = require("./fixtures");
const { MANAGER, AGENT, loginCustomer, loginEmployee, store } = require("./helpers");

test.describe("complaint lifecycle", () => {
  test("a short description is rejected", async ({ page }) => {
    await loginCustomer(page);
    await page.goto("/customer/registerComplaint.html");
    await page.selectOption("#type", { index: 1 });
    await page.fill("#description", "too short");
    await page.click("#submitBtn");
    await expect(page.locator("#alert")).not.toHaveClass(/show/);
    const data = await store(page);
    expect(data.complaints).toHaveLength(1);            // only the seeded one
  });

  test("a customer files a complaint and sees it on the status page", async ({ page }) => {
    await loginCustomer(page);
    await page.goto("/customer/registerComplaint.html");
    await page.selectOption("#type", { index: 1 });
    await page.fill("#description", "Meter box sparks whenever the pump starts up.");
    await page.click("#submitBtn");

    await expect(page.locator("#alert")).toContainText("K7002");
    await expect(page.locator("#description")).toHaveValue("");

    const data = await store(page);
    const filed = data.complaints.find((k) => k.id === "K7002");
    expect(filed.customerId).toBe("C1001");
    expect(filed.status).toBe("Open");
    expect(filed.assignedTo).toBeNull();

    await page.goto("/customer/complaintStatus.html");
    await expect(page.locator("#complaintList")).toContainText("K7002");
    await expect(page.locator("#complaintList")).toContainText("Complaint registered");
  });

  test("a manager assigns an open complaint down to a field agent", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/complaintManagement.html");

    const row = page.locator("#complaintRows tr", { hasText: "K7001" });
    await expect(row.locator(".badge")).toHaveText("Open");
    await row.locator('select[data-assign="K7001"]').selectOption("E503");

    await expect(row.locator(".badge")).toHaveText("Assigned");
    await expect(row).toContainText("Arjun Rao");

    const data = await store(page);
    const k = data.complaints.find((c) => c.id === "K7001");
    expect(k.assignedTo).toBe("E503");
    expect(k.status).toBe("Assigned");
  });

  test("the assign dropdown only offers people below your own tier", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/complaintManagement.html");
    const options = await page.locator('select[data-assign="K7001"] option').allInnerTexts();
    /* Grid Manager (tier 3) reaches the Supervisor and the Field Agent, not themselves */
    expect(options).toEqual([
      "Choose employee…",
      "Priya Das · Supervisor",
      "Arjun Rao · Field Agent",
    ]);
  });

  test("an assigned complaint reaches the agent's queue and can be resolved", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/complaintManagement.html");
    await page.locator('select[data-assign="K7001"]').selectOption("E503");
    await page.click("#logoutBtn");
    await page.waitForURL("**/employee/login.html");

    await loginEmployee(page, AGENT);
    await expect(page.locator("#statAssigned")).toHaveText("1");
    const row = page.locator("#queueRows tr", { hasText: "K7001" });
    await expect(row.locator(".badge")).toHaveText("Assigned");

    await row.locator('a:has-text("Update")').click();
    await page.waitForURL("**/employee/updateStatus.html?id=K7001");
    await expect(page.locator("#title")).toHaveText("Update K7001");

    await page.selectOption("#status", "Resolved");
    await page.fill("#note", "Replaced the failed transformer fuse on the Lake View feeder.");
    await page.click("#saveBtn");
    await expect(page.locator("#alert")).toContainText("Resolved");
    await page.waitForURL("**/employee/dashboard.html");

    await expect(page.locator("#statResolved")).toHaveText("1");
    const data = await store(page);
    const k = data.complaints.find((c) => c.id === "K7001");
    expect(k.status).toBe("Resolved");
    expect(k.updates.at(-1).note).toContain("transformer fuse");
  });

  test("an update with too short a note is refused", async ({ page }) => {
    await loginEmployee(page, MANAGER);
    await page.goto("/admin/complaintManagement.html");
    await page.locator('select[data-assign="K7001"]').selectOption("E503");
    await page.goto("/employee/updateStatus.html?id=K7001");
    await page.selectOption("#status", "Resolved");
    await page.fill("#note", "done");
    await page.click("#saveBtn");
    await expect(page).toHaveURL(/updateStatus\.html/);
    const data = await store(page);
    expect(data.complaints.find((c) => c.id === "K7001").status).toBe("Assigned");
  });
});
