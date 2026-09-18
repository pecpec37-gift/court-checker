const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const settings = require("../config/settings");
const { searchOutdoorTennis, selectFacilities } = require("./steps/search");
const { filterResults } = require("./steps/filterResults");
const { collectAllAvailability, listAllDates } = require("./steps/collectAvailability");
const { normalizeSlot, mergeNormalizedSlots } = require("./lib/formatSlots");
const { buildHtml } = require("./lib/buildHtml");
const { loadPreviousSnapshot, saveSnapshot, computeNewlyVacantSlots } = require("./lib/snapshot");

function tomorrowAsDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

function toYyyyMmDd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * サイトの表示期間プリセットには「45日間」が無く、選べるのは
 * 「1日」「1週間」「2週間」「1ヶ月」のみ。そのため「翌日から1ヶ月」＋
 * 「そこから2週間」の2回に分けて照会し、結果を合算することで
 * 「翌日から約45日間」を実現する（詳細はCLAUDE.md参照）。
 */
function buildQueryWindows() {
  const tomorrow = tomorrowAsDate();
  return [
    { startDate: toYyyyMmDd(tomorrow), periodLabel: "1ヶ月" },
    { startDate: toYyyyMmDd(addMonths(tomorrow, 1)), periodLabel: "2週間" },
  ];
}

function dedupeCoveredDates(coveredDates) {
  const seen = new Set();
  const result = [];
  for (const item of coveredDates) {
    const key = `${item.facilityName}|${item.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function dedupeNormalizedSlots(slots) {
  const seen = new Set();
  const result = [];
  for (const slot of slots) {
    const key = [
      slot.facilityName,
      slot.year,
      slot.month,
      slot.day,
      slot.courtName,
      slot.timeFrom,
      slot.timeTo,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(slot);
  }
  return result;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  let coveredDates = [];
  let normalizedSlots = [];

  const queryWindows = buildQueryWindows();

  try {
    for (const queryWindow of queryWindows) {
      // トップページから「施設別空き状況が表示された状態」までを一気に行う。
      // 空きコマが多い場合、時間帯別空き状況を複数バッチに分けて見に行く
      // 必要があり、そのたびにこの手順を最初からやり直す
      // （collectAllAvailability 参照）。
      async function navigate() {
        await page.goto(settings.site.topUrl);
        await searchOutdoorTennis(page);
        await selectFacilities(page, settings.facilityNames);
        await filterResults(page, {
          startDate: queryWindow.startDate,
          targetDaysOfWeek: settings.targetDaysOfWeek,
          periodLabel: queryWindow.periodLabel,
        });
      }

      await navigate();

      // 施設別空き状況グリッドが表示された直後に、今回の照会がカバーする
      // (施設, 日付) を空き状況に関わらず全て記録しておく（増加分判定の基準）。
      coveredDates.push(...(await listAllDates(page)));

      // 施設別空き状況 → 時間帯別空き状況 を巡回して空きコマを収集
      const rawSlots = await collectAllAvailability(page, {
        batchSize: settings.batchSize,
        navigate,
      });
      normalizedSlots.push(...rawSlots.map(normalizeSlot));
    }
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

  // 2回に分けて照会したウィンドウの境界で日付が重複することがあるため、
  // (施設, 日付) 単位・コマ単位でそれぞれ重複を除いておく。
  coveredDates = dedupeCoveredDates(coveredDates);
  normalizedSlots = dedupeNormalizedSlots(normalizedSlots);

  const mergedSlots = mergeNormalizedSlots(normalizedSlots);

  const snapshotPath = path.resolve(__dirname, "..", settings.previousSnapshotPath);
  const previousSnapshot = loadPreviousSnapshot(snapshotPath);
  const { hasPrevious, previousGeneratedAt, newSlots } = computeNewlyVacantSlots(
    previousSnapshot,
    normalizedSlots
  );
  const increaseSlots = mergeNormalizedSlots(newSlots);

  const generatedAt = new Date();
  const html = buildHtml(mergedSlots, settings.facilityNames, generatedAt, {
    hasPrevious,
    previousGeneratedAt,
    increaseSlots,
  });

  const outputPath = path.resolve(__dirname, "..", settings.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf-8");

  saveSnapshot(snapshotPath, {
    generatedAt: generatedAt.toISOString(),
    coveredDates,
    slots: normalizedSlots,
  });

  console.log(
    `空きコマ ${mergedSlots.length} 件（うち増加分 ${increaseSlots.length} 件）を ${outputPath} に出力しました。`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
