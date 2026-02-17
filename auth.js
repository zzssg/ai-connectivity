import crypto from "crypto";
import { createLogger } from "./utils.js";
import { getTenantByApiKey } from "./tenant-store.js";

const log = createLogger(import.meta.url);

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const apiKey = authHeader.substring(7);

    const keyHash = crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const tenant = await getTenantByApiKey(keyHash);

    if (!tenant) {
      log.info(`Unauthorized API key received: ${apiKey}`);
      return res.status(401).json({ error: "Invalid API key" });
    }

    req.tenant = tenant;

    next();
  } catch (err) {
    log.error("Authentication error:", err);
    return res.status(500).json({ error: "Auth failure" });
  }
}
