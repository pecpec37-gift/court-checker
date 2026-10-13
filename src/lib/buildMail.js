const { escapeHtml, formatUpdatedAt, courtDisplayLabel, LONG_SLOT_HOURS } = require("./buildHtml");

// メールアプリは <style> やクラス指定を無視することがあるため、
// 公開ページ（buildHtml.js）と同じ見た目をインラインスタイルで組み立てる。
const FONT = `-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif`;

function groupByDate(slots) {
  const byDate = new Map();
  for (const slot of slots) {
    const key = `${slot.month}/${slot.day}(${slot.weekLabel})`;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(slot);
  }
  return byDate;
}

function slotText(facilityName, s) {
  return `${courtDisplayLabel(facilityName, s.courtName)} ${s.startLabel}〜${s.endLabel}（${s.durationHours}時間）`;
}

function buildSlotRow(facilityName, s, normalBackground) {
  const isLong = s.durationHours >= LONG_SLOT_HOURS;
  const boxStyle = isLong
    ? "background:#ffebee;border-left:6px solid #d32f2f;"
    : `background:${normalBackground};`;
  const courtColor = isLong ? "#c62828" : "#2e7d32";
  const timeStyle = isLong ? "color:#c62828;font-weight:bold;" : "color:#1a1a1a;";
  return `
        <div style="${boxStyle}border-radius:8px;padding:8px 10px;margin:0 0 6px;font-size:16px;">
          <span style="color:${courtColor};font-weight:bold;">${escapeHtml(
            courtDisplayLabel(facilityName, s.courtName)
          )}</span>
          <span style="${timeStyle}white-space:nowrap;">&nbsp;${s.startLabel}〜${s.endLabel}（${s.durationHours}時間）</span>
        </div>`;
}

function buildFacilityBlock(facilityName, slots, { headingColor, borderColor, normalBackground, emptyMessage }) {
  const heading = `<h3 style="font-size:19px;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid ${borderColor};color:${headingColor};">${escapeHtml(
    facilityName
  )}</h3>`;

  if (slots.length === 0) {
    return `
      <div style="margin:0 0 18px;">
        ${heading}
        <p style="color:#777;margin:0;">${escapeHtml(emptyMessage)}</p>
      </div>`;
  }

  const dateBlocks = [...groupByDate(slots).entries()]
    .map(([dateLabel, dateSlots]) => {
      const rows = dateSlots.map((s) => buildSlotRow(facilityName, s, normalBackground)).join("");
      const longCount = dateSlots.filter((s) => s.durationHours >= LONG_SLOT_HOURS).length;
      const longBadge =
        longCount > 0
          ? ` <span style="background:#d32f2f;color:#ffffff;border-radius:999px;padding:1px 8px;font-size:12px;font-weight:bold;white-space:nowrap;">${LONG_SLOT_HOURS}時間以上 ${longCount}件</span>`
          : "";
      return `
        <p style="font-size:16px;font-weight:bold;color:#333;margin:12px 0 6px;">${escapeHtml(
          dateLabel
        )}${longBadge}</p>${rows}`;
    })
    .join("");

  return `
      <div style="margin:0 0 18px;">
        ${heading}${dateBlocks}
      </div>`;
}

function increaseHeading(comparisonInfo) {
  if (!comparisonInfo.hasPrevious) return "なし（初回のため比較データがありません）";
  return `前回のメール ${formatUpdatedAt(new Date(comparisonInfo.previousGeneratedAt))} との比較`;
}

function buildIncreaseBlock(increaseSlots, facilityNames, comparisonInfo) {
  const title = `<h2 style="font-size:20px;margin:0 0 4px;color:#e65100;">🆕 前回のメールから増えた空き</h2>`;
  const note = `<p style="color:#8a6d00;font-size:14px;margin:0 0 12px;">${escapeHtml(
    increaseHeading(comparisonInfo)
  )}</p>`;

  let body;
  if (!comparisonInfo.hasPrevious) {
    body = "";
  } else if (increaseSlots.length === 0) {
    body = `<p style="color:#777;margin:0;">なし</p>`;
  } else {
    body = facilityNames
      .map((facilityName) => {
        const slots = increaseSlots.filter((s) => s.facilityName === facilityName);
        if (slots.length === 0) return "";
        return buildFacilityBlock(facilityName, slots, {
          headingColor: "#e65100",
          borderColor: "#f9a825",
          normalBackground: "#fff3cd",
          emptyMessage: "なし",
        });
      })
      .join("");
  }

  return `
    <div style="background:#fff8e1;border:2px solid #f9a825;border-radius:12px;padding:14px;margin:0 0 20px;">
      ${title}
      ${note}
      ${body}
    </div>`;
}

