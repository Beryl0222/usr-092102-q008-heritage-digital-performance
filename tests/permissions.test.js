import assert from "node:assert/strict";
import test from "node:test";

import { reviewRelease } from "../src/compliance.js";
import { effectiveRights, intersectRights } from "../src/permissions.js";
import { asset, channel, classify, domain, grant, linkToProject, makeStore, prohibit, withdraw } from "./fixtures.js";

const AT = "2026-06-01T00:00:00+08:00";

test("授权生效、撤回失效、未来授权尚未生效", () => {
  const store = makeStore();
  classify(store, "el-a", { name: "素材A", kind: "public_knowledge" });
  grant(store, "p1", { source: "inheritor", applies_to: { element_ids: ["el-a"] }, rights: ["display"] }, "2026-03-01T00:00:00+08:00");

  let eff = effectiveRights(domain(store), "el-a", { at: "2026-02-01T00:00:00+08:00" });
  assert.equal(eff.granted.has("display"), false, "授权登记前不应生效");

  eff = effectiveRights(domain(store), "el-a", { at: AT });
  assert.equal(eff.granted.has("display"), true);

  withdraw(store, "p1", { effective_at: "2026-07-01T00:00:00+08:00" }, "2026-06-15T00:00:00+08:00");
  eff = effectiveRights(domain(store), "el-a", { at: AT });
  assert.equal(eff.granted.has("display"), true, "撤回生效日前仍有效");
  eff = effectiveRights(domain(store), "el-a", { at: "2026-08-01T00:00:00+08:00" });
  assert.equal(eff.granted.has("display"), false, "撤回生效日后停止未来使用");
});

test("地域与期限是授权的约束维度", () => {
  const store = makeStore();
  classify(store, "el-a", { name: "素材A", kind: "public_knowledge" });
  grant(store, "p1", {
    source: "inheritor",
    applies_to: { element_ids: ["el-a"] },
    rights: ["display"],
    territory: ["CN"],
    term: { start: "2026-01-01", end: "2026-12-31" },
  });

  assert.equal(effectiveRights(domain(store), "el-a", { at: AT, territory: "CN" }).granted.has("display"), true);
  assert.equal(effectiveRights(domain(store), "el-a", { at: AT, territory: "overseas" }).granted.has("display"), false);
  assert.equal(effectiveRights(domain(store), "el-a", { at: "2027-06-01T00:00:00+08:00" }).granted.has("display"), false);
});

test("参与者肖像只认本人声明，企业合同主张不生效", () => {
  const store = makeStore();
  classify(store, "proj", { name: "项目", kind: "craft_project" });
  classify(store, "face", { name: "学徒形象", kind: "participant_portrait" });
  linkToProject(store, "face", "proj");
  grant(store, "ent", { source: "enterprise_contract", applies_to: { project_id: "proj" }, rights: ["display", "adaptation"] });

  let eff = effectiveRights(domain(store), "face", { at: AT });
  assert.equal(eff.granted.has("display"), false, "企业合同不能替本人授权");

  grant(store, "self", { source: "participant", applies_to: { element_ids: ["face"] }, rights: ["display"] });
  eff = effectiveRights(domain(store), "face", { at: AT });
  assert.equal(eff.granted.has("display"), true);
  assert.equal(eff.granted.has("adaptation"), false, "本人未授的权利仍不可用");
});

test("线下体验者作品默认不进入训练库，元素级明示授权可解除", () => {
  const store = makeStore();
  classify(store, "proj", { name: "项目", kind: "craft_project" });
  classify(store, "work", { name: "游客习作", kind: "experience_work", origin: "offline_experience" });
  linkToProject(store, "work", "proj");
  grant(store, "ent", { source: "enterprise_contract", applies_to: { project_id: "proj" }, rights: ["model_training"] });

  let eff = effectiveRights(domain(store), "work", { at: AT });
  assert.equal(eff.prohibited.has("model_training"), true, "项目级笼统主张不构成明示授权");
  assert.match(eff.blocks.model_training.join(" "), /默认不进入训练库/);

  grant(store, "opt-in", { source: "participant", applies_to: { element_ids: ["work"] }, rights: ["model_training"] });
  eff = effectiveRights(domain(store), "work", { at: AT });
  assert.equal(eff.granted.has("model_training"), true, "针对该元素的明示授权可以解除默认");
});

