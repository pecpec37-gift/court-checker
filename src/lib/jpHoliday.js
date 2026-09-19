/**
 * 日本の祝日判定（外部ライブラリなし）。対象は 2000〜2099 年。
 * 国民の祝日に関する法律に基づき、ハッピーマンデー・春分/秋分・
 * 振替休日・国民の休日（祝日に挟まれた平日）を含む。
 * 日付は暦日（年・月・日）だけで扱い、タイムゾーンの影響を受けない。
 */

// 春分・秋分の日（1980〜2099 の近似式）
function vernalEquinoxDay(y) {
  return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}
function autumnalEquinoxDay(y) {
  return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

// 第 n 月曜日の日にち
function nthMonday(y, m, n) {
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((8 - firstDow) % 7) + (n - 1) * 7;
}

function dow(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function key(y, m, d) {
  return y * 10000 + m * 100 + d;
}

// 振替・国民の休日を含めない「本来の祝日」の一覧を返す
function baseHolidays(y) {
  const h = new Set();
  const add = (m, d) => h.add(key(y, m, d));

  add(1, 1); // 元日
  add(1, nthMonday(y, 1, 2)); // 成人の日
  add(2, 11); // 建国記念の日
  if (y >= 2020) add(2, 23); // 天皇誕生日
  add(3, vernalEquinoxDay(y)); // 春分の日
  add(4, 29); // 昭和の日
  add(5, 3); // 憲法記念日
  add(5, 4); // みどりの日
  add(5, 5); // こどもの日
  if (y === 2020) {
    add(7, 23); // 海の日（東京五輪特例）
    add(7, 24); // スポーツの日（同）
    add(8, 10); // 山の日（同）
  } else if (y === 2021) {
    add(7, 22);
    add(7, 23);
    add(8, 8);
  } else {
    add(7, nthMonday(y, 7, 3)); // 海の日
    add(8, 11); // 山の日
    add(10, nthMonday(y, 10, 2)); // スポーツの日
  }
  add(9, nthMonday(y, 9, 3)); // 敬老の日
  add(9, autumnalEquinoxDay(y)); // 秋分の日
  add(11, 3); // 文化の日
  add(11, 23); // 勤労感謝の日
  if (y === 2019) {
    add(5, 1); // 即位の日（4/30・5/2 は国民の休日として自動判定）
    add(10, 22); // 即位礼正殿の儀
  }
  return h;
}

const cache = new Map();

function holidaysOfYear(y) {
  if (cache.has(y)) return cache.get(y);
  const all = baseHolidays(y);

  // 国民の休日: 前日と翌日がともに祝日の平日（日曜・祝日以外）
  for (let m = 1; m <= 12; m++) {
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      if (all.has(key(y, m, d)) || dow(y, m, d) === 0) continue;
      const prev = new Date(Date.UTC(y, m - 1, d - 1));
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      const k = (t) => key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
      if (baseHolidays(prev.getUTCFullYear()).has(k(prev)) &&
          baseHolidays(next.getUTCFullYear()).has(k(next))) {
        all.add(key(y, m, d));
      }
    }
  }

  // 振替休日: 日曜の祝日の次の「祝日でない日」（連続する祝日はその後ろへ）
  const base = [...all].sort((a, b) => a - b);
  for (const k of base) {
    const m = Math.floor(k / 100) % 100;
    const d = k % 100;
    if (dow(y, m, d) !== 0) continue;
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    while (all.has(key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()))) {
      t.setUTCDate(t.getUTCDate() + 1);
    }
    all.add(key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()));
  }

  cache.set(y, all);
  return all;
}

function isJapaneseHoliday(y, m, d) {
  return holidaysOfYear(y).has(key(y, m, d));
}

/** 土曜・日曜・祝日のいずれかなら true */
function isSatSunHoliday(y, m, d) {
  const w = dow(y, m, d);
  return w === 0 || w === 6 || isJapaneseHoliday(y, m, d);
}

module.exports = { isJapaneseHoliday, isSatSunHoliday };
