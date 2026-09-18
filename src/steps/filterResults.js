/**
 * 表示期間を開始日・期間ラベル（サイトのプリセット「1日」「1週間」
 * 「2週間」「1ヶ月」のいずれか）で設定し、対象曜日（土・日・祝）で
 * 絞り込んで施設別空き状況（table.table-schedule）を表示する。
 */
async function filterResults(page, { startDate, targetDaysOfWeek, periodLabel }) {
  await page.getByRole("textbox", { name: "表示期間" }).fill(startDate);
  await page.getByText(periodLabel, { exact: true }).click();

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
