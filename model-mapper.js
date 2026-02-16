const MODEL_MAP = {
  "gpt-4.1": "gemini-1.5-pro",
  "gpt-4o-mini": "gemini-1.5-flash",
};

export function mapModel(openAiModel, tenant) {
  if (!tenant.allowedModels.includes(openAiModel)) {
    throw new Error("Model not allowed for tenant");
  }

  return MODEL_MAP[openAiModel] || tenant.defaultModel;
}
