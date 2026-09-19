/**
 * 表示期間を開始日・期間ラベル（サイトのプリセット「1日」「1週間」
 * 「2週間」「1ヶ月」のいずれか）で設定し、対象曜日（土・日・祝）で
 * 絞り込んで施設別空き状況（table.table-schedule）を表示する。
 *
 * 絞り込みがサイト側で効かず全曜日が表示される事象が散発したため、
 * 表示後にグリッドのヘッダ（土=sat / 日・祝=sun クラス）を検査し、
 * 平日が混じっていたら条件設定からやり直す。
 */
const MAX_ATTEMPTS = 3;

async function applyFilter(page, { startDate, targetDaysOfWeek, periodLabel }) {
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

// 表示中のグリッドに、土・日・祝以外の日付列があれば、その日付一覧を返す。
async function findWeekdayColumns(page) {
  return page.evaluate(() => {
    const bad = [];
    document.querySelectorAll("table.table-schedule thead th.custom-th").forEach((th) => {
      if (!th.classList.contains("sat") && !th.classList.contains("sun")) {
        bad.push(th.textContent.trim());
      }
    });
    return bad;
  });
}

async function filterResults(page, options) {
  let bad = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await applyFilter(page, options);
    bad = await findWeekdayColumns(page);
    if (bad.length === 0) return;
    console.warn(
      `[filterResults] 平日が混入 (試行${attempt}/${MAX_ATTEMPTS}): ${bad.slice(0, 5).join(", ")}`
    );
    await page.waitForTimeout(1500);
  }
  throw new Error(`土日祝の絞り込みが効きませんでした: ${bad.join(", ")}`);
}

module.exports = { filterResults };
