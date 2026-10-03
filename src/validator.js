import { readFileSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"));

const required = schema.required;
const EVENT_TYPES = new Set(schema.properties.event_type.enum);
const AGGREGATE_TYPES = new Set(schema.properties.aggregate_type.enum);

export function validateEvent(record) {
  const errors = required.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);
  if ("event_id" in record && (typeof record.event_id !== "string" || record.event_id.length === 0)) {
    errors.push("event_id 必须是非空字符串");
  }
  if ("event_type" in record && !EVENT_TYPES.has(record.event_type)) {
    errors.push(`event_type 不在约定枚举内：${record.event_type}`);
  }
  if ("aggregate_type" in record && !AGGREGATE_TYPES.has(record.aggregate_type)) {
    errors.push(`aggregate_type 不在约定枚举内：${record.aggregate_type}`);
  }
  if ("aggregate_id" in record && (typeof record.aggregate_id !== "string" || record.aggregate_id.length === 0)) {
    errors.push("aggregate_id 必须是非空字符串");
  }
  if ("occurred_at" in record && (typeof record.occurred_at !== "string" || Number.isNaN(Date.parse(record.occurred_at)))) {
    errors.push("occurred_at 必须是可解析的日期时间");
  }
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if ("summary" in record && (typeof record.summary !== "string" || record.summary.length === 0)) {
    errors.push("summary 必须是非空字符串");
  }
  if ("payload" in record && (typeof record.payload !== "object" || record.payload === null || Array.isArray(record.payload))) {
    errors.push("payload 必须是对象");
  }
  return errors;
}
