const fs = require("fs");
const path = require("path");
const settings = require("../config/settings");
const { mergeNormalizedSlots } = require("./lib/formatSlots");
const { loadPreviousSnapshot, saveSnapshot, computeNewlyVacantSlots } = require("./lib/snapshot");
const { buildMail } = require("./lib/buildMail");

/**
 * 1日1回だけ、直前に src/index.js が照会した空き状況をメールで送る。
 *
 * 送る条件（decideMail）: ジョブの開始時刻（日本時間）が settings.mail.sendWindows の
 *   main（14:30の回）か fallback（15:00の回）の時間帯に入っていて、かつその日まだ送っていない。
 *   つまり通常は14:30の回だけが送り、15:00の回は14:30の回が送れなかった日だけ代わりに送る。
 *   それ以外の回は送らない。送信済みの日付と送信時点のスナップショットは
 * settings.mail.statePath に記録し、次回メールの「増えた空き」の比較基準にする。
 *
 * 環境変数:
 *   GMAIL_USER / GMAIL_APP_PASSWORD / MAIL_TO  送信元・アプリパスワード・宛先（Secrets）
 *                      MAIL_TO はカンマ区切りで複数アドレスを指定できる。
 *                      宛先同士にアドレスが見えないよう全員 BCC で送る（To は送信元自身）
 *   RUN_STARTED_AT     ジョブの開始時刻（ISO形式。check.yml の最初のステップで記録）。
 *                      無ければ現在時刻で判定する
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

/**
 * この回でメールを送るかを決める（副作用なし）。
 * @param {Date} startedAt ジョブの開始時刻
 * @param {string|null} sentDate 最後に送った日（YYYY-MM-DD、日本時間）
 * @param {{main:{from,until}, fallback:{from,until}}} windows
 * @returns {{send: boolean, reason: string}}
 */
function decideMail(startedAt, sentDate, windows) {
  const now = jstNow(startedAt);
  const inWindow = (w) =>
    now.minutes >= hhmmToMinutes(w.from) && now.minutes < hhmmToMinutes(w.until);
  const label = `開始 ${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(now.minutes % 60).padStart(2, "0")}`;

  let slot = null;
  if (inWindow(windows.main)) slot = "main";
  else if (inWindow(windows.fallback)) slot = "fallback";

  if (!slot) {
    return { send: false, reason: `${label}：メールを送る回（${windows.main.from}・${windows.fallback.from}）ではないため送信しません。` };
  }
  if (sentDate === now.dateStr) {
    return { send: false, reason: `${label}：本日は送信済みのため送信しません。` };
  }
  return {
    send: true,
    reason:
      slot === "main"
        ? `${label}：${windows.main.from}の回として送信します。`
        : `${label}：${windows.main.from}の回が送れていないため、${windows.fallback.from}の回が代わりに送信します。`,
  };
}

function jobStartedAt() {
  const t = new Date(process.env.RUN_STARTED_AT || "");
  return Number.isNaN(t.getTime()) ? new Date() : t;
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
  const startedAt = jobStartedAt();
  // 送信済みの日付は判定に使ったのと同じ「開始時刻の日付」で記録する。
  const now = jstNow(startedAt);

  if (!force && !dryRunPath) {
    const decision = decideMail(startedAt, loadSentDate(statePath), settings.mail.sendWindows);
    console.log(`[メール] ${decision.reason}`);
    if (!decision.send) return;
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
  // MAIL_TO はカンマ区切りで複数指定できる。前後の空白・改行・全角カンマ・空要素・重複は取り除く。
  const recipients = [
    ...new Set((process.env.MAIL_TO || "").split(/[,，、;；\s]+/).filter(Boolean)),
  ];
  if (!user || !pass || recipients.length === 0) {
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
    // 受信者同士にアドレスが見えないよう、宛先は全員 BCC にして To は送信元自身にする。
    to: user,
    bcc: recipients,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  console.log(`[メール] 送信しました（BCC ${recipients.length} 件）: ${mail.subject}`);

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

if (require.main === module) {
  main().catch((err) => {
    // 宛先やアカウント名がログに残らないよう、メッセージだけを出す。
    console.error(`[メール] 送信に失敗しました: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { decideMail };