test("授权与禁用相抵触时权利暂不可用，合议裁定后按裁定执行", () => {
  const store = makeStore();
  classify(store, "el-a", { name: "素材A", kind: "story_material" });
  grant(store, "ent", { source: "enterprise_contract", applies_to: { element_ids: ["el-a"] }, rights: ["adaptation"] }, "2026-03-01T00:00:00+08:00");
  prohibit(store, "ban", { source: "community_covenant", applies_to: { element_ids: ["el-a"] }, rights: ["adaptation"] }, "2026-04-01T00:00:00+08:00");

  let eff = effectiveRights(domain(store), "el-a", { at: AT });
  assert.equal(eff.contested.has("adaptation"), true, "抵触未决期间不可用");
  assert.equal(eff.granted.has("adaptation"), false);

  store.record({
    event_type: "COLLEGIAL_CASE_OPENED",
    aggregate_type: "collegial_case",
    aggregate_id: "case-x",
    occurred_at: "2026-04-10T00:00:00+08:00",
    summary: "立案",
    payload: { element_ids: ["el-a"], rights: ["adaptation"] },
  });
  store.record({
    event_type: "COLLEGIAL_DECISION_RECORDED",
    aggregate_type: "collegial_case",
    aggregate_id: "case-x",
    occurred_at: "2026-05-01T00:00:00+08:00",
    summary: "裁定",
    payload: { votes: [], outcomes: { adaptation: "prohibited" } },
  });

  eff = effectiveRights(domain(store), "el-a", { at: AT });
  assert.equal(eff.prohibited.has("adaptation"), true);
  assert.equal(eff.contested.has("adaptation"), false);
});

test("组合素材只能采用许可交集（权利、地域、期限）", () => {
  const store = makeStore();
  classify(store, "el-a", { name: "素材A", kind: "public_knowledge" });
  classify(store, "el-b", { name: "素材B", kind: "traditional_pattern" });
  grant(store, "pa", {
    source: "inheritor",
    applies_to: { element_ids: ["el-a"] },
    rights: ["display", "sales"],
    territory: ["CN", "overseas"],
    term: { start: "2026-01-01", end: "2027-12-31" },
  });
  grant(store, "pb", {
    source: "inheritor",
    applies_to: { element_ids: ["el-b"] },
    rights: ["display"],
    territory: ["CN"],
    term: { start: "2026-06-01", end: "2028-12-31" },
  });

  const inter = intersectRights(domain(store), ["el-a", "el-b"], { at: "2026-07-01T00:00:00+08:00" });
  assert.deepEqual(inter.rights, ["display"], "销售权不在交集中");
  assert.deepEqual(inter.territory, ["CN"], "地域取交集");
  assert.equal(inter.term.start, "2026-06-01");
  assert.equal(inter.term.end, "2027-12-31");
});

test("发布审核视角：训练库发布因默认规则被驳回", () => {
  const store = makeStore();
  classify(store, "work", { name: "游客习作", kind: "experience_work", origin: "offline_experience" });
  asset(store, "asset-train", { inputs: [{ kind: "element", id: "work" }], tool: { name: "t", version: "1" } });
  channel(store, "ch-train", { name: "训练渠道", rights_offered: ["model_training"], territory: null });

  const result = reviewRelease(domain(store), {
    release_id: "rel-x",
    asset_id: "asset-train",
    channel_id: "ch-train",
    rights_used: ["model_training"],
    territory: ["CN"],
    at: AT,
  });
  assert.equal(result.decision, "rejected");
  assert.match(result.findings.join("\n"), /默认不进入训练库/);
});
