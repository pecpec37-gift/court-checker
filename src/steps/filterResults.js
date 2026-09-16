/**
 * 表示期間を「1ヶ月」にし、対象曜日（土・日・祝）で絞り込んで
 * 施設別空き状況（table.table-schedule）を表示する。
 */
async function filterResults(page, { startDate, targetDaysOfWeek }) {
  await page.getByRole("textbox", { name: "表示期間" }).fill(startDate);
  await page.getByText("1ヶ月", { exact: true }).click();

  await page.getByRole("button", { name: "その他の条件で絞り込む" }).click();
  for (const day of targetDaysOfWeek) {
    await page.getByText(day, { exact: true }).click();
  }

  await page.getByRole("button", { name: "表示", exact: true }).click();
  await page.waitForSelector("table.table-schedule");
  // 「表示」後、テーブルの中身がAjaxで非同期に更新されるため、
  // 要素の存在確認だけでは古いデータのままクリックしてしまう。
  // 十分な待機を入れてから内容を読み取る。
  await page.waitForTimeout(1500);
}

module.exports = { filterResults };
