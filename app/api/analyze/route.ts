import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const NEBIUS_BASE = "https://api.tokenfactory.nebius.com/v1";
const MAX_BODY = 120_000;
const MAX_PROMPT = 40_000;
const RATE_KEY = "unknown";

const ALLOWED_ORIGINS = new Set([
  "https://cadence.web.id",
  "https://cadence.fwkinooo.workers.dev",
]);

type RateLimiter = {
  limit: (opts: { key: string }) => Promise<{ success: boolean }>;
};

const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 10;
const buckets = new Map<string, number[]>();

function fail(error: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store", ...headers } }
  );
}

function strictWithinLimit(key: string): boolean {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= WINDOW_LIMIT) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5000) {
    for (const [k, times] of buckets) {
      if (times.length === 0 || now - times[times.length - 1] >= WINDOW_MS) {
        buckets.delete(k);
      }
    }
  }
  return true;
}

function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return RATE_KEY;
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  return false;
}

async function withinRateLimit(ip: string): Promise<boolean> {
  try {
    const { env } = getCloudflareContext();
    const limiter = (env as unknown as { ANALYZE_RATE_LIMITER?: RateLimiter })
      .ANALYZE_RATE_LIMITER;
    if (!limiter) {
      console.error("[analyze] rate limiter binding missing");
      return true;
    }
    const { success } = await limiter.limit({ key: ip });
    if (!success) console.warn("[analyze] rate limited");
    return success;
  } catch (err: unknown) {
    console.error("[analyze] rate limiter failed", err instanceof Error ? err.message : err);
    return true;
  }
}

async function validTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!token || token.length > 4096) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip !== RATE_KEY) body.set("remoteip", ip);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }
    );
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SESSION_TTL_MS = 10 * 60_000;

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function mintSession(ip: string): Promise<string | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const payload = b64url(
    encoder.encode(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, ip }))
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await sessionKey(secret),
    encoder.encode(payload)
  );
  return `${payload}.${b64url(new Uint8Array(signature))}`;
}

async function validSession(token: string, ip: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await sessionKey(secret),
      fromB64url(signature),
      encoder.encode(payload)
    );
    if (!ok) return false;
    const data = JSON.parse(decoder.decode(fromB64url(payload))) as {
      exp?: number;
      ip?: string;
    };
    return typeof data.exp === "number" && data.exp > Date.now() && data.ip === ip;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!originAllowed(req)) {
    return fail("Forbidden", 403);
  }

  const ip = clientIp(req);

  if (!strictWithinLimit(ip) || !(await withinRateLimit(ip))) {
    return fail("Too many requests. Wait a minute and try again.", 429, {
      "Retry-After": "60",
    });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return fail("Request too large", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("Invalid JSON", 400);
  }

  const { prompt, turnstileToken, sessionToken } = (parsed ?? {}) as {
    prompt?: unknown;
    turnstileToken?: unknown;
    sessionToken?: unknown;
  };

  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT) {
    return fail("Invalid prompt", 400);
  }

  let minted: string | null = null;
  const hasSession =
    typeof sessionToken === "string" &&
    sessionToken.length <= 2048 &&
    (await validSession(sessionToken, ip));

  if (!hasSession) {
    if (
      typeof turnstileToken !== "string" ||
      !(await validTurnstile(turnstileToken, ip))
    ) {
      return fail("Verification required", 403);
    }
    minted = await mintSession(ip);
  }

  const sessionHeaders: Record<string, string> = minted
    ? { "X-Cadence-Session": minted }
    : {};

  const key = process.env.NEBIUS_API_KEY || "";
  const model = process.env.NEBIUS_MODEL || "nvidia/nemotron-3-super-120b-a12b";
  if (!key) {
    return fail("Service is not configured", 500, sessionHeaders);
  }

  try {
    const res = await fetch(`${NEBIUS_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[analyze] upstream error", res.status, detail.slice(0, 500));
      return fail("The notes service is unavailable. Try again.", 502, sessionHeaders);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return fail("The notes service returned an empty result. Try again.", 502, sessionHeaders);
    }

    return NextResponse.json(JSON.parse(content), {
      headers: { "Cache-Control": "no-store", ...sessionHeaders },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[analyze] request failed", message);
    return fail("The notes service is unavailable. Try again.", 502, sessionHeaders);
  }
}
