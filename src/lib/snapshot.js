const fs = require("fs");
const path = require("path");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDateStr(slot) {
  return `${slot.year}-${pad2(slot.month)}-${pad2(slot.day)}`;
}

function dateKey(facilityName, dateStr) {
  return `${facilityName}|${dateStr}`;
}

function slotKey(slot) {
  return [
    slot.facilityName,
    toDateStr(slot),
    slot.courtName,
    slot.timeFrom,
    slot.timeTo,
  ].join("|");
}

/**
 * 前回のスナップショット（data/previous.json）を読み込む。
 * ファイルが無い・壊れている場合は null を返し、「前回データ無し」として扱う。
 */
function loadPreviousSnapshot(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.slots) || !Array.isArray(data.coveredDates)) {
      return null;
    }
    return data;
  } catch (err) {
    return null;
  }
}

/**
 * 今回のスナップショットを保存する。
 *
 * @param {string} filePath
 * @param {{ generatedAt: string, coveredDates: Array<{facilityName:string, date:string}>, slots: Array }} snapshot
 */
function saveSnapshot(filePath, snapshot) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
}

/**
 * 前回スナップショットと今回の正規化済みコマ一覧を比較し、
 * 「前回もあった日付で、前回は空きでなかったのに今回空いたコマ」だけを返す。
 *
 * @param {object|null} previousSnapshot loadPreviousSnapshot() の結果
 * @param {Array} currentNormalizedSlots formatSlots.normalizeSlot() 済みのコマ一覧
 * @returns {{ hasPrevious: boolean, previousGeneratedAt: string|null, newSlots: Array }}
 */
function computeNewlyVacantSlots(previousSnapshot, currentNormalizedSlots) {
  if (!previousSnapshot) {
    return { hasPrevious: false, previousGeneratedAt: null, newSlots: [] };
  }

  const previousCoveredDates = new Set(
    previousSnapshot.coveredDates.map((d) => dateKey(d.facilityName, d.date))
  );
  const previousSlots = new Set(previousSnapshot.slots.map(slotKey));

  const newSlots = currentNormalizedSlots.filter((slot) => {
    const dk = dateKey(slot.facilityName, toDateStr(slot));
    if (!previousCoveredDates.has(dk)) return false;
    return !previousSlots.has(slotKey(slot));
  });

  return {
    hasPrevious: true,
    previousGeneratedAt: previousSnapshot.generatedAt,
    newSlots,
  };
}

module.exports = {
  loadPreviousSnapshot,
  saveSnapshot,
  computeNewlyVacantSlots,
};
