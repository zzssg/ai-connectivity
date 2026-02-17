import dotenv from "dotenv";
dotenv.config();

const TENANTS = [
  {
    id: "tenantA",
    apiKeyHash: process.env.TENANT_A_KEY_HASH,
    allowedModels: ["gemini-2.5-flash-lite", "gemini-3-flash-lite"],
    temperature: 0.7,
    systemPrompt: "You are a corporate fintech assistant.",
  },
];

export async function getTenantByApiKey(hash) {
  return TENANTS.find(t => t.apiKeyHash === hash);
}
