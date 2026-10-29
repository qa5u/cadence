import { NextResponse } from "next/server";

const NEBIUS_BASE = "https://api.tokenfactory.nebius.com/v1";
const NEBIUS_MODEL = process.env.NEBIUS_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const NEBIUS_KEY = process.env.NEBIUS_API_KEY || "";

export async function POST(req: Request) {
  if (!NEBIUS_KEY) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const { prompt } = await req.json();

  try {
    const res = await fetch(`${NEBIUS_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NEBIUS_KEY}`,
      },
      body: JSON.stringify({
        model: NEBIUS_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `API call failed (${res.status})`, detail: detail.slice(0, 500) },
        { status: res.status }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "No response from API" }, { status: 500 });
    }
    return NextResponse.json(JSON.parse(content));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
