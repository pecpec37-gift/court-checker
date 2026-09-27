// 「今すぐチェック」の受け口（Cloudflare Worker）
//
// docs/trigger.html から合言葉つきで POST され、合言葉が正しいときだけ
// GitHub Actions の check.yml を workflow_dispatch で起動する。
// GitHub のトークン（GITHUB_TOKEN）と合言葉（TRIGGER_PASSPHRASE）は
// Worker の Secrets にだけ置き、ページ側には一切出さない。
// 合言葉が漏れても、できるのは「照会の起動」だけ（しかも連打防止つき）。

const MAX_PASSPHRASE_LENGTH = 200;
// 合言葉違いのときは少し待たせて、総当たりを遅くする
const WRONG_PASSPHRASE_DELAY_MS = 1500;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    if (origin && !cors) {
      return reply(403, { ok: false, code: "origin", message: "このページからは起動できません" });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors || {} });
    }
    if (request.method !== "POST") {
      return reply(405, { ok: false, code: "method", message: "POST のみ受け付けます" }, cors);
    }
    if (!env.GITHUB_TOKEN || !env.TRIGGER_PASSPHRASE) {
      console.error("GITHUB_TOKEN または TRIGGER_PASSPHRASE が未設定です");
      return reply(500, { ok: false, code: "config", message: "受け口の設定が未完了です" }, cors);
    }

    let passphrase = "";
    try {
      const body = await request.json();
      passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
    } catch {
      return reply(400, { ok: false, code: "bad_request", message: "リクエストの形式が不正です" }, cors);
    }

    if (
      !passphrase ||
      passphrase.length > MAX_PASSPHRASE_LENGTH ||
      !(await safeEqual(passphrase, env.TRIGGER_PASSPHRASE))
    ) {
      await sleep(WRONG_PASSPHRASE_DELAY_MS);
      return reply(401, { ok: false, code: "bad_passphrase", message: "合言葉が違います" }, cors);
    }

    const gh = githubClient(env);

    // 連打防止：実行中、または直近に実行済みなら起動しない（定刻実行も含めて判定）
    const cooldownMinutes = Number(env.COOLDOWN_MINUTES || 10);
    const latestRes = await gh(`/runs?per_page=1`);
    if (!latestRes.ok) {
      console.error("直近の実行の取得に失敗", latestRes.status, await latestRes.text());
      return reply(502, { ok: false, code: "github", message: "GitHub への問い合わせに失敗しました" }, cors);
    }
    const latest = (await latestRes.json()).workflow_runs?.[0];
    if (latest) {
      if (latest.status !== "completed") {
        return reply(409, {
          ok: false,
          code: "running",
          message: "いま照会を実行中です。少し待ってから空き状況ページを更新してください",
        }, cors);
      }
      const elapsedMinutes = (Date.now() - Date.parse(latest.created_at)) / 60000;
      if (elapsedMinutes < cooldownMinutes) {
        const waitMinutes = Math.ceil(cooldownMinutes - elapsedMinutes);
        return reply(429, {
          ok: false,
          code: "cooldown",
          waitMinutes,
          message: `前回の照会から${cooldownMinutes}分経っていません（あと約${waitMinutes}分）`,
        }, cors);
      }
    }

    const dispatchRes = await gh(`/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: env.GITHUB_REF || "main" }),
    });
    if (!dispatchRes.ok) {
      console.error("workflow_dispatch に失敗", dispatchRes.status, await dispatchRes.text());
      return reply(502, { ok: false, code: "github", message: "照会の起動に失敗しました" }, cors);
    }

    return reply(200, {
      ok: true,
      code: "started",
      startedAt: new Date().toISOString(),
      message: "起動しました",
    }, cors);
  },
};

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function githubClient(env) {
  const base = `${env.GITHUB_API || "https://api.github.com"}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}`;
  return (path, init = {}) =>
    fetch(base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "court-checker-trigger",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
}

// 長さや一致位置で所要時間が変わらないよう、ハッシュ同士を全バイト比較する
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function reply(status, body, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(cors || {}) },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
