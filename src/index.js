const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const settings = require("../config/settings");
const { searchOutdoorTennis, selectFacilities } = require("./steps/search");
const { filterResults } = require("./steps/filterResults");
const { collectAllAvailability } = require("./steps/collectAvailability");
const { mergeConsecutiveSlots } = require("./lib/formatSlots");
const { buildHtml } = require("./lib/buildHtml");

function tomorrowAsYyyyMmDd() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  let rawSlots = [];

  // トップページから「施設別空き状況が表示された状態」までを一気に行う。
  // 空きコマが多い場合、時間帯別空き状況を複数バッチに分けて見に行く必要が
  // あり、そのたびにこの手順を最初からやり直す（collectAllAvailability 参照）。
  async function navigate() {
    await page.goto(settings.site.topUrl);
    await searchOutdoorTennis(page);
    await selectFacilities(page, settings.facilityNames);
    await filterResults(page, {
      startDate: tomorrowAsYyyyMmDd(),
      targetDaysOfWeek: settings.targetDaysOfWeek,
    });
  }

  try {
    await navigate();

    // 施設別空き状況 → 時間帯別空き状況 を巡回して空きコマを収集
    rawSlots = await collectAllAvailability(page, {
      batchSize: settings.batchSize,
      navigate,
    });
  } catch (err) {
    if (process.env.DEBUG_SCREENSHOT_PATH) {
      await page
        .screenshot({ path: process.env.DEBUG_SCREENSHOT_PATH, fullPage: true })
        .catch(() => {});
    }
    throw err;
  } finally {
    await context.close();
    await browser.close();
  }

  const mergedSlots = mergeConsecutiveSlots(rawSlots);
  const html = buildHtml(mergedSlots, settings.facilityNames, new Date());

  const outputPath = path.resolve(__dirname, "..", settings.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf-8");

  console.log(`空きコマ ${mergedSlots.length} 件を ${outputPath} に出力しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
