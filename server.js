import dotenv from "dotenv";
dotenv.config();

import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createLogger } from "./utils.js";
import { VertexAI } from "@google-cloud/vertexai";
import { GoogleGenAI } from "@google/genai";
import { authenticate } from "./auth.js";
import { recordStat, getAllStats } from "./stats-store.js";
import { getTenantIds } from "./tenant-store.js";
import { collectDiagnostics } from "./vertex-diagnostics.js";

const log = createLogger(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use("/stats", express.static(path.join(__dirname, "public")));

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID,
  location: process.env.GCP_REGION,
});

const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GCP_PROJECT_ID,
  location: process.env.GCP_REGION
});

function authenticateStats(req, res, next) {
  const statsKey = process.env.STATS_API_KEY;
  if (!statsKey) return next(); // stats auth disabled if key not configured
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ") || header.substring(7) !== statsKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/**
 * Stats API: returns aggregated usage data for all tenants.
 */
app.get("/stats/api/data", authenticateStats, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const data = await getAllStats(getTenantIds(), days);
    res.json(data);
  } catch (err) {
    log.error(`Error fetching stats: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Diagnostics API: probes Vertex AI availability, discovers foundation models
 * across publishers, and reports project / IAM / environment info as JSON.
 * Consumed by the diagnostics dashboard at /stats/diagnostics.html.
 */
app.get("/stats/api/diagnostics", authenticateStats, async (req, res) => {
  try {
    const data = await collectDiagnostics();
    res.json(data);
  } catch (err) {
    log.error(`Error collecting diagnostics: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * OpenAI-compatible endpoint for generating responses using Vertex AI models.
 */
app.post("/v1/responses", authenticate, async (req, res) => {
  try {
    const tenant = req.tenant;
    const { model, input } = req.body;

    log.info(`Operating with tenant: ${tenant?.id}. Input: ${input}`);
    const vertexModelName = model ? model : process.env.TENANT_DEFAULT_GEN_MODEL;
    log.info(`${tenant?.id} >> Using Vertex AI generative model: ${vertexModelName}`);
    const generativeModel = vertexAI.getGenerativeModel({
      model: vertexModelName,
    });
    if (!generativeModel) {
      log.error(`${tenant?.id} >> Generative model '${vertexModelName}' not available on VertexAI client`);
      return res.status(500).json({ error: `Generative model '${vertexModelName}' not supported` });
    }

    let textPrefix = tenant.systemPrompt ? tenant.systemPrompt + "\n\n" : "";

    const startTS = Date.now();
    const result = await generativeModel.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: textPrefix + input,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: tenant.temperature,
      },
    });
    const latency = Date.now() - startTS;
    log.info(`${tenant?.id} >> Response generated in ${latency}ms`);

    const text = result.response.candidates[0].content.parts[0].text;
    log.info(`${tenant?.id} >> Generated response: ${text}`);

    const outputTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0;
    recordStat(tenant.id, "responses", (textPrefix + input).length, outputTokens)
      .catch(() => {});

    // OpenAI-compatible response
    res.json({
      id: "resp_" + crypto.randomUUID(),
      object: "response",
      created: Math.floor(Date.now() / 1000),
      model,
      output: [
        {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text,
            },
          ],
        },
      ],
    });

  } catch (err) {
    log.error(`Error generating generative response: ${JSON.stringify(err)}`);
    res.status(500).json({ error: err.message });
  }
});


/**
 * OpenAI-compatible endpoint for embeddings using Vertex AI embedding models.
 */
app.post("/v1/embeddings", authenticate, async (req, res) => {
  try {
    const tenant = req.tenant;
    const { model, input } = req.body;

    if (input === undefined || input === null) {
      return res.status(400).json({ error: "Missing input" });
    }

    const vertexModelName = model ? model : process.env.TENANT_DEFAULT_EMB_MODEL;
    log.info(`${tenant?.id} >> Using Vertex AI embedding model: ${vertexModelName}`);

    const startTS = Date.now();
    const result = await ai.models.embedContent({
      model: vertexModelName,
      contents: {
        role: 'user',
        parts: [{ text: input }],
      },
    });
    const latency = Date.now() - startTS;
    log.info(`${tenant?.id} >> Embedding generated in ${latency}ms`);

    let embeddings = result.embeddings;

    // Convert output into OpenAI-compatible format
    let promptTokens = 0;
    const data = embeddings.map((emb, idx) => {
      promptTokens += emb.statistics?.tokenCount || 0;
      return {
        object: "embedding",
        embedding: Array.isArray(emb.values) ? emb.values : [],
        index: idx,
      }
    });

    recordStat(tenant.id, "embeddings", input.length, promptTokens)
      .catch(() => {});

    res.json({
      object: "list",
      data,
      model: vertexModelName,
      "usage": {
        "prompt_tokens": promptTokens > 0 ? promptTokens : input.length,
        "total_tokens": 0
      }
    });
  } catch (err) {
    log.error(`Error generating embeddings: ${JSON.stringify(err)}`);
    res.status(500).json({ error: err.message });
  }
});

app.listen(8080);