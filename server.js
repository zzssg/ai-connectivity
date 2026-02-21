import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createLogger } from "./utils.js";
import { VertexAI } from "@google-cloud/vertexai";
import { GoogleGenAI } from "@google/genai";
import { authenticate } from "./auth.js";

const log = createLogger(import.meta.url);

const app = express();
app.use(express.json());

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID,
  location: process.env.GCP_REGION,
});

const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GCP_PROJECT_ID,
  location: process.env.GCP_REGION
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
