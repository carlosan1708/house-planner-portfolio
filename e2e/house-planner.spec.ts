import { expect, test, type Locator, type Page } from "@playwright/test";

async function dragAestheticCardToTray(page: Page, card: Locator, folderName: RegExp) {
  const handle = card.locator(".aesthetic-card-drag-handle");
  await handle.scrollIntoViewIfNeeded();
  const source = await handle.boundingBox();
  if (!source) throw new Error("Aesthetic drag source is not visible");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x - 12, source.y + source.height + 12, { steps: 4 });
  const destination = page.locator(".aesthetic-drag-tray").getByRole("button", { name: folderName });
  await expect(destination).toBeVisible();
  const target = await destination.boundingBox();
  if (!target) throw new Error("Aesthetic drag destination is not visible");
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 });
  await page.mouse.up();
}

test.describe("public demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?mode=demo");
    await expect(page.getByText("Demo with fictional data")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Explore House Planner" })).toBeVisible();
  });

  test("shows the dashboard and basic editor without a redundant advanced spreadsheet", async ({ page }) => {
    await page.getByRole("button", { name: /Budget/ }).click();
    await expect(page.getByRole("heading", { name: "Budget dashboard" })).toBeVisible();
    await page.locator(".chart-legend button").first().click();
    await expect(page.locator(".budget-table-editor")).toBeVisible();
    await expect(page.getByRole("button", { name: "Advanced spreadsheet", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Dashboard", exact: false }).click();
    await page.getByRole("button", { name: "Edit budget", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "Concrete and reinforcement Paid", exact: true })).toBeVisible();
  });

  test("adds, removes and restores budget rows", async ({ page }) => {
    await page.getByRole("button", { name: /Budget/ }).click();
    await page.getByRole("button", { name: "Edit budget", exact: true }).click();
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page.getByRole("textbox", { name: "Item", exact: true }).fill("New basic item");
    await page.getByRole("button", { name: "Create item", exact: true }).click();
    await page.getByRole("spinbutton", { name: "New basic item Objective", exact: true }).fill("5000");
    await page.getByRole("button", { name: "Remove New basic item", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "New basic item Objective", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "New basic item Objective", exact: true })).toHaveValue("5000");
    await page.getByRole("button", { name: "Dashboard", exact: false }).click();
    await expect(page.locator(".budget-line-list")).toContainText("New basic item");
    await page.getByRole("button", { name: "Edit budget", exact: true }).click();
    await page.getByRole("button", { name: "Remove New basic item", exact: true }).click();
    await page.getByRole("button", { name: "Dashboard", exact: false }).click();
    await expect(page.locator(".budget-line-list")).not.toContainText("New basic item");
  });

  test("edits budget amounts in the focused table and saves before returning to the dashboard", async ({ page }) => {
    await page.getByRole("button", { name: /Budget/ }).click();
    await page.getByRole("button", { name: "Edit budget", exact: true }).click();
    const paid = page.getByRole("spinbutton", { name: "Concrete and reinforcement Paid", exact: true });
    await paid.fill("7000");
    await page.screenshot({ path: "test-results/budget-table-desktop.png", fullPage: true });
    await page.getByRole("button", { name: "Dashboard", exact: false }).click();
    await expect(page.getByRole("heading", { name: "Budget dashboard" })).toBeVisible();
    await expect(page.locator(".budget-metrics")).toContainText("$7,000");
    await page.getByRole("button", { name: "Edit budget", exact: true }).click();
    await expect(paid).toHaveValue("7000");
    await paid.fill("-5");
    await page.getByRole("button", { name: "Dashboard", exact: false }).click();
    await expect(page.locator(".budget-table-editor")).toBeVisible();
    await expect(page.locator(".budget-table-editor").getByRole("alert")).toContainText("valid amount");
    await paid.fill("0");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "test-results/budget-table-mobile.png", fullPage: true });
    await expect(page.locator(".budget-table-scroll")).toBeVisible();
    await page.getByRole("button", { name: "Dashboard", exact: false }).click();
    await expect(page.locator(".budget-metrics")).toContainText("0");
  });

  test("keeps actual spending inside the workbook without a separate add-expense action", async ({ page }) => {
    await page.getByRole("button", { name: /Budget/ }).click();
    await expect(page.getByRole("button", { name: "Add expense" })).toHaveCount(0);
    await expect(page.locator(".budget-chart-card").nth(1)).toContainText("of category budget");
  });

  test("uses immediate folder navigation without an aggregate view", async ({ page }) => {
    await page.getByRole("button", { name: /Documents/ }).click();
    await expect(page.getByText("All documents")).toHaveCount(0);
    await expect(page.getByText("All project files")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Featured documents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Factura" })).toHaveCount(0);
    await expect(page.getByText("Demo_Invoice.txt")).toHaveCount(0);
  });

  test("shows products and independent documents inside Purchases/Expenses", async ({ page }) => {
    await page.getByRole("button", { name: /Purchases\/Expenses/ }).click();
    await expect(page.locator(".expense-tabs").getByRole("button", { name: /Products/ })).toHaveClass(/active/);
    await expect(page.getByRole("heading", { name: "Kitchen faucet" })).toBeVisible();
    await page.locator(".purchase-cover").click();
    await expect(page.locator(".purchase-detail")).toContainText("Kitchen faucet");
    await page.locator(".purchase-detail > .close").click();
    await page.getByRole("button", { name: "Upload receipts", exact: true }).click();
    const independentDocument = page.locator(".expense-form");
    await expect(independentDocument.getByLabel(/Description.*optional/)).toHaveValue("");
    await expect(independentDocument.getByLabel(/Amount.*optional/)).toHaveCount(0);
    await expect(independentDocument.getByRole("checkbox")).toHaveCount(0);
    await expect(independentDocument).toContainText("No amount, installment or budget line is needed");
    await independentDocument.locator(".close").click();
    await page.locator(".expense-tabs").getByRole("button", { name: /Documents/ }).click();
    await expect(page.getByRole("heading", { name: "Faucet invoice" })).toBeVisible();
    await expect(page.locator(".document-card")).toContainText("Kitchen faucet");
    await expect(page.locator(".document-card")).toContainText("Kitchen cabinetry");
  });

  test("keeps Excel history alongside independent payment capture", async ({ page }) => {
    await page.getByRole("button", { name: /Purchases\/Expenses/ }).click();
    await expect(page.getByText("Save receipts whenever you have them.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record payment", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add expense" })).toHaveCount(0);
    await page.getByRole("button", { name: /Paid lines/ }).click();
    await expect(page.getByRole("heading", { name: "Paid budget lines" })).toBeVisible();
    await expect(page.getByText("1 of 1 budget lines")).toBeVisible();
    await page.getByLabel("Search", { exact: true }).fill("missing budget line");
    await expect(page.getByText("No budget lines match these filters")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
    await page.locator(".paid-filter-controls select").nth(0).selectOption({ label: "Finishes" });
    await page.locator(".paid-filter-controls select").nth(1).selectOption("with-files");
    const paidLine = page.locator(".paid-line");
    await expect(paidLine).toContainText("Kitchen cabinetry");
    await paidLine.locator("summary").first().click();
    await expect(paidLine).toContainText("Kitchen faucet");
    await expect(paidLine).toContainText("Faucet invoice");
    await paidLine.locator(".attach-menu > summary").click();
    await expect(paidLine.getByRole("button", { name: /New purchase/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  });

  test("shows folder-specific aesthetic carousels on desktop and mobile", async ({ page }) => {
    await page.setViewportSize({ width: 985, height: 900 });
    const aestheticsMenu = page.getByRole("button", { name: /Aesthetics/ });
    await expect(aestheticsMenu).toBeVisible();
    expect(await aestheticsMenu.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(0);
    await aestheticsMenu.click();
    await expect(page.getByRole("heading", { name: "Aesthetics", level: 2 })).toBeVisible();
    await expect(page.locator(".aesthetic-stage")).toContainText("Main living room.jpg");
    await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(3);
    const plansFolder = page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Plans/ });
    await expect(plansFolder).toContainText("0 PDF");
    await plansFolder.click();
    await expect(page.getByRole("heading", { name: "Plans", level: 3, exact: true })).toBeVisible();
    await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles({
      name: "kitchen-plan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF"),
    });
    const planCard = page.locator(".aesthetic-grid article").filter({ hasText: "kitchen-plan.pdf" });
    await expect(planCard).toBeVisible();
    await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(0);
    await planCard.getByRole("button", { name: "Show in carousel" }).click();
    const carouselPdf = page.locator(".aesthetic-pdf-stage");
    await expect(carouselPdf.locator("iframe")).toBeVisible();
    await expect(carouselPdf.getByRole("toolbar", { name: "PDF zoom controls" })).toBeVisible();
    await expect(carouselPdf.locator("iframe")).toHaveAttribute("src", /#zoom=100$/);
    await carouselPdf.getByRole("button", { name: "Zoom in" }).click();
    await expect(carouselPdf.locator("iframe")).toHaveAttribute("src", /#zoom=125$/);
    await carouselPdf.getByRole("button", { name: "Reset zoom to 100%" }).click();
    await expect(carouselPdf.locator("iframe")).toHaveAttribute("src", /#zoom=100$/);
    await carouselPdf.getByRole("button", { name: "Open plan" }).click();
    const planViewer = page.getByRole("dialog", { name: "kitchen-plan.pdf" });
    await expect(planViewer).toBeVisible();
    await expect(planViewer.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await planViewer.getByRole("button", { name: "Zoom in" }).click();
    await expect(planViewer.locator("iframe")).toHaveAttribute("src", /#zoom=125$/);
    await planViewer.locator(".close").click();
    await page.setViewportSize({ width: 390, height: 844 });
    const pdfMobileWidth = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(pdfMobileWidth.content).toBeLessThanOrEqual(pdfMobileWidth.viewport);
    await expect(carouselPdf.getByRole("toolbar", { name: "PDF zoom controls" })).toBeVisible();
    await page.setViewportSize({ width: 985, height: 900 });
    await expect(page.locator(".aesthetic-thumbnail-card")).toHaveCount(1);
    await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /^Interior/ }).click();
    let nativeDialog = false;
    page.once("dialog", async (dialog) => { nativeDialog = true; await dialog.dismiss(); });
    await page.getByRole("button", { name: "New folder" }).click();
    await expect(page.getByRole("dialog", { name: "Create folder" })).toBeVisible();
    expect(nativeDialog).toBe(false);
    await page.getByLabel("Folder name").fill("QA finishes");
    await page.getByRole("button", { name: "Save folder" }).click();
    await expect(page.getByRole("heading", { name: "QA finishes", level: 3 })).toBeVisible();
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("Folder name").fill("QA materials");
    await page.getByRole("button", { name: "Save folder" }).click();
    await expect(page.getByRole("heading", { name: "QA materials", level: 3 })).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const deleteFolderDialog = page.getByRole("alertdialog", { name: "Delete folder?" });
    await expect(deleteFolderDialog).toBeVisible();
    await deleteFolderDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: /QA materials/ })).toHaveCount(0);
    await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /^Interior/ }).click();
    const uploadDropzone = page.getByRole("button", { name: "Drop images here or choose files" });
    const uploadTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "dragged-inspiration.png", { type: "image/png" }));
      return transfer;
    });
    await uploadDropzone.dispatchEvent("dragenter", { dataTransfer: uploadTransfer });
    await expect(uploadDropzone).toHaveClass(/dragging/);
    await uploadDropzone.dispatchEvent("drop", { dataTransfer: uploadTransfer });
    await expect(page.locator(".aesthetic-grid article").filter({ hasText: "dragged-inspiration.png" })).toBeVisible();
    await expect(page.getByText("Drop images onto visual folders or PDFs onto Plans.")).toBeVisible();
    const gardenFolder = page.locator(".aesthetic-folder-strip").getByRole("button", { name: /Exterior/ });
    const folderTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "garden-drop.png", { type: "image/png" }));
      return transfer;
    });
    await gardenFolder.dispatchEvent("dragenter", { dataTransfer: folderTransfer });
    await expect(gardenFolder).toHaveClass(/drop-hover/);
    await gardenFolder.dispatchEvent("drop", { dataTransfer: folderTransfer });
    await expect(page.getByRole("heading", { name: "Exterior", level: 3 })).toBeVisible();
    await expect(page.locator(".aesthetic-grid article").filter({ hasText: "garden-drop.png" })).toBeVisible();
    await expect(gardenFolder).toContainText("2 images");
    await page.locator(".aesthetic-folder-strip").getByRole("button", { name: /^Interior/ }).click();
    const firstThumbnail = page.locator(".aesthetic-thumbnail-card").nth(0);
    const secondThumbnail = page.locator(".aesthetic-thumbnail-card").nth(1);
    await firstThumbnail.dragTo(secondThumbnail);
    await expect(page.locator(".aesthetic-thumbnail-preview").nth(0)).toHaveAccessibleName(/Kitchen/);
    await dragAestheticCardToTray(page, page.locator(".aesthetic-grid article").filter({ hasText: "Main living room.jpg" }), /Exterior/);
    await expect(gardenFolder).toContainText("3 images");
    await gardenFolder.click();
    await page.getByLabel("Move Main living room.jpg to folder").selectOption({ label: "Interior" });
    await expect(page.locator(".aesthetic-folder-strip").getByRole("button", { name: /^Interior/ })).toContainText("4 images");
    await expect(page.locator(".aesthetic-stage")).toContainText("Terrace.jpg");
    await page.setViewportSize({ width: 390, height: 844 });
    const width = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
    await page.getByRole("navigation", { name: "Project sections", exact: true }).getByRole("button", { name: "Sections", exact: true }).click();
    await page.getByRole("dialog", { name: "Sections", exact: true }).getByRole("button", { name: /Site progress/ }).click();
    await expect(page.getByRole("heading", { name: "Site progress", level: 2 })).toBeVisible();
  });

  test("keeps document rows within a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /Documents/ }).click();
    await expect(page.getByRole("heading", { name: "Documents and folders" })).toBeVisible();
    const width = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  });

  test("presents site tracking as Site progress", async ({ page }) => {
    await page.getByRole("button", { name: /Site progress/ }).click();
    await expect(page.getByRole("heading", { name: "Site progress", level: 2 })).toBeVisible();
    await page.getByRole("button", { name: "New report" }).click();
    await expect(page.getByRole("heading", { name: "Progress entry" })).toBeVisible();
  });

  test("shows bilingual unified activity and keeps it inside a mobile viewport", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Project activity" })).toBeVisible();
    await page.getByRole("button", { name: "View all" }).click();
    await expect(page.getByRole("heading", { name: "Project activity" })).toBeVisible();
    await expect(page.getByText(/linked “Kitchen_invoice\.pdf”/)).toBeVisible();
    await page.getByText(/View 2 changes/).click();
    await expect(page.locator(".activity-change del").filter({ hasText: "$400" })).toBeVisible();
    await page.getByRole("button", { name: "ES", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Actividad del proyecto" })).toBeVisible();
    await expect(page.getByText(/vinculó “Factura_cocina\.pdf”/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const width = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  });

  test("configures countdown recipients without sending email from the demo", async ({ page }) => {
    await page.getByRole("button", { name: /Plan & schedule/ }).click();
    await expect(page.getByRole("heading", { name: "Countdown reminders" })).toBeVisible();
    await expect(page.getByText("Email disabled in demo")).toBeVisible();
    await expect(page.getByText("The public demo never sends external messages.")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Demo Visitor/ })).toBeChecked();
    await page.getByPlaceholder("What needs a reminder?").fill("QA email countdown");
    await page.getByRole("button", { name: "Start countdown" }).click();
    await expect(page.getByRole("heading", { name: "QA email countdown" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const width = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  });

  test("shows proposed approval values before approve or reject", async ({ page }) => {
    await page.getByRole("button", { name: /Approvals/ }).click();
    await expect(page.getByRole("heading", { name: "Approval history" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "20% labor adjustment and scope review" })).toBeVisible();
    await expect(page.getByText("General labor", { exact: true })).toBeVisible();
    await expect(page.getByText("2 line items from the same crew")).toBeVisible();
    await expect(page.getByText("Electrical excluded")).toBeVisible();
    await expect(page.getByText("$1,500 → $1,800")).toBeVisible();
    await page.getByText("Review the 2 included line items").click();
    await expect(page.getByRole("columnheader", { name: "Before" }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "After" }).first()).toBeVisible();
    await expect(page.getByText("Roof structure and covering labor").first()).toBeVisible();
    await expect(page.getByText("$1,000")).toBeVisible();
    await expect(page.getByText("$1,200")).toBeVisible();
    await expect(page.getByText("Show 1 automatically recalculated cells")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  });
});
