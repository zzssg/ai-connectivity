const TENANTS = [
  {
    id: "tenantA",
    apiKeyHash: process.env.TENANT_A_KEY_HASH,
    allowedModels: ["gpt-4.1", "gpt-4o-mini"],
    defaultModel: "gpt-4.1",
    temperature: 0.3,
    systemPrompt: "You are a corporate fintech assistant.",
  },
];

export async function getTenantByApiKey(hash) {
  return TENANTS.find(t => t.apiKeyHash === hash);
}
