/**
 * ログインせずに「利用目的から探す」→「屋外スポーツ」→「テニス（屋外）」で検索し、
 * 対象施設（複数可）を選んで次へ進む。
 */
async function searchOutdoorTennis(page) {
  await page.getByRole("tab", { name: "利用目的から探す" }).click();

  // 「屋外スポーツ」のテキストをクリックしてパネルを開かないと、
  // 中の項目（テニス（屋外）など）が現れずチェックできない。
  await page.getByText("屋外スポーツ").click();
  await page.getByRole("radio", { name: "屋外スポーツ" }).check();

  await page.getByText("テニス（屋外）").click();
  await page.getByRole("checkbox", { name: "テニス（屋外）" }).check();

  await page.getByRole("button", { name: "検索" }).click();
}

// 「さらに読み込む」を押せる上限（無限ループ防止）
const MAX_LOAD_MORE = 10;

async function selectFacilities(page, facilityNames) {
  const remaining = new Set(facilityNames);
  const selected = [];

  // 施設一覧の描画完了を待つ（最初の施設 or 「さらに読み込む」が現れるまで）
  await page
    .locator('input[type="checkbox"]')
    .first()
    .waitFor({ state: "attached" });
  await page.waitForTimeout(1000);

  for (let loaded = 0; ; loaded++) {
    // 現在表示されている一覧の中にある対象施設にチェックを入れる
    for (const facilityName of [...remaining]) {
      const checkbox = page.getByRole("checkbox", { name: facilityName });
      if ((await checkbox.count()) === 0) continue;
      const label = page.getByText(facilityName, { exact: true }).first();
      if (await label.count()) await label.click();
      await checkbox.first().check();
      remaining.delete(facilityName);
      selected.push(facilityName);
    }
    if (remaining.size === 0) break;

    // 未チェックの施設が残っていれば「さらに読み込む」で次ページを表示する
    const loadMore = page.getByText("さらに読み込む").first();
    if (loaded >= MAX_LOAD_MORE || (await loadMore.count()) === 0 || !(await loadMore.isVisible())) {
      break;
    }
    const before = await page.getByRole("checkbox").count();
    await loadMore.click();
    await page
      .waitForFunction(
        (n) => document.querySelectorAll('input[type="checkbox"]').length > n,
        before,
        { timeout: 10000 }
      )
      .catch(() => {});
    await page.waitForTimeout(500);
  }

  if (remaining.size > 0) {
    const msg = `[selectFacilities] チェックできなかった施設: ${[...remaining].join("、")}`;
    console.warn(msg);
    if (selected.length === 0) throw new Error(msg);
  }
  console.log(`[selectFacilities] チェック済み: ${selected.join("、")}`);

  await page.getByRole("button", { name: "次へ進む" }).click();
}

module.exports = { searchOutdoorTennis, selectFacilities };
