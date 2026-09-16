/**
 * 施設別空き状況（施設×日付の粗いグリッド）から「空き」「一部空き」の
 * マスを集め、時間帯別空き状況画面（コート×時間帯の詳細グリッド）を
 * 巡回して実際に空いているコマを読み取る。
 *
 * サイト側の制約で、施設別空き状況→時間帯別空き状況へ「次へ進む」際に
 * 選択できる日程は最大10件までのため、settings.batchSize 件ずつに
 * 分割して何度も往復する。
 */

/**
 * 施設別空き状況グリッドから、「空き」「一部空き」の
 * (施設名, 日付) の組み合わせを一覧にする。
 */
async function listAvailableCandidates(page) {
  return page.evaluate(() => {
    const results = [];
    const tables = Array.from(document.querySelectorAll("table.table-schedule"));
    const facilityTitles = Array.from(document.querySelectorAll("h3.facility-title"));

    tables.forEach((table, tableIndex) => {
      const facilityName = facilityTitles[tableIndex]
        ? facilityTitles[tableIndex].textContent.trim()
        : null;

      const labels = Array.from(table.querySelectorAll("label.btn-toggle"));
      labels.forEach((label) => {
        const sr = label.querySelector(".sr-only");
        if (!sr) return;
        const status = sr.textContent.trim();
        if (status !== "一部空き" && status !== "空き") return;

        const td = label.closest("td");
        const useDateInput = td ? td.querySelector('input[name$=".UseDate"]') : null;
        if (!useDateInput) return;

        results.push({
          facilityName,
          date: useDateInput.value.slice(0, 10), // "2026-09-20T00:00:00" -> "2026-09-20"
        });
      });
    });

    return results;
  });
}

/**
 * 施設別空き状況グリッド上で、指定した (施設名, 日付) の組み合わせの
 * マスだけをチェックする。
 *
 * 「前に戻る」で戻ってきた直後も、ブラウザ表示上はチェックが外れて
 * 見えることがあるが、サーバー側の選択状態が残っていることがあるため
 * （前バッチ分が残ったまま次のバッチを選ぶと「最大10件まで」エラーになる）、
 * 対象外のマスは明示的にチェックを外す。
 */
async function selectCandidates(page, candidates) {
  const keys = candidates.map((c) => `${c.facilityName}|${c.date}`);
  return page.evaluate((keys) => {
    const keySet = new Set(keys);
    let changed = 0;
    const tables = Array.from(document.querySelectorAll("table.table-schedule"));
    const facilityTitles = Array.from(document.querySelectorAll("h3.facility-title"));

    tables.forEach((table, tableIndex) => {
      const facilityName = facilityTitles[tableIndex]
        ? facilityTitles[tableIndex].textContent.trim()
        : null;

      const labels = Array.from(table.querySelectorAll("label.btn-toggle"));
      labels.forEach((label) => {
        const td = label.closest("td");
        const useDateInput = td ? td.querySelector('input[name$=".UseDate"]') : null;
        if (!useDateInput) return;
        const date = useDateInput.value.slice(0, 10);
        const key = `${facilityName}|${date}`;

        const input = label.querySelector("input[type=checkbox]");
        if (!input) return;
        const shouldBeChecked = keySet.has(key);
        if (input.checked !== shouldBeChecked) {
          input.click();
          changed++;
        }
      });
    });

    return changed;
  }, keys);
}

/**
 * 時間帯別空き状況画面（コート×時間帯の詳細グリッド）から
 * 「空きあり」のコマを読み取る。
 *
 * 画面構造:
 *   h3.facility-title           … 施設名見出し
 *   .schedule-plan              … その施設のスケジュール全体
 *     .events                   … 1日分のブロック
 *       .events-date            … 日付見出し（年・月日・曜日）
 *       .events-group           … 1コート分の行
 *         .room-name > span     … コート名（例: テニスコート（1番コート））
 *         li.selection-item     … 1時間帯分のセル
 *           .btn-group-toggle.vacant  … 空きありのマス
 *           input[name$=".TimeFrom"]  … 開始時刻（例: 600 = 6:00, 1730 = 17:30）
 *           input[name$=".TimeTo"]    … 終了時刻
 */
