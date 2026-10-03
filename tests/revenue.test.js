import assert from "node:assert/strict";
import test from "node:test";

import { openCollegialCase } from "../src/collegial.js";
import { auditRevenue, recordRevenue } from "../src/revenue.js";
import { asset, channel, classify, domain, grant, linkToProject, makeStore, prohibit } from "./fixtures.js";

const AT = "2026-06-01T00:00:00+08:00";

function baseStore() {
  const store = makeStore();
  store.record({
    event_type: "COMMUNITY_REGISTERED",
    aggregate_type: "source_community",
    aggregate_id: "comm-1",
    occurred_at: AT,
    summary: "登记共同体",
    payload: { name: "某技艺共同体" },
  });
  classify(store, "proj", { name: "某技艺", kind: "craft_project", creators: [{ name: "王师傅", role: "代表性传承人" }] });
  store.record({
    event_type: "ELEMENT_LINKED",
    aggregate_type: "heritage_element",
    aggregate_id: "proj",
    occurred_at: AT,
    summary: "项目归属共同体",
    payload: { link_type: "maintained_by_community", target_type: "source_community", target_id: "comm-1" },
  });
  classify(store, "el-a", { name: "纹样", kind: "traditional_pattern", creators: [{ name: "某技艺共同体", role: "共同体维护" }] });
  linkToProject(store, "el-a", "proj");
  grant(store, "p1", {
    source: "inheritor",
    applies_to: { element_ids: ["el-a"] },
    rights: ["sales"],
    revenue_shares: [
      { beneficiary: "王师傅", role: "代表性传承人", percent: 50 },
      { beneficiary: "某技艺共同体", role: "来源共同体", percent: 50 },
    ],
  });
  channel(store, "ch-shop", { name: "商店", rights_offered: ["sales"], territory: ["CN"] });
  asset(store, "asset-1", { inputs: [{ kind: "element", id: "el-a" }], tool: { name: "t", version: "1" } });
  store.record({
    event_type: "RELEASE_REVIEWED",
    aggregate_type: "distribution_release",
    aggregate_id: "rel-1",
    occurred_at: AT,
    summary: "审核 rel-1",
    payload: { asset_id: "asset-1", channel_id: "ch-shop", rights_used: ["sales"], territory: ["CN"], at: AT, decision: "approved", findings: [] },
  });
  return store;
}

test("从一笔收入核对许可、署名、分配和处置", () => {
  const store = baseStore();
  recordRevenue(store, { revenue_id: "rev-1", release_id: "rel-1", amount: 10000, occurred_at: "2026-06-02T00:00:00+08:00" });

  const audit = auditRevenue(domain(store), "rev-1");
  assert.equal(audit.revenue.amount, 10000);
  assert.equal(audit.release.id, "rel-1");

  const license = audit.licenses.find((l) => l.element_id === "el-a");
  assert.deepEqual(license.statements.map((s) => s.id), ["p1"], "许可依据可核对");

  const names = audit.attributions.map((a) => a.name);
  assert.ok(names.includes("王师傅"), "署名包含传承人");
  assert.ok(names.includes("某技艺共同体"), "署名包含来源共同体");

  assert.deepEqual(
    audit.allocation.map((a) => [a.beneficiary, a.amount]),
    [
      ["王师傅", 5000],
      ["某技艺共同体", 5000],
    ],
    "分配金额按比例计算",
  );
  assert.equal(audit.disposal, "distributable");
});

test("涉及元素存在未决合议时收入暂缓分配", () => {
  const store = baseStore();
  grant(store, "ent", { source: "enterprise_contract", applies_to: { element_ids: ["el-a"] }, rights: ["sales"] }, "2026-05-01T00:00:00+08:00");
  prohibit(store, "ban", { source: "community_covenant", applies_to: { element_ids: ["el-a"] }, rights: ["sales"] }, "2026-05-02T00:00:00+08:00");
  openCollegialCase(store, { case_id: "case-hold", element_ids: ["el-a"], rights: ["sales"], occurred_at: "2026-05-03T00:00:00+08:00" });
  recordRevenue(store, { revenue_id: "rev-2", release_id: "rel-1", amount: 100, occurred_at: "2026-06-02T00:00:00+08:00" });

  const audit = auditRevenue(domain(store), "rev-2");
  assert.equal(audit.disposal, "held_pending_collegial");
  assert.deepEqual(audit.open_cases, ["case-hold"]);
});

test("未登记分配方案时标记为未分配", () => {
  const store = baseStore();
  // 覆盖掉分配方案：重新建一个不含 revenue_shares 的授权
  const store2 = makeStore();
  classify(store2, "el-b", { name: "公开知识", kind: "public_knowledge" });
  grant(store2, "pb", { source: "inheritor", applies_to: { element_ids: ["el-b"] }, rights: ["display"] });
  channel(store2, "ch-v", { name: "视频平台", rights_offered: ["display"], territory: null });
  asset(store2, "asset-b", { inputs: [{ kind: "element", id: "el-b" }], tool: { name: "t", version: "1" } });
  store2.record({
    event_type: "RELEASE_REVIEWED",
    aggregate_type: "distribution_release",
    aggregate_id: "rel-b",
    occurred_at: AT,
    summary: "审核 rel-b",
    payload: { asset_id: "asset-b", channel_id: "ch-v", rights_used: ["display"], territory: ["CN"], at: AT, decision: "approved", findings: [] },
  });
  recordRevenue(store2, { revenue_id: "rev-b", release_id: "rel-b", amount: 100, occurred_at: AT });

  const audit = auditRevenue(domain(store2), "rev-b");
  assert.equal(audit.disposal, "unallocated");
  assert.deepEqual(audit.allocation, []);
});
