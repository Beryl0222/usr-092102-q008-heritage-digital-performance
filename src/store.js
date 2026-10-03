// 事件追溯存储：所有事实只追加、不修改；同一聚合内 version 单调递增。
// 默认内存实现，可选 JSONL 文件持久化，便于联调与审计导出。
import { readFile } from "node:fs/promises";
import { existsSync, appendFileSync } from "node:fs";
import { validateEvent } from "./validator.js";

export class EventStore {
  #events = [];
  #seq = 0;

  constructor({ now = () => new Date().toISOString() } = {}) {
    this.now = now;
  }

  // 从 JSONL 重建（每行一个事件信封）
  static async fromFile(path, opts = {}) {
    const store = new EventStore(opts);
    if (existsSync(path)) {
      const text = await readFile(path, "utf8");
      for (const line of text.split("\n")) {
        if (line.trim()) store.append(JSON.parse(line), { expectVersion: null });
      }
    }
    store.file = path;
    return store;
  }

  // 追加事件。expectVersion 为该聚合当前版本；省略时自动取下一版本。
  append(event, { expectVersion } = {}) {
    const errors = validateEvent(event);
    if (errors.length) throw new Error(errors.join("；"));
    if (this.#events.some((e) => e.event_id === event.event_id)) {
      throw new Error(`event_id 重复：${event.event_id}`);
    }
    const current = this.aggregateVersion(event.aggregate_id);
    if (current + 1 !== event.version) {
      throw new Error(
        `聚合 ${event.aggregate_id} 版本冲突：期望 ${current + 1}，收到 ${event.version}`
      );
    }
    if (expectVersion !== undefined && expectVersion !== null && expectVersion !== current) {
      throw new Error(
        `乐观并发失败：聚合 ${event.aggregate_id} 当前版本 ${current}，调用方持 ${expectVersion}`
      );
    }
    const stored = { ...event, seq: ++this.#seq };
    this.#events.push(stored);
    if (this.file) {
      // 持久化失败必须显式暴露，不能静默丢失追溯事实
      appendFileSync(this.file, JSON.stringify(event) + "\n");
    }
    return stored;
  }

  aggregateVersion(aggregateId) {
    return this.#events
      .filter((e) => e.aggregate_id === aggregateId)
      .reduce((v, e) => Math.max(v, e.version), 0);
  }

  events() {
    return [...this.#events].sort((a, b) => a.seq - b.seq);
  }

  forAggregate(aggregateId) {
    return this.#events.filter((e) => e.aggregate_id === aggregateId);
  }
}
