function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatUpdatedAt(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = get("hour").padStart(2, "0");
  const mm = get("minute").padStart(2, "0");
  return `${y}年${m}月${d}日 ${hh}:${mm} JST`;
}

// courtName は「テニスコート（1番コート）」「テニスコート(テニスコート１)」の
// ように「テニスコート」＋カッコ書きのコート番号という形式なので、カッコの
// 中身だけを取り出して施設名と組み合わせる（例: 舞鶴公園（1番コート））。
function courtDisplayLabel(facilityName, courtName) {
  const match = String(courtName).match(/[（(]([^）)]*)[）)]/);
  const courtLabel = match ? match[1] : courtName;
  return `${facilityName}（${courtLabel}）`;
}

function buildFacilitySection(facilityName, slots, emptyMessage) {
  if (slots.length === 0) {
    return `
    <section class="facility">
      <h2>${escapeHtml(facilityName)}</h2>
      <p class="empty">${escapeHtml(emptyMessage)}</p>
    </section>`;
  }

  const byDate = new Map();
  for (const slot of slots) {
    const key = `${slot.month}/${slot.day}(${slot.weekLabel})`;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(slot);
  }

  const dateBlocks = [...byDate.entries()]
    .map(([dateLabel, dateSlots]) => {
      const items = dateSlots
        .map(
          (s) => `
        <li class="slot">
          <span class="court">${escapeHtml(courtDisplayLabel(facilityName, s.courtName))}</span>
          <span class="time">${s.startLabel}〜${s.endLabel}（${s.durationHours}時間）</span>
        </li>`
        )
        .join("");
      return `
      <div class="date-block">
        <h3>${escapeHtml(dateLabel)}</h3>
        <ul class="slot-list">${items}
        </ul>
      </div>`;
    })
    .join("");

  return `
    <section class="facility">
      <h2>${escapeHtml(facilityName)}</h2>
      ${dateBlocks}
    </section>`;
}

function buildIncreaseSection(increaseSlots, facilityNames, comparisonInfo) {
  const { hasPrevious, previousGeneratedAt } = comparisonInfo;

  if (!hasPrevious) {
    return `
  <section class="increase">
    <h2>🆕 前回から増えた空き</h2>
    <p class="empty">なし（初回のため比較データがありません）</p>
  </section>`;
  }

  const compareNote = `<p class="compare-note">前回 ${formatUpdatedAt(
    new Date(previousGeneratedAt)
  )} との比較</p>`;

  if (increaseSlots.length === 0) {
    return `
  <section class="increase">
    <h2>🆕 前回から増えた空き</h2>
    ${compareNote}
    <p class="empty">なし</p>
  </section>`;
  }

  const sections = facilityNames
    .map((facilityName) => {
      const slots = increaseSlots.filter((s) => s.facilityName === facilityName);
      if (slots.length === 0) return "";
      return buildFacilitySection(facilityName, slots, "なし");
    })
    .join("\n");

  return `
  <section class="increase">
    <h2>🆕 前回から増えた空き</h2>
    ${compareNote}
    ${sections}
  </section>`;
}

/**
 * @param {Array} mergedSlots formatSlots.mergeConsecutiveSlots() の結果
 * @param {string[]} facilityNames 表示順に並べる施設名一覧
 * @param {Date} generatedAt 生成日時
 * @param {{ hasPrevious: boolean, previousGeneratedAt: string|null, increaseSlots: Array }} comparisonInfo
 *   前回スナップショットとの比較結果。increaseSlots は前回から増えたコマ
 *   （formatSlots.mergeNormalizedSlots() 済み）。
 */
function buildHtml(mergedSlots, facilityNames, generatedAt, comparisonInfo) {
  const sections = facilityNames
    .map((facilityName) => {
      const slots = mergedSlots.filter((s) => s.facilityName === facilityName);
      return buildFacilitySection(facilityName, slots, "空いているコマは見つかりませんでした。");
    })
    .join("\n");

  const increaseSection = buildIncreaseSection(
    comparisonInfo.increaseSlots,
    facilityNames,
    comparisonInfo
  );

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>テニスコート空き状況</title>
<style>
  :root {
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    background: #f5f7f5;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
    font-size: 18px;
    line-height: 1.6;
  }
  h1 {
    font-size: 24px;
    margin: 0 0 4px;
  }
  .updated {
    color: #555;
    font-size: 15px;
    margin: 0 0 20px;
  }
  .facility {
    background: #ffffff;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  .facility h2 {
    font-size: 21px;
    margin: 0 0 12px;
    padding-bottom: 8px;
    border-bottom: 2px solid #2e7d32;
    color: #1b5e20;
  }
  .empty {
    color: #777;
    margin: 0;
  }
  .date-block {
    margin-bottom: 14px;
  }
  .date-block:last-child {
    margin-bottom: 0;
  }
  .date-block h3 {
    font-size: 17px;
    margin: 0 0 6px;
    color: #333;
  }
  .slot-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .slot {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: #e8f5e9;
    margin-bottom: 6px;
    font-size: 17px;
  }
  .slot:last-child {
    margin-bottom: 0;
  }
  .court {
    color: #2e7d32;
    font-weight: bold;
    white-space: nowrap;
  }
  .time {
    white-space: nowrap;
  }
  footer {
    text-align: center;
    color: #888;
    font-size: 13px;
    margin-top: 24px;
  }
  .increase {
    background: #fff8e1;
    border: 2px solid #f9a825;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 24px;
  }
  .increase h2 {
    font-size: 21px;
    margin: 0 0 4px;
    color: #e65100;
    border-bottom: none;
    padding-bottom: 0;
  }
  .increase .compare-note {
    color: #8a6d00;
    font-size: 14px;
    margin: 0 0 12px;
  }
  .increase .facility {
    box-shadow: none;
    padding: 0;
    margin-bottom: 12px;
  }
  .increase .facility:last-child {
    margin-bottom: 0;
  }
  .increase .facility h2 {
    font-size: 17px;
    color: #e65100;
    border-bottom: 1px solid #f9a825;
  }
  .increase .slot {
    background: #fff3cd;
  }
</style>
</head>
<body>
  <h1>福岡市テニスコート 空き状況</h1>
  <p class="updated">最終更新: ${formatUpdatedAt(generatedAt)}</p>
  ${increaseSection}
  ${sections}
  <footer>舞鶴公園・汐井公園（翌日から45日間／土日祝のみ）を自動照会しています。</footer>
</body>
</html>
`;
}

module.exports = { buildHtml };
