import { randomBytes } from "node:crypto";

// 16바이트 = 32 hex. OAuth 페어링용 일회성 코드.
export function newPairingCode(): string {
  return randomBytes(16).toString("hex");
}
