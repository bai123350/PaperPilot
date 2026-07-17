import { expect, test } from "@playwright/test";

test("creates an evidence report and opens its source record", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page.getByRole("link", { name: "新建研究" }).first().click();

  await page.getByLabel("研究问题").fill(
    "What evidence supports circulating biomarkers for predicting treatment response?",
  );
  await page.getByLabel("研究人群").fill("Adults receiving systemic therapy");
  await page.getByRole("button", { name: "开始研究" }).click();

  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByRole("heading", { name: "研究报告", exact: true })).toBeVisible();
  await expect(page.getByTestId("recommendation-card")).toHaveCount(3);
  await page.getByRole("button", { name: "查看证据" }).click();
  await expect(page.getByRole("complementary", { name: "证据详情" })).toBeVisible();
  await expect(page.getByText("PMID", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("report-with-evidence.png"), fullPage: true });
  await page.getByRole("button", { name: "关闭证据" }).click();
  await page.screenshot({ path: testInfo.outputPath("report-workspace.png") });
});
