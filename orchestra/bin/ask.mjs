#!/usr/bin/env node
// ask — unified router so Claude Code (orchestrator) can delegate to other models.
// Zero dependencies, Node >= 18. Usage:
//   ask <provider|tier> "prompt"            (stdin is appended as context)
//   cat big.log | ask gemini "Summarise the errors"
//   ask cheap "Extract all emails as JSON"  (tries free -> cheap chain)
//   ask list-free                           (live list of $0 OpenRouter models)
//   ask usage                               (today's call count per provider)
// Providers: gemini, agy, openrouter, deepseek, xai, qwen
// Tiers:     cheap  = openrouter(free) -> deepseek -> gemini
//            review = deepseek -> xai -> openrouter(free)
//            big    = gemini -> openrouter(free)       (long context)
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const env = process.env;
const LOG_DIR = join(homedir(), ".orchestra");
const LOG = join(LOG_DIR, "usage.jsonl");
const TIMEOUT = Number(env.ASK_TIMEOUT_MS || 300000);

// Load ~/.orchestra/.env if present (KEY=VALUE lines) without overriding real env.
const envFile = join(LOG_DIR, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function log(entry) {
  try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n"); } catch {}
}

function readStdin() {
  if (process.stdin.isTTY) return "";
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

class Skip extends Error {} // provider not configured -> try next in chain

// ---------- CLI-backed providers (use your subscriptions) ----------
function runCli(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", timeout: TIMEOUT, maxBuffer: 64 << 20 });
  if (r.error?.code === "ENOENT") throw new Skip(`${cmd} not installed`);
  if (r.error) throw r.error;
  const out = (r.stdout || "").trim();
  if (r.status !== 0) throw new Error(`${cmd} exit ${r.status}: ${(r.stderr || out).slice(0, 500)}`);
  if (!out) throw new Error(`${cmd} returned empty output: ${(r.stderr || "").slice(0, 300)}`);
  return out;
}

const providers = {
  // Gemini CLI: logs in with your Google account (AI Pro quota) or GEMINI_API_KEY.
  gemini: (prompt, ctx) => {
    const args = ["-p", prompt];
    if (env.GEMINI_MODEL) args.push("-m", env.GEMINI_MODEL);
    return runCli(env.GEMINI_BIN || "gemini", args, ctx);
  },

  // Antigravity CLI (agy). Headless mode prints nothing without a TTY, so we
  // wrap it in `script` to fake one. Flags are configurable because they are
  // not stably documented: AGY_ARGS is a JSON array inserted before the prompt.
  agy: (prompt, ctx) => {
    const bin = env.AGY_BIN || "agy";
    const extra = env.AGY_ARGS ? JSON.parse(env.AGY_ARGS) : [];
    const full = ctx ? `${prompt}\n\n---\n${ctx}` : prompt;
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const line = [bin, ...extra, "-p", full].map(q).join(" ");
    const out = platform() === "darwin"
      ? runCli("script", ["-q", "/dev/null", "sh", "-c", line])
      : runCli("script", ["-qec", line, "/dev/null"]);
    // strip ANSI escape codes + carriage returns produced by the pty
    return out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").trim();
  },

  // ---------- HTTP providers (OpenAI-compatible) ----------
  openrouter: (prompt, ctx) => {
    if (!env.OPENROUTER_API_KEY) throw new Skip("OPENROUTER_API_KEY missing");
    const models = (env.OPENROUTER_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!models.length) throw new Skip("OPENROUTER_MODELS empty — run `ask list-free` and set it");
    // `models` array = OpenRouter server-side fallback when a free model is down / rate-limited
    return chat("https://openrouter.ai/api/v1/chat/completions", env.OPENROUTER_API_KEY,
      { model: models[0], models: models.slice(0, 3) }, prompt, ctx);
  },
  deepseek: (prompt, ctx) => {
    if (!env.DEEPSEEK_API_KEY) throw new Skip("DEEPSEEK_API_KEY missing");
    return chat("https://api.deepseek.com/chat/completions", env.DEEPSEEK_API_KEY,
      { model: env.DEEPSEEK_MODEL || "deepseek-chat" }, prompt, ctx);
  },
  xai: (prompt, ctx) => {
    if (!env.XAI_API_KEY) throw new Skip("XAI_API_KEY missing");
    if (!env.XAI_MODEL) throw new Skip("XAI_MODEL not set (check docs.x.ai for current model ids)");
    return chat("https://api.x.ai/v1/chat/completions", env.XAI_API_KEY, { model: env.XAI_MODEL }, prompt, ctx);
  },
  qwen: (prompt, ctx) => {
    if (!env.DASHSCOPE_API_KEY) throw new Skip("DASHSCOPE_API_KEY missing");
    const base = env.DASHSCOPE_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    return chat(`${base}/chat/completions`, env.DASHSCOPE_API_KEY,
      { model: env.QWEN_MODEL || "qwen-plus" }, prompt, ctx);
  },
};

async function chat(url, key, body, prompt, ctx) {
  const messages = [{ role: "user", content: ctx ? `${prompt}\n\n---\n${ctx}` : prompt }];
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, messages }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  const j = JSON.parse(text);
  const out = j.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error(`empty response: ${text.slice(0, 300)}`);
  return { out, model: j.model, usage: j.usage };
}

const tiers = {
  cheap: ["openrouter", "deepseek", "gemini"],
  review: ["deepseek", "xai", "openrouter"],
  big: ["gemini", "openrouter"],
};

async function listFree() {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const { data } = await res.json();
  const free = data.filter((m) => m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
  for (const m of free) console.log(`${m.id}\t${m.context_length || "?"} ctx`);
  console.error(`\n${free.length} free models. Pick 2-3 and set OPENROUTER_MODELS=id1,id2,id3`);
}

function usage() {
  if (!existsSync(LOG)) return console.log("no usage yet");
  const today = new Date().toISOString().slice(0, 10);
  const counts = {};
  for (const l of readFileSync(LOG, "utf8").trim().split("\n")) {
    try { const e = JSON.parse(l); if (e.ts.startsWith(today)) { const k = `${e.provider}${e.ok ? "" : " (failed)"}`; counts[k] = (counts[k] || 0) + 1; } } catch {}
  }
  console.log(`today (${today}):`); for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
}

async function main() {
  const [target, ...rest] = process.argv.slice(2);
  if (!target || target === "-h" || target === "--help") {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return;
  }
  if (target === "list-free") return listFree();
  if (target === "usage") return usage();
  const prompt = rest.join(" ");
  if (!prompt) { console.error("missing prompt"); process.exit(2); }
  const ctx = readStdin();
  const chain = tiers[target] || [target];
  const errors = [];
  for (const name of chain) {
    const fn = providers[name];
    if (!fn) { console.error(`unknown provider/tier: ${name}`); process.exit(2); }
    const t0 = Date.now();
    try {
      const r = await fn(prompt, ctx);
      const out = typeof r === "string" ? r : r.out;
      log({ provider: name, model: r.model, ok: true, ms: Date.now() - t0, usage: r.usage, chars_in: prompt.length + ctx.length });
      console.error(`[ask] ${name}${r.model ? ` (${r.model})` : ""} ok in ${Date.now() - t0}ms`);
      console.log(out);
      return;
    } catch (e) {
      const skip = e instanceof Skip;
      if (!skip) log({ provider: name, ok: false, ms: Date.now() - t0, err: String(e.message).slice(0, 200) });
      errors.push(`${name}: ${skip ? "skipped — " : ""}${e.message}`);
    }
  }
  console.error(`[ask] all providers failed:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
main().catch((e) => { console.error(`[ask] ${e.cause?.message || e.message}`); process.exit(1); });
