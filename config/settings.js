// 照会条件の設定ファイル
// ここを編集するだけで対象施設・曜日を変更できるようにする。

module.exports = {
  site: {
    topUrl: "https://www3.11489.jp/fukuoka/user/Home",
  },

  // 対象施設（両方まとめて照会する）
  facilityNames: ["舞鶴公園", "汐井公園"],

  // 表示曜日（土曜日・日曜日・祝日のみ）
  targetDaysOfWeek: ["土曜日", "日曜日", "祝日"],

  // 施設別空き状況画面から時間帯別空き状況画面へ進む際、
  // 1回の「次へ進む」で選択できる日程は最大10件までという
  // サイト側の制約があるため、その件数ごとに分割して照会する。
  batchSize: 10,

  // 出力するHTMLファイルの出力先
  outputPath: "docs/index.html",
};
