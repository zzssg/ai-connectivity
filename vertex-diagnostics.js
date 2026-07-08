import { GoogleAuth } from "google-auth-library";
import { createLogger } from "./utils.js";

const log = createLogger(import.meta.url);

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

// Publishers we probe in Vertex AI Model Garden. Ones that aren't enabled for the
// project simply return an error which we surface in the diagnostics rather than
// failing the whole collection.
const KNOWN_PUBLISHERS = [
  "google",
  "anthropic",
  "meta",
  "mistralai",
  "ai21",
  "cohere",
  "deepseek-ai",
  "qwen",
];

let auth;
function getAuth() {
  if (!auth) auth = new GoogleAuth({ scopes: SCOPE });
  return auth;
}

function region() {
  return process.env.GCP_REGION || "us-central1";
}

function apiHost() {
  return `https://${region()}-aiplatform.googleapis.com`;
}

// ---------------------------------------------------------------------------
// Project / environment info
// ---------------------------------------------------------------------------

function detectAuthMethod() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return "Service Account Key File (GOOGLE_APPLICATION_CREDENTIALS)";
  }
  if (process.env.K_SERVICE || process.env.GAE_SERVICE || process.env.FUNCTION_TARGET) {
    return "Application Default Credentials (attached service account)";
  }
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.CLOUDSDK_CORE_PROJECT) {
    return "Application Default Credentials (gcloud / metadata)";
  }
  return "Application Default Credentials";
}

function detectRuntime() {
  if (process.env.K_SERVICE) return "Google Cloud Run";
  if (process.env.GAE_SERVICE) return "Google App Engine";
  if (process.env.FUNCTION_TARGET) return "Google Cloud Functions";
  if (process.env.KUBERNETES_SERVICE_HOST) return "Kubernetes / GKE";
  return "Local / Self-hosted";
}

async function collectProjectInfo() {
  const a = getAuth();
  let projectId = process.env.GCP_PROJECT_ID || null;
  let serviceAccount = null;

  try {
    if (!projectId) projectId = await a.getProjectId();
  } catch {
    /* ignore — fall back to env value */
  }

  try {
    const creds = await a.getCredentials();
    serviceAccount = creds?.client_email || null;
  } catch {
    /* service account may not be discoverable */
  }

  const info = {
    projectId: projectId || "(unknown)",
    region: region(),
    serviceAccount: serviceAccount || "(not discoverable)",
    authMethod: detectAuthMethod(),
    runtime: detectRuntime(),
    nodeVersion: process.version,
  };

  return info;
}

function collectEnvironment(projectInfo) {
  return {
    runtime: projectInfo.runtime,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    cloudRunService: process.env.K_SERVICE || null,
    cloudRunRevision: process.env.K_REVISION || null,
    cloudRunConfiguration: process.env.K_CONFIGURATION || null,
    projectId: projectInfo.projectId,
    region: projectInfo.region,
  };
}

// ---------------------------------------------------------------------------
// Capability / modality inference
//
// The Vertex AI publisher-model API does not consistently expose modalities and
// fine-grained capabilities, so where the API is silent we infer them from the
// model id. Inferred models are flagged so the UI can be transparent about it.
// ---------------------------------------------------------------------------

function emptyCapabilities() {
  return {
    chat: false,
    textGeneration: false,
    embeddings: false,
    vision: false,
    imageGeneration: false,
    audio: false,
    video: false,
    toolCalling: false,
    functionCalling: false,
    structuredOutput: false,
    contextCache: false,
    thinking: false,
  };
}

