import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createLogger } from "./utils.js";
import { VertexAI } from "@google-cloud/vertexai";
import { authenticate } from "./auth.js";

const log = createLogger(import.meta.url);

const app = express();
app.use(express.json());

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID,
  location: process.env.GCP_REGION,
});

app.post("/v1/responses", authenticate, async (req, res) => {
  try {
    const tenant = req.tenant;
    const { model, input } = req.body;

    log.info(`Operating with tenant: ${tenant?.id}. Input: ${input}`);
    const vertexModelName = model ? model : process.env.TENANT_DEFAULT_MODEL;
    log.info(`Using Vertex AI model: ${vertexModelName}`);
    const generativeModel = vertexAI.getGenerativeModel({
      model: vertexModelName,
    });

    let textPrefix = tenant.systemPrompt ? tenant.systemPrompt + "\n\n" : "";

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

    const text =
      result.response.candidates[0].content.parts[0].text;

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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(8080);