function buildSubject(checkedAt, comparisonInfo) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(checkedAt);
  const get = (type) => parts.find((p) => p.type === type).value;
  const when = `${get("month")}/${get("day")} ${get("hour").padStart(2, "0")}:${get("minute").padStart(2, "0")}`;
  const increase = comparisonInfo.hasPrevious
    ? `増えた空き${comparisonInfo.increaseSlots.length}件`
    : "初回";
  return `【テニスコート空き】${when}時点（${increase}）`;
}

/**
 * @param {Array} mergedSlots formatSlots.mergeNormalizedSlots() 済みの空きコマ
 * @param {string[]} facilityNames 表示順に並べる施設名一覧
 * @param {Date} checkedAt 空き状況を照会した日時
 * @param {{ hasPrevious: boolean, previousGeneratedAt: string|null, increaseSlots: Array }} comparisonInfo
 *   前回メール送信時点との比較結果（increaseSlots は mergeNormalizedSlots() 済み）
 * @param {string} pageUrl 公開ページのURL
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildMail(mergedSlots, facilityNames, checkedAt, comparisonInfo, pageUrl) {
  const sections = facilityNames
    .map((facilityName) =>
      buildFacilityBlock(
        facilityName,
        mergedSlots.filter((s) => s.facilityName === facilityName),
        {
          headingColor: "#1b5e20",
          borderColor: "#2e7d32",
          normalBackground: "#e8f5e9",
          emptyMessage: "空いているコマは見つかりませんでした。",
        }
      )
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:12px;background:#ffffff;color:#1a1a1a;font-family:${FONT};font-size:16px;line-height:1.6;">
  <div style="max-width:600px;margin:0 auto;">
    <h1 style="font-size:22px;margin:0 0 4px;">福岡市テニスコート 空き状況</h1>
    <p style="color:#555;font-size:14px;margin:0 0 6px;">照会日時: ${formatUpdatedAt(checkedAt)}</p>
    <p style="color:#555;font-size:14px;margin:0 0 16px;"><span style="background:#ffebee;border-left:6px solid #d32f2f;border-radius:6px;padding:0 8px;color:#c62828;font-weight:bold;">赤色</span> は${LONG_SLOT_HOURS}時間以上まとまって空いているコマです。</p>
    ${buildIncreaseBlock(comparisonInfo.increaseSlots, facilityNames, comparisonInfo)}
    <h2 style="font-size:20px;margin:0 0 12px;">現在の空き（土日祝）</h2>
    ${sections}
    <p style="font-size:15px;margin:20px 0 0;"><a href="${escapeHtml(pageUrl)}" style="color:#2e7d32;font-weight:bold;">最新の空き状況をページで見る</a></p>
    <p style="color:#888;font-size:12px;margin:12px 0 0;">${facilityNames
      .map(escapeHtml)
      .join("・")}（翌日から45日間／土日祝のみ）を自動照会し、1日1回お送りしています。</p>
  </div>
</body>
</html>
`;

  const textFacility = (facilityName, slots, emptyMessage) => {
    const lines = [`■ ${facilityName}`];
    if (slots.length === 0) {
      lines.push(`  ${emptyMessage}`);
    } else {
      for (const [dateLabel, dateSlots] of groupByDate(slots)) {
        lines.push(`  ${dateLabel}`);
        for (const s of dateSlots) lines.push(`    ${slotText(facilityName, s)}`);
      }
    }
    return lines.join("\n");
  };

  const textParts = [
    "福岡市テニスコート 空き状況",
    `照会日時: ${formatUpdatedAt(checkedAt)}`,
    "",
    "【前回のメールから増えた空き】",
    increaseHeading(comparisonInfo),
  ];
  if (comparisonInfo.hasPrevious) {
    if (comparisonInfo.increaseSlots.length === 0) {
      textParts.push("なし");
    } else {
      for (const facilityName of facilityNames) {
        const slots = comparisonInfo.increaseSlots.filter((s) => s.facilityName === facilityName);
        if (slots.length > 0) textParts.push(textFacility(facilityName, slots, "なし"));
      }
    }
  }
  textParts.push("", "【現在の空き（土日祝）】");
  for (const facilityName of facilityNames) {
    textParts.push(
      textFacility(
        facilityName,
        mergedSlots.filter((s) => s.facilityName === facilityName),
        "空いているコマは見つかりませんでした。"
      )
    );
  }
  textParts.push("", `最新の空き状況: ${pageUrl}`);

  return {
    subject: buildSubject(checkedAt, comparisonInfo),
    html,
    text: textParts.join("\n") + "\n",
  };
}

module.exports = { buildMail };