function inferModel(modelId, publisher) {
  const id = (modelId || "").toLowerCase();
  const caps = emptyCapabilities();
  const inputModalities = new Set();
  const outputModalities = new Set();
  const supportedMethods = new Set();
  let taskTypes = [];
  let embeddingDimensions = null;

  const isEmbedding = /embedding|embed|textembedding|multimodalembedding/.test(id);
  const isImagen = /imagen|image-generation/.test(id);
  const isGemini = id.startsWith("gemini");
  const isVeo = id.startsWith("veo");
  const isChirp = id.startsWith("chirp");

  // Publishers whose catalogue is (almost) entirely generative chat LLMs.
  const textPublishers = ["anthropic", "meta", "mistralai", "ai21", "deepseek-ai", "qwen"];
  // Google-owned generative text families that aren't Gemini.
  const isGoogleTextFamily = /^(gemma|paligemma|palm|text-bison|chat-bison|code-bison|codechat|codey|medlm|learnlm|txgemma|medgemma|codegemma)/.test(id);
  const isThirdPartyText = textPublishers.includes(publisher);

  let category = "specialized"; // generative | embedding | image | video | speech | specialized

  if (isEmbedding) {
    category = "embedding";
    caps.embeddings = true;
    supportedMethods.add("predict");
    inputModalities.add("text");
    outputModalities.add("embedding");
    taskTypes = [
      "RETRIEVAL_QUERY",
      "RETRIEVAL_DOCUMENT",
      "SEMANTIC_SIMILARITY",
      "CLASSIFICATION",
      "CLUSTERING",
      "QUESTION_ANSWERING",
      "FACT_VERIFICATION",
      "CODE_RETRIEVAL_QUERY",
    ];
    if (/multimodal/.test(id)) inputModalities.add("image").add("video");
    if (/gemini-embedding/.test(id)) embeddingDimensions = 3072;
    else if (/text-embedding-004|text-embedding-005|textembedding-gecko|text-multilingual-embedding|embeddinggemma/.test(id)) embeddingDimensions = 768;
    else if (/text-embedding-large/.test(id)) embeddingDimensions = 3072;
    else if (/multimodalembedding/.test(id)) embeddingDimensions = 1408;
  } else if (isImagen) {
    category = "image";
    caps.imageGeneration = true;
    caps.vision = true;
    supportedMethods.add("predict");
    inputModalities.add("text");
    if (/edit|customization|inpaint|outpaint/.test(id)) inputModalities.add("image");
    outputModalities.add("image");
  } else if (isVeo) {
    category = "video";
    caps.video = true;
    supportedMethods.add("predict");
    inputModalities.add("text").add("image");
    outputModalities.add("video");
  } else if (isChirp) {
    category = "speech";
    caps.audio = true;
    supportedMethods.add("predict");
    inputModalities.add("audio");
    outputModalities.add("text");
  } else if (isGemini) {
    category = "generative";
    caps.chat = true;
    caps.textGeneration = true;
    caps.vision = true;
    caps.toolCalling = true;
    caps.functionCalling = true;
    caps.structuredOutput = true;
    caps.contextCache = true;
    supportedMethods.add("generateContent").add("streamGenerateContent").add("countTokens");
    inputModalities.add("text").add("image").add("audio").add("video").add("pdf");
    outputModalities.add("text");
    // Reasoning ("thinking") landed with the 2.5 / 3.x families.
    if (/gemini-(2\.5|3|3\.)/.test(id) || /gemini-2-5/.test(id)) caps.thinking = true;
    if (/gemini-3/.test(id)) caps.thinking = true;
    // Native image output for the image-generation flavours.
    if (/image/.test(id)) {
      caps.imageGeneration = true;
      outputModalities.add("image");
    }
  } else if (isThirdPartyText || isGoogleTextFamily) {
    // Foundation chat / text-generation models (Claude, Llama, Mistral, Gemma, …)
    category = "generative";
    caps.chat = true;
    caps.textGeneration = true;
    supportedMethods.add("rawPredict").add("streamRawPredict");
    inputModalities.add("text");
    outputModalities.add("text");

    if (isGoogleTextFamily) {
      // Gemma family is served through generateContent on Vertex too.
      supportedMethods.add("generateContent");
      if (/gemma-3|paligemma|gemma3/.test(id)) {
        caps.vision = true;
        inputModalities.add("image");
      }
    }
    if (publisher === "anthropic") {
      caps.vision = true;
      caps.toolCalling = true;
      caps.functionCalling = true;
      caps.structuredOutput = true;
      inputModalities.add("image").add("pdf");
      // Extended thinking is available on Claude 3.7 and all 4.x / 5.x models.
      caps.thinking = !/claude-(2|instant|3-5|3-haiku|3-opus|3-sonnet)/.test(id);
      supportedMethods.add("streamRawPredict");
    }
    if (publisher === "meta") {
      caps.toolCalling = true;
      caps.functionCalling = true;
      if (/vision|llama-3\.2|llama-4|scout|maverick/.test(id)) {
        caps.vision = true;
        inputModalities.add("image");
      }
    }
    if (publisher === "mistralai") {
      caps.toolCalling = true;
      caps.functionCalling = true;
      if (/pixtral/.test(id)) {
        caps.vision = true;
        inputModalities.add("image");
      }
    }
  } else {
    // Specialized / task-specific Model Garden entries (e.g. classification,
    // object detection). We don't assert generative capabilities for these.
    category = "specialized";
  }

  const isFoundation = category === "generative" || category === "embedding" ||
    category === "image" || category === "video" || category === "speech";

  return {
    category,
    isFoundation,
    capabilities: caps,
    inputModalities: [...inputModalities],
    outputModalities: [...outputModalities],
    supportedMethods: [...supportedMethods],
    taskTypes,
    embeddingDimensions,
    isEmbedding,
    isGemini,
  };
}

