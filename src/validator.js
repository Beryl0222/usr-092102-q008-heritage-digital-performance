import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const required = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

const schema = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../contracts/domain.schema.json"), "utf8")
);
const eventTypes = new Set(schema.properties.event_type.enum);
const aggregateTypes = new Set(schema.properties.aggregate_type.enum);

// 事件信封基础校验：必填、正整数版本、枚举取值。
// 深度业务规则由 src/policy.js 在投影上判定。
export function validateEvent(record) {
  const errors = required.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if ("event_type" in record && !eventTypes.has(record.event_type)) {
    errors.push(`未知 event_type：${record.event_type}`);
  }
  if ("aggregate_type" in record && !aggregateTypes.has(record.aggregate_type)) {
    errors.push(`未知 aggregate_type：${record.aggregate_type}`);
  }
  for (const name of ["event_id", "aggregate_id", "occurred_at", "summary"]) {
    if (name in record && (typeof record[name] !== "string" || record[name].trim() === "")) {
      errors.push(`${name} 必须是非空字符串`);
    }
  }
  return errors;
}