async function parseTimeDetailPage(page) {
  return page.evaluate(() => {
    const results = [];
    const facilityTitles = Array.from(document.querySelectorAll("h3.facility-title"));

    for (const titleEl of facilityTitles) {
      const facilityName = titleEl.textContent.trim();

      const headerBlock = titleEl.closest(".facility-padding");
      let schedulePlan = headerBlock ? headerBlock.nextElementSibling : null;
      while (schedulePlan && !schedulePlan.classList.contains("schedule-plan")) {
        schedulePlan = schedulePlan.nextElementSibling;
      }
      if (!schedulePlan) continue;

      const eventsBlocks = Array.from(schedulePlan.querySelectorAll(".events"));
      for (const eventsBlock of eventsBlocks) {
        const dateLi = eventsBlock.querySelector(".events-date");
        if (!dateLi) continue;
        const yearText = dateLi.querySelector(".year")
          ? dateLi.querySelector(".year").textContent.trim()
          : "";
        const weekText = dateLi.querySelector(".week")
          ? dateLi.querySelector(".week").textContent.trim()
          : "";
        const allSpanTexts = Array.from(dateLi.querySelectorAll("span")).map((s) =>
          s.textContent.trim()
        );
        // year, monthDay, week の順で並んでいる想定
        const monthDayText =
          allSpanTexts.find((t) => t !== yearText && t !== weekText) || "";

        const courtGroups = Array.from(eventsBlock.querySelectorAll(".events-group"));
        for (const group of courtGroups) {
          const roomNameEl = group.querySelector(".room-name > span");
          const courtName = roomNameEl ? roomNameEl.textContent.trim() : null;
          if (!courtName) continue;

          const cells = Array.from(group.querySelectorAll("li.selection-item"));
          for (const cell of cells) {
            const toggle = cell.querySelector(".btn-group-toggle");
            if (!toggle || !toggle.classList.contains("vacant")) continue;

            const timeFromInput = cell.querySelector('input[name$=".TimeFrom"]');
            const timeToInput = cell.querySelector('input[name$=".TimeTo"]');
            if (!timeFromInput || !timeToInput) continue;

            results.push({
              facilityName,
              yearText,
              monthDayText,
              weekText,
              courtName,
              timeFrom: Number(timeFromInput.value),
              timeTo: Number(timeToInput.value),
            });
          }
        }
      }
    }

    return results;
  });
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * 施設別空き状況グリッドから空きのある (施設, 日付) を全て集め、
 * batchSize 件ずつ時間帯別空き状況画面を巡回して詳細を読み取る。
 *
 * 「次へ進む」→「前に戻る」で施設別空き状況に戻ると、ブラウザ表示上は
 * チェックが外れて見えても、サーバー側では選択状態が残っており、次の
 * バッチと合算されて「最大10件まで」エラーになることが分かった。
 * そのため2バッチ目以降は `navigate`（表示条件の設定からやり直す関数）を
 * 呼び直し、常にまっさらな施設別空き状況ページから選び直す。
 *
 * @param {import('playwright').Page} page
 * @param {{ batchSize: number, navigate: () => Promise<void> }} options
 */
async function collectAllAvailability(page, { batchSize, navigate }) {
  const candidates = await listAvailableCandidates(page);
  if (candidates.length === 0) {
    return [];
  }

  const batches = chunk(candidates, batchSize);
  const allSlots = [];

  for (let i = 0; i < batches.length; i++) {
    if (i > 0) {
      await navigate();
    }

    const batch = batches[i];
    await selectCandidates(page, batch);
    await page.getByRole("button", { name: "次へ進む" }).click();
    await page.waitForURL(/AvailabilityCheckApplySelectTime/, { timeout: 20000 });
    await page.waitForSelector("h3.facility-title");
    await page.waitForTimeout(1000);

    const slots = await parseTimeDetailPage(page);
    allSlots.push(...slots);
  }

  return allSlots;
}

module.exports = {
  listAvailableCandidates,
  selectCandidates,
  parseTimeDetailPage,
  collectAllAvailability,
};