function humanizeDisplayName(modelId) {
  return (modelId || "")
    .split("/").pop()
    .split("-")
    .map((part) => {
      if (/^\d+(\.\d+)?$/.test(part)) return part; // keep version numbers as-is
      if (part.length <= 2) return part.toUpperCase(); // e.g. "ai" -> "AI"
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function geminiFamily(modelId) {
  const id = (modelId || "").toLowerCase();
  if (!id.startsWith("gemini")) return null;
  if (/gemini-embedding/.test(id)) return "Gemini Embedding";
  // gemini-2.5-flash-lite -> "Gemini 2.5 Flash Lite"
  const rest = id.replace(/^gemini-/, "");
  const parts = rest.split("-").filter((p) => !/^\d{3,}$/.test(p) && !/preview|latest|exp|\d{2}/.test(p));
  const label = parts
    .map((p) => (/^\d+(\.\d+)?$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ")
    .trim();
  return `Gemini ${label}`.replace(/\s+/g, " ").trim();
}

function normalizeModel(raw, publisher) {
  // raw.name looks like "publishers/google/models/gemini-2.5-pro"
  const name = raw.name || "";
  const modelId = name.split("/models/").pop() || name;
  const inferred = inferModel(modelId, publisher);

  return {
    modelId,
    name,
    displayName: raw.displayName || humanizeDisplayName(modelId),
    publisher,
    version: raw.versionId || raw.version || null,
    versionState: raw.versionState || null,
    launchStage: raw.launchStage || null,
    openSourceCategory: raw.openSourceCategory || null,
    supportedMethods: inferred.supportedMethods,
    inputModalities: inferred.inputModalities,
    outputModalities: inferred.outputModalities,
    capabilities: inferred.capabilities,
    category: inferred.category,
    isFoundation: inferred.isFoundation,
    isGemini: inferred.isGemini,
    isEmbedding: inferred.isEmbedding,
    family: geminiFamily(modelId),
    taskTypes: inferred.taskTypes,
    embeddingDimensions: inferred.embeddingDimensions,
    capabilitiesInferred: true,
  };
}

// ---------------------------------------------------------------------------
// Model discovery via the Vertex AI publisher-models API
// ---------------------------------------------------------------------------

function parseError(err) {
  const status = err?.response?.status || err?.code || null;
  const data = err?.response?.data;
  const apiError = data?.error;
  return {
    status: typeof status === "number" ? status : (apiError?.code ?? null),
    code: apiError?.status || err?.code || null,
    message: apiError?.message || err?.message || "Unknown error",
  };
}

async function listPublisherModels(client, publisher) {
  const collected = [];
  let pageToken = "";
  let pages = 0;

  do {
    const params = new URLSearchParams({ pageSize: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `${apiHost()}/v1beta1/publishers/${publisher}/models?${params.toString()}`;

    const resp = await client.request({ url, method: "GET" });
    const body = resp.data || {};
    const list = body.publisherModels || [];
    for (const m of list) collected.push(m);
    pageToken = body.nextPageToken || "";
    pages += 1;
  } while (pageToken && pages < 10);

  return collected;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function collectDiagnostics() {
  const generatedAt = new Date().toISOString();
  const projectInfo = await collectProjectInfo();
  const environment = collectEnvironment(projectInfo);

  const vertex = {
    available: false,
    apiEndpoint: apiHost(),
    modelDiscovery: "failed",
    errors: [],
  };

  const iam = {
    canAccessVertexAI: false,
    canListPublisherModels: false,
    canReadModelMetadata: false,
    failures: [],
  };

  const models = [];

  let client;
  try {
    client = await getAuth().getClient();
  } catch (err) {
    const e = parseError(err);
    iam.failures.push({
      check: "Obtain credentials",
      status: e.status,
      code: e.code,
      message: e.message,
      remediation:
        "Ensure GOOGLE_APPLICATION_CREDENTIALS points to a valid key file, or that Application Default Credentials are available (gcloud auth application-default login / attached service account).",
    });
    return finalize({ generatedAt, project: projectInfo, environment, vertex, iam, models });
  }

  let anySuccess = false;
  let anyFailure = false;

  for (const publisher of KNOWN_PUBLISHERS) {
    try {
      const raw = await listPublisherModels(client, publisher);
      anySuccess = true;
      for (const m of raw) models.push(normalizeModel(m, publisher));
    } catch (err) {
      anyFailure = true;
      const e = parseError(err);
      vertex.errors.push({ publisher, ...e });
      // Only treat access/permission errors on the primary "google" publisher as
      // hard IAM failures; a missing 3rd-party publisher (404) is expected.
      if (publisher === "google" || e.status === 403 || e.status === 401) {
        iam.failures.push({
          check: `List publisher models (${publisher})`,
          status: e.status,
          code: e.code,
          message: e.message,
          remediation: remediationFor(e.status),
        });
      }
    }
  }

  vertex.available = anySuccess;
  iam.canAccessVertexAI = anySuccess;
  iam.canListPublisherModels = anySuccess;
  // If we could list models and they carry metadata (version/methods), reads work.
  iam.canReadModelMetadata = anySuccess && models.length > 0;

  if (anySuccess && !anyFailure) vertex.modelDiscovery = "ok";
  else if (anySuccess && anyFailure) vertex.modelDiscovery = "partial";
  else vertex.modelDiscovery = "failed";

  return finalize({ generatedAt, project: projectInfo, environment, vertex, iam, models });
}

function remediationFor(status) {
  switch (status) {
    case 401:
      return "Credentials are missing or expired. Re-authenticate (gcloud auth application-default login) or refresh the service-account key.";
    case 403:
      return "The service account lacks Vertex AI permissions. Grant roles/aiplatform.user (and roles/aiplatform.viewer) on the project.";
    case 404:
      return "The publisher or model is not available in this region. Verify the model id and GCP_REGION.";
    case 429:
      return "Quota exceeded. Retry later or request a quota increase for the Vertex AI API.";
    default:
      return "Verify the Vertex AI API is enabled (aiplatform.googleapis.com) and the service account has appropriate roles.";
  }
}

function finalize(d) {
  // Publisher overview
  const publisherCounts = {};
  for (const m of d.models) {
    publisherCounts[m.publisher] = (publisherCounts[m.publisher] || 0) + 1;
  }
  const publishers = Object.entries(publisherCounts)
    .map(([publisher, count]) => ({ publisher, count }))
    .sort((a, b) => b.count - a.count);

  return { ...d, publishers };
}
