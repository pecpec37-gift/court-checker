/**
 * 表示期間を開始日・期間ラベル（サイトのプリセット「1日」「1週間」
 * 「2週間」「1ヶ月」のいずれか）で設定し、対象曜日（土・日・祝）で
 * 絞り込んで施設別空き状況（table.table-schedule）を表示する。
 *
 * 絞り込みがサイト側で効かず全曜日が表示される事象が散発したため、
 * タイミングに依存しないよう次のようにしている。
 *  - チェックボックスは「未チェックの時だけ」クリックし、状態を検証する
 *    （クリックの二重実行でトグルが戻る事故を防ぐ）。
 *  - 「表示」後は固定待機ではなく、グリッド見出しが土・日・祝だけに
 *    なるまで待つ（Ajax更新前の古い全曜日表示を掴まない）。
 *  - それでも駄目なら条件設定からやり直す（最大 MAX_ATTEMPTS 回）。
 * 最終的な保険として index.js 側でも日本の祝日判定による除外を行う。
 */
const MAX_ATTEMPTS = 3;
const GRID_WAIT_MS = 10000;

// 「土曜日」等のラベルに対応するチェックボックスの状態を返す
function readChecked(page, label) {
  return page.evaluate((label) => {
    const l = Array.from(document.querySelectorAll("label")).find(
      (el) => el.textContent.trim() === label
    );
    const input = l && l.htmlFor ? document.getElementById(l.htmlFor) : null;
    return input ? input.checked : null;
  }, label);
}

async function ensureChecked(page, label) {
  for (let i = 0; i < 3; i++) {
    if ((await readChecked(page, label)) === true) return;
    await page.getByText(label, { exact: true }).click();
    await page.waitForTimeout(300);
  }
  if ((await readChecked(page, label)) !== true) {
    throw new Error(`「${label}」のチェックを入れられませんでした`);
  }
}

// 表示中のグリッドの列見出しのうち、土・日・祝以外のものを返す
// （土=sat、日・祝=sun クラス。グリッドが無ければ null）
function findWeekdayColumns(page) {
  return page.evaluate(() => {
    const ths = document.querySelectorAll("table.table-schedule thead th.custom-th");
    if (ths.length === 0) return null;
    return Array.from(ths)
      .filter((th) => !th.classList.contains("sat") && !th.classList.contains("sun"))
      .map((th) => th.textContent.replace(/\s+/g, ""));
  });
}

async function applyFilter(page, { startDate, targetDaysOfWeek, periodLabel }) {
  await page.getByRole("textbox", { name: "表示期間" }).fill(startDate);
  await page.getByText(periodLabel, { exact: true }).click();

  await page.getByRole("button", { name: "その他の条件で絞り込む" }).click();
  for (const day of targetDaysOfWeek) {
    await ensureChecked(page, day);
  }

  await page.getByRole("button", { name: "表示", exact: true }).click();
  await page.waitForSelector("table.table-schedule");

  // 見出しが土日祝だけになるまで待つ。念のため少し置いて再確認し、
  // 更新途中の状態を掴んでいないことを確かめる。
  await page
    .waitForFunction(
      () => {
        const ths = document.querySelectorAll("table.table-schedule thead th.custom-th");
        return (
          ths.length > 0 &&
          Array.from(ths).every((th) => th.classList.contains("sat") || th.classList.contains("sun"))
        );
      },
      null,
      { timeout: GRID_WAIT_MS }
    )
    .catch(() => {});
  await page.waitForTimeout(1000);
}

async function filterResults(page, options) {
  let bad = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await applyFilter(page, options);
    bad = await findWeekdayColumns(page);
    if (bad && bad.length === 0) {
      if (attempt > 1) console.warn(`[filterResults] ${attempt}回目の試行で絞り込み成功`);
      return;
    }
    console.warn(
      `[filterResults] 絞り込みが未反映 (試行${attempt}/${MAX_ATTEMPTS}): ` +
        (bad ? `平日列 ${bad.slice(0, 5).join(", ")}` : "グリッドなし")
    );
  }
  throw new Error(`土日祝の絞り込みが効きませんでした: ${bad ? bad.join(", ") : "グリッドなし"}`);
}

module.exports = { filterResults };
