import fs from "node:fs";
import path from "node:path";

/** Tiny atomic JSON file store for local state (watchlist, alerts, paper journal, config). No secrets are stored. */
export class JsonStore<T> {
  constructor(private file: string, private fallback: T) {}

  load(): T {
    try {
      return { ...this.fallback, ...JSON.parse(fs.readFileSync(this.file, "utf8")) } as T;
    } catch {
      return structuredClone(this.fallback);
    }
  }

  save(value: T): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
