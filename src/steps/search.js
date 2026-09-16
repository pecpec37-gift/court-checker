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

async function selectFacilities(page, facilityNames) {
  for (const facilityName of facilityNames) {
    await page.getByText(facilityName, { exact: true }).first().click();
    await page.getByRole("checkbox", { name: facilityName }).check();
  }
  await page.getByRole("button", { name: "次へ進む" }).click();
}

module.exports = { searchOutdoorTennis, selectFacilities };
