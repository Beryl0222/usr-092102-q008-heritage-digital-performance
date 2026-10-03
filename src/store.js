import { validateEvent } from "./validator.js";

/**
 * 追加式事件存储。
 * 事件追溯语义：每个聚合（aggregate_type + aggregate_id）是独立事件流，
 * version 从 1 开始逐条递增，追加时校验信封合法性与版本连续性。
 */
export class EventStore {
  #events = [];
  #streams = new Map();

  constructor(events = []) {
    for (const event of events) this.append(event);
  }

  static keyOf(aggregateType, aggregateId) {
    return `${aggregateType}:${aggregateId}`;
  }

  append(event) {
    const errors = validateEvent(event);
    if (errors.length > 0) {
      throw new Error(`事件不合法：${errors.join("；")}`);
    }
    const key = EventStore.keyOf(event.aggregate_type, event.aggregate_id);
    const stream = this.#streams.get(key) ?? [];
    const expected = stream.length + 1;
    if (event.version !== expected) {
      throw new Error(`聚合 ${key} 期望版本 ${expected}，收到 ${event.version}`);
    }
    stream.push(event);
    this.#streams.set(key, stream);
    this.#events.push(event);
    return event;
  }

  nextVersion(aggregateType, aggregateId) {
    return (this.#streams.get(EventStore.keyOf(aggregateType, aggregateId))?.length ?? 0) + 1;
  }

  /** 构造一条符合信封约定的事件（自动分配 event_id 与 version），不追加。 */
  prepare({ event_type, aggregate_type, aggregate_id, occurred_at, summary, payload = {} }) {
    const version = this.nextVersion(aggregate_type, aggregate_id);
    return {
      event_id: `${aggregate_type}/${aggregate_id}#v${version}`,
      event_type,
      aggregate_type,
      aggregate_id,
      occurred_at,
      version,
      summary,
      payload,
    };
  }

  /** 构造并追加一条事件。 */
  record(input) {
    return this.append(this.prepare(input));
  }

  all() {
    return [...this.#events];
  }

  ofType(eventType) {
    return this.#events.filter((event) => event.event_type === eventType);
  }

  ofAggregate(aggregateType, aggregateId) {
    return [...(this.#streams.get(EventStore.keyOf(aggregateType, aggregateId)) ?? [])];
  }
}
