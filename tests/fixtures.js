import { buildDomain } from "../src/domain.js";
import { EventStore } from "../src/store.js";

export const T0 = "2026-01-01T00:00:00+08:00";

export function makeStore(events = []) {
  return new EventStore(events);
}

export function domain(store) {
  return buildDomain(store);
}

export function classify(store, id, payload, at = T0) {
  return store.record({
    event_type: "ELEMENT_CLASSIFIED",
    aggregate_type: "heritage_element",
    aggregate_id: id,
    occurred_at: at,
    summary: `登记元素 ${id}`,
    payload,
  });
}

export function linkToProject(store, id, projectId, at = T0) {
  return store.record({
    event_type: "ELEMENT_LINKED",
    aggregate_type: "heritage_element",
    aggregate_id: id,
    occurred_at: at,
    summary: `元素 ${id} 归属项目 ${projectId}`,
    payload: { link_type: "belongs_to_project", target_type: "heritage_element", target_id: projectId },
  });
}

export function grant(store, id, payload, at = T0) {
  return store.record({
    event_type: "PERMISSION_GRANTED",
    aggregate_type: "usage_permission",
    aggregate_id: id,
    occurred_at: at,
    summary: `授权 ${id}`,
    payload,
  });
}

export function prohibit(store, id, payload, at = T0) {
  return store.record({
    event_type: "PROHIBITION_DECLARED",
    aggregate_type: "usage_permission",
    aggregate_id: id,
    occurred_at: at,
    summary: `禁用 ${id}`,
    payload,
  });
}

export function withdraw(store, id, payload, at) {
  return store.record({
    event_type: "PERMISSION_WITHDRAWN",
    aggregate_type: "usage_permission",
    aggregate_id: id,
    occurred_at: at,
    summary: `撤回 ${id}`,
    payload,
  });
}

export function asset(store, id, payload, at = T0) {
  return store.record({
    event_type: "ASSET_GENERATED",
    aggregate_type: "generated_asset",
    aggregate_id: id,
    occurred_at: at,
    summary: `生成资产 ${id}`,
    payload,
  });
}

export function channel(store, id, payload, at = T0) {
  return store.record({
    event_type: "CHANNEL_REGISTERED",
    aggregate_type: "commercial_channel",
    aggregate_id: id,
    occurred_at: at,
    summary: `登记渠道 ${id}`,
    payload,
  });
}
