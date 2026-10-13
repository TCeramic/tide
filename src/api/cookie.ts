import fs from "node:fs";
import path from "node:path";

const COOKIE_LIMIT = 8192;

/** True when the header includes a non-empty MUSIC_U value. */
export function hasMusicU(cookie: string): boolean {
  return cookie.split(";").some((part) => {
    const trimmed = part.trim();
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) return false;
    return trimmed.slice(0, splitAt) === "MUSIC_U" && trimmed.slice(splitAt + 1).length > 0;
  });
}

export function normalizeCookie(input: string): string | null {
  const cookie = input.replace(/[\r\n]+/g, "").trim();
  if (cookie.length === 0 || cookie.length > COOKIE_LIMIT) return null;
  return cookie;
}

/**
 * Cookie text for the local NetEase session.
 * `filePath` null keeps it in memory (tests). A real path is `userData/netease.cookie`.
 */
export class CookieStore {
  private memory: string | null = null;

  constructor(private readonly filePath: string | null) {}

  read(): string | null {
    if (this.filePath == null) return this.memory;
    try {
      const text = fs.readFileSync(this.filePath, "utf8").trim();
      return text.length > 0 ? text : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  write(cookie: string): void {
    if (this.filePath == null) {
      this.memory = cookie;
      return;
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, cookie, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Windows does not honor POSIX modes; the file still stays in userData.
    }
  }

  clear(): void {
    if (this.filePath == null) {
      this.memory = null;
      return;
    }
    fs.rmSync(this.filePath, { force: true });
    fs.rmSync(`${this.filePath}.tmp`, { force: true });
  }
}
