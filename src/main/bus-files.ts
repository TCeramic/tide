import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { allowListFromUnknown } from "../shared/commands";

/** Loopback bearer token. This is not a NetEase cookie. */
export class BusTokenStore {
  constructor(private readonly filePath: string) {}

  read(): string {
    try {
      const text = fs.readFileSync(this.filePath, "utf8").trim();
      if (/^[a-f0-9]{64}$/.test(text)) return text;
    } catch {
      // Create a token below.
    }
    const token = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    return token;
  }
}

/** Dangerous-command names the user opted into. Cookie fields are ignored. */
export class BusAllowStore {
  constructor(private readonly filePath: string) {}

  read(): string[] {
    try {
      return allowListFromUnknown(JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown);
    } catch {
      return [];
    }
  }
}
