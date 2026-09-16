/**
 * collectAvailability が返す生データ（施設名, 年月日テキスト, コート名,
 * 開始/終了時刻）を、日付・時刻の扱いやすい形に正規化する。
 */
function normalizeSlot(rawSlot) {
  const yearMatch = rawSlot.yearText.match(/(\d+)/);
  const dateMatch = rawSlot.monthDayText.match(/(\d+)月(\d+)日/);
  if (!yearMatch || !dateMatch) {
    throw new Error(
      `日付のテキストを解析できませんでした: year="${rawSlot.yearText}" monthDay="${rawSlot.monthDayText}"`
    );
  }
  const year = Number(yearMatch[1]);
  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const weekLabel = rawSlot.weekText.replace(/[()（）]/g, "");

  return {
    facilityName: rawSlot.facilityName,
    year,
    month,
    day,
    weekLabel,
    courtName: rawSlot.courtName,
    timeFrom: timeCodeToMinutes(rawSlot.timeFrom),
    timeTo: timeCodeToMinutes(rawSlot.timeTo),
  };
}

// サイト側の時刻表現（例: 600 = 6:00, 1730 = 17:30）を分単位に変換する。
function timeCodeToMinutes(code) {
  const s = String(code).padStart(4, "0");
  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  return hh * 60 + mm;
}

function minutesToHms(minutes) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${hh}:${String(mm).padStart(2, "0")}`;
}

/**
 * 施設・日付・コートごとにグルーピングし、隣り合う空き時間帯を
 * 一つの範囲にまとめる。
 *
 * @param {Array} normalized normalizeSlot() 済みのコマ一覧
 */
function mergeNormalizedSlots(normalized) {
  const groups = new Map();
  for (const slot of normalized) {
    const key = [
      slot.facilityName,
      slot.year,
      slot.month,
      slot.day,
      slot.courtName,
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slot);
  }

  const merged = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.timeFrom - b.timeFrom);
    let current = null;
    for (const slot of group) {
      if (current && current.timeTo === slot.timeFrom) {
        current.timeTo = slot.timeTo;
      } else {
        if (current) merged.push(current);
        current = { ...slot };
      }
    }
    if (current) merged.push(current);
  }

  merged.sort((a, b) => {
    if (a.facilityName !== b.facilityName) return a.facilityName < b.facilityName ? -1 : 1;
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    if (a.day !== b.day) return a.day - b.day;
    if (a.timeFrom !== b.timeFrom) return a.timeFrom - b.timeFrom;
    return a.courtName < b.courtName ? -1 : 1;
  });

  return merged.map((slot) => ({
    facilityName: slot.facilityName,
    year: slot.year,
    month: slot.month,
    day: slot.day,
    weekLabel: slot.weekLabel,
    courtName: slot.courtName,
    startLabel: minutesToHms(slot.timeFrom),
    endLabel: minutesToHms(slot.timeTo),
    durationHours: (slot.timeTo - slot.timeFrom) / 60,
  }));
}

/**
 * 従来どおり、生データ（コマ単位）からまとめ済みの範囲一覧を作る。
 */
function mergeConsecutiveSlots(rawSlots) {
  return mergeNormalizedSlots(rawSlots.map(normalizeSlot));
}

module.exports = { normalizeSlot, mergeNormalizedSlots, mergeConsecutiveSlots };
