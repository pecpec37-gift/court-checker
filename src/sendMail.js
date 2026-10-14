const fs = require("fs");
const path = require("path");
const settings = require("../config/settings");
const { mergeNormalizedSlots } = require("./lib/formatSlots");
const { loadPreviousSnapshot, saveSnapshot, computeNewlyVacantSlots } = require("./lib/snapshot");
const { buildMail } = require("./lib/buildMail");

/**
 * 1日1回だけ、直前に src/index.js が照会した空き状況をメールで送る。
 *
 * 送る条件: 日本時間で settings.mail.sendAfterJst 以降、かつその日まだ送っていない。
 * 定期実行のうち最初に条件を満たした回が送るので、その回が失敗・遅延しても
 * 次の回が代わりに送る。送信済みの日付と送信時点のスナップショットは
 * settings.mail.statePath に記録し、次回メールの「増えた空き」の比較基準にする。
 *
 * 環境変数:
 *   GMAIL_USER / GMAIL_APP_PASSWORD / MAIL_TO  送信元・アプリパスワード・宛先（Secrets）
 *   FORCE_MAIL=true    テスト送信。時刻・送信済みに関係なく送り、記録は更新しない
 *   MAIL_DRY_RUN=<パス> 送信せず、メール本文のHTMLをそのパスに書き出す（見た目確認用）
 */

function jstNow(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function hhmmToMinutes(hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm;
}

function loadSentDate(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8")).sentDate || null;
  } catch (err) {
    return null;
  }
}

async function main() {
  const force = process.env.FORCE_MAIL === "true";
  const dryRunPath = process.env.MAIL_DRY_RUN;
  const statePath = path.resolve(__dirname, "..", settings.mail.statePath);
  const now = jstNow(new Date());

  if (!force && !dryRunPath) {
    if (now.minutes < hhmmToMinutes(settings.mail.sendAfterJst)) {
      console.log(`[メール] ${settings.mail.sendAfterJst} より前のため送信しません。`);
      return;
    }
    if (loadSentDate(statePath) === now.dateStr) {
      console.log("[メール] 本日は送信済みのため送信しません。");
      return;
    }
  }

  const snapshotPath = path.resolve(__dirname, "..", settings.previousSnapshotPath);
  const current = loadPreviousSnapshot(snapshotPath);
  if (!current) {
    throw new Error(`空き状況のスナップショットを読めませんでした: ${snapshotPath}`);
  }

  // 前回メール送信時点のスナップショットと比較する（直前の回との比較ではない）。
  const { hasPrevious, previousGeneratedAt, newSlots } = computeNewlyVacantSlots(
    loadPreviousSnapshot(statePath),
    current.slots
  );
  const mail = buildMail(
    mergeNormalizedSlots(current.slots),
    settings.facilityNames,
    new Date(current.generatedAt),
    { hasPrevious, previousGeneratedAt, increaseSlots: mergeNormalizedSlots(newSlots) },
    settings.mail.pageUrl
  );

  if (dryRunPath) {
    fs.writeFileSync(dryRunPath, mail.html, "utf-8");
    console.log(`[メール] 送信せず本文を書き出しました: ${dryRunPath}\n件名: ${mail.subject}\n\n${mail.text}`);
    return;
  }

  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
  const to = process.env.MAIL_TO;
  if (!user || !pass || !to) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD / MAIL_TO が設定されていません（GitHub の Secrets を確認してください）。"
    );
  }

  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: `"テニスコート空き照会" <${user}>`,
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  console.log(`[メール] 送信しました: ${mail.subject}`);

  if (force) {
    console.log("[メール] テスト送信のため、送信済みの記録は更新しません。");
    return;
  }
  saveSnapshot(statePath, {
    sentDate: now.dateStr,
    generatedAt: current.generatedAt,
    coveredDates: current.coveredDates,
    slots: current.slots,
  });
}

main().catch((err) => {
  // 宛先やアカウント名がログに残らないよう、メッセージだけを出す。
  console.error(`[メール] 送信に失敗しました: ${err.message}`);
  process.exitCode = 1;
});
