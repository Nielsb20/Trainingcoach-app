"use strict";

/**
 * llmProvider.js — one place that knows how to talk to a language model.
 *
 * The coach route shouldn't care which provider is configured, so this module
 * hides the differences: Anthropic and Gemini have different endpoints, auth
 * headers, request shapes and response shapes. Everything else in the server
 * just calls `callCoachModel()` and gets text back.
 *
 * Choose a provider with LLM_PROVIDER=anthropic|gemini in .env. If it's not
 * set, we auto-detect based on which API key is present — so dropping in a
 * GEMINI_API_KEY is enough to switch.
 */

/**
 * The JSON shape we want back from the coach. Gemini can enforce this
 * server-side via responseSchema, which is more reliable than asking nicely
 * in the prompt. Anthropic gets the same contract via the system prompt.
 */
const COACH_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    analyse: { type: "STRING" },
    tips: { type: "ARRAY", items: { type: "STRING" } },
    waarschuwing: { type: "STRING", nullable: true },
    cardioVoorstel: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          dag: { type: "STRING" },
          type: { type: "STRING" },
          invulling: { type: "STRING" },
        },
        required: ["dag", "type", "invulling"],
      },
    },
    krachtVoorstel: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          dag: { type: "STRING" },
          schemaDag: { type: "STRING" },
          invulling: { type: "STRING" },
        },
        required: ["dag", "schemaDag", "invulling"],
      },
    },
  },
  required: ["analyse", "tips", "cardioVoorstel", "krachtVoorstel"],
};

function resolveProvider() {
  const explicit = (process.env.LLM_PROVIDER || "").trim().toLowerCase();
  if (explicit) {
    if (!["anthropic", "gemini"].includes(explicit)) {
      throw new Error(`Onbekende LLM_PROVIDER "${explicit}" — kies 'anthropic' of 'gemini'.`);
    }
    return explicit;
  }
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  throw new Error(
    "Geen API-sleutel gevonden. Zet GEMINI_API_KEY of ANTHROPIC_API_KEY in .env (zie .env.example)."
  );
}

/* ------------------------------- Anthropic ------------------------------ */

async function callAnthropic({ systemPrompt, userContent, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY ontbreekt in .env.");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.content) {
    throw new Error(data?.error?.message || `Anthropic API gaf status ${response.status}`);
  }

  const rawText = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { rawText, provider: "anthropic", model };
}

/* -------------------------------- Gemini -------------------------------- */

async function callGemini({ systemPrompt, userContent, maxTokens }) {
  // Gemini 3 models reason before answering, and those thinking tokens count
  // against maxOutputTokens. A budget sized for the visible answer alone gets
  // consumed by thinking and truncates the JSON mid-sentence, so give it room.
  const outputBudget = Math.max(maxTokens * 8, 8000);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY ontbreekt in .env.");
  const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Header auth rather than ?key= in the URL, so the key never ends up
      // in server logs or proxy access logs.
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: {
        maxOutputTokens: outputBudget,
        // Ask Gemini to enforce the JSON contract itself instead of relying
        // purely on the prompt — noticeably more reliable.
        responseMimeType: "application/json",
        responseSchema: COACH_RESPONSE_SCHEMA,
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini API gaf status ${response.status}`);
  }

  const candidate = data?.candidates?.[0];
  if (!candidate) {
    // Usually a safety block or an empty completion; surface the reason if given.
    const reason = data?.promptFeedback?.blockReason || "geen antwoord ontvangen";
    throw new Error(`Gemini gaf geen bruikbaar antwoord (${reason}).`);
  }

  const rawText = (candidate.content?.parts || [])
    .map((p) => p.text || "")
    .join("\n")
    .trim();

  if (candidate.finishReason === "MAX_TOKENS") {
    throw new Error(
      "Gemini's antwoord werd afgekapt omdat het tokenbudget op was. Verhoog maxTokens, " +
        "of kies een model dat minder 'thinking'-tokens gebruikt."
    );
  }

  if (!rawText) {
    throw new Error(`Gemini gaf een leeg antwoord (finishReason: ${candidate.finishReason || "onbekend"}).`);
  }

  return { rawText, provider: "gemini", model };
}

/* ------------------------------ public API ------------------------------ */

/**
 * Calls whichever provider is configured and returns the raw text response.
 * Parsing/validating that text stays the caller's job.
 */
async function callCoachModel({ systemPrompt, userContent, maxTokens = 1000 }) {
  const provider = resolveProvider();
  if (provider === "gemini") return callGemini({ systemPrompt, userContent, maxTokens });
  return callAnthropic({ systemPrompt, userContent, maxTokens });
}

/** Which provider/model would be used right now — handy for diagnostics. */
function describeProvider() {
  try {
    const provider = resolveProvider();
    const model =
      provider === "gemini"
        ? process.env.GEMINI_MODEL || "gemini-3-flash-preview"
        : process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
    return { configured: true, provider, model };
  } catch (err) {
    return { configured: false, error: err.message };
  }
}

module.exports = { callCoachModel, describeProvider, resolveProvider, COACH_RESPONSE_SCHEMA };
