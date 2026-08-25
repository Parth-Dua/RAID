import type { ServerErrorPayload } from "@raid/shared";

export class RaidError extends Error {
  constructor(
    public readonly code: ServerErrorPayload["code"],
    message: string,
  ) {
    super(message);
    this.name = "RaidError";
  }

  toPayload(requestId?: string): ServerErrorPayload {
    return { code: this.code, message: this.message, requestId };
  }
}
