import { expect, test } from "@playwright/test";

test("creates an evidence report and opens its source record", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page.locator('a[href="/projects/new"]').first().click();

  await page.getByLabel("给 PaperPilot 发送研究问题").fill(
    "What evidence supports circulating biomarkers for predicting treatment response?",
  );
  await page.getByText("研究设置与 PDF", { exact: true }).click();
  await page.getByLabel("研究人群").fill("Adults receiving systemic therapy");
  await page.getByRole("button", { name: "发送研究问题" }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "研究对话" })).toBeVisible();
  await expect(page.getByRole("article", { name: /研究操作：/ }).first()).toBeVisible();
  await expect(page.getByText(/Evidence-first report/)).toBeVisible();
  await expect(page.getByTestId("recommendation-card")).toHaveCount(3);
  await expect(page.getByTestId("dataset-card")).toHaveCount(5);
  await page.getByRole("button", { name: "ATAC 1" }).click();
  await expect(page.getByTestId("dataset-card")).toHaveCount(1);
  await page.getByRole("button", { name: "全部 5" }).click();
  await expect(page.getByTestId("dataset-card")).toHaveCount(5);
  await page.getByRole("button", { name: "查看证据" }).click();
  await expect(page.getByRole("complementary", { name: "证据详情" })).toBeVisible();
  await expect(page.getByText("PMID", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("report-with-evidence.png"), fullPage: true });
  await page.getByRole("button", { name: "关闭证据" }).click();
  await page.screenshot({ path: testInfo.outputPath("report-workspace.png") });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
