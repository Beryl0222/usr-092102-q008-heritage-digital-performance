import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

test("样例符合领域约定", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

test("校验器与契约枚举一致：新事件类型通过，未知类型报错", () => {
  const base = {
    event_id: "e1",
    event_type: "TAKEDOWN_LISTED",
    aggregate_type: "takedown_order",
    aggregate_id: "td1",
    occurred_at: "2026-10-01T00:00:00+08:00",
    version: 1,
    summary: "x",
  };
  assert.deepEqual(validateEvent(base), []);
  assert.deepEqual(validateEvent({ ...base, event_type: "HACK" }), ["未知 event_type：HACK"]);
  assert.deepEqual(validateEvent({ ...base, aggregate_type: "alien" }), ["未知 aggregate_type：alien"]);
});
