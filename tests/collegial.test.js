import assert from "node:assert/strict";
import test from "node:test";

import { openCollegialCase, recordCollegialDecision } from "../src/collegial.js";
import { detectConflicts, effectiveRights } from "../src/permissions.js";
import { classify, domain, grant, makeStore, prohibit } from "./fixtures.js";

const AT = "2026-06-01T00:00:00+08:00";

function storeWithGrantVsBan() {
  const store = makeStore();
  classify(store, "el-a", { name: "受限步骤", kind: "restricted_step" });
  grant(store, "ent", { source: "enterprise_contract", applies_to: { element_ids: ["el-a"] }, rights: ["model_training"] }, "2026-03-01T00:00:00+08:00");
  prohibit(store, "ban", { source: "community_covenant", applies_to: { element_ids: ["el-a"] }, rights: ["model_training"] }, "2026-04-01T00:00:00+08:00");
  return store;
}

test("抵触检测：授权与禁用同时有效即构成抵触", () => {
  const store = storeWithGrantVsBan();
  const conflicts = detectConflicts(domain(store), AT);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "grant_vs_prohibit");
  assert.deepEqual(conflicts[0].grants, ["ent"]);
  assert.deepEqual(conflicts[0].prohibitions, ["ban"]);
});

test("不同来源给出不同收益分配方案也构成抵触", () => {
  const store = makeStore();
  classify(store, "el-a", { name: "纹样", kind: "traditional_pattern" });
  grant(store, "inh", {
    source: "inheritor",
    applies_to: { element_ids: ["el-a"] },
    rights: ["sales"],
    revenue_shares: [{ beneficiary: "传承人", role: "inheritor", percent: 60 }],
  });
  grant(store, "ent", {
    source: "enterprise_contract",
    applies_to: { element_ids: ["el-a"] },
    rights: ["sales"],
    revenue_shares: [{ beneficiary: "企业", role: "enterprise", percent: 70 }],
  });
  const conflicts = detectConflicts(domain(store), AT);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "grant_vs_grant");
});

test("不存在抵触时不能立案", () => {
  const store = makeStore();
  classify(store, "el-a", { name: "公开知识", kind: "public_knowledge" });
  grant(store, "inh", { source: "inheritor", applies_to: { element_ids: ["el-a"] }, rights: ["display"] });
  assert.throws(
    () =>
      openCollegialCase(store, {
        case_id: "case-x",
        element_ids: ["el-a"],
        rights: ["display"],
        occurred_at: AT,
      }),
    /不存在抵触/,
  );
});

test("明确禁用不得被多数票越过", () => {
  const store = storeWithGrantVsBan();
  openCollegialCase(store, { case_id: "case-1", element_ids: ["el-a"], rights: ["model_training"], occurred_at: "2026-04-10T00:00:00+08:00" });
  assert.throws(
    () =>
      recordCollegialDecision(store, {
        case_id: "case-1",
        votes: [
          { party: "inheritor", stance: "grant" },
          { party: "community_covenant", stance: "grant" },
          { party: "enterprise_contract", stance: "grant" },
        ],
        outcomes: { model_training: "granted" },
        occurred_at: "2026-05-01T00:00:00+08:00",
      }),
    /多数票不得越过/,
    "三票全赞成也不能越过明确禁用",
  );

  const event = recordCollegialDecision(store, {
    case_id: "case-1",
    votes: [
      { party: "inheritor", stance: "prohibit" },
      { party: "community_covenant", stance: "prohibit" },
      { party: "enterprise_contract", stance: "grant" },
    ],
    outcomes: { model_training: "prohibited" },
    rationale: "存在明确禁用",
    occurred_at: "2026-05-01T00:00:00+08:00",
  });
  assert.equal(event.event_type, "COLLEGIAL_DECISION_RECORDED");

  const eff = effectiveRights(domain(store), "el-a", { at: AT });
  assert.equal(eff.prohibited.has("model_training"), true);
});

test("无明确禁用时按多数票裁定，平票从严", () => {
  const store = makeStore();
  classify(store, "el-a", { name: "纹样", kind: "traditional_pattern" });
  grant(store, "inh", {
    source: "inheritor",
    applies_to: { element_ids: ["el-a"] },
    rights: ["sales"],
    revenue_shares: [{ beneficiary: "传承人", role: "inheritor", percent: 60 }],
  });
  grant(store, "ent", {
    source: "enterprise_contract",
    applies_to: { element_ids: ["el-a"] },
    rights: ["sales"],
    revenue_shares: [{ beneficiary: "企业", role: "enterprise", percent: 70 }],
  });
  openCollegialCase(store, { case_id: "case-2", element_ids: ["el-a"], rights: ["sales"], occurred_at: AT });

  assert.throws(
    () =>
      recordCollegialDecision(store, {
        case_id: "case-2",
        votes: [
          { party: "inheritor", stance: "grant" },
          { party: "enterprise_contract", stance: "prohibit" },
        ],
        outcomes: { sales: "granted" },
        occurred_at: "2026-06-02T00:00:00+08:00",
      }),
    /未获多数支持/,
    "平票不能裁定授予",
  );

  recordCollegialDecision(store, {
    case_id: "case-2",
    votes: [
      { party: "inheritor", stance: "grant" },
      { party: "community_covenant", stance: "grant" },
      { party: "enterprise_contract", stance: "prohibit" },
    ],
    outcomes: { sales: "granted" },
    rationale: "无明确禁用，多数支持授予",
    occurred_at: "2026-06-02T00:00:00+08:00",
  });
  const eff = effectiveRights(domain(store), "el-a", { at: "2026-06-03T00:00:00+08:00" });
  assert.equal(eff.granted.has("sales"), true);
});

test("裁定不能重复记录", () => {
  const store = storeWithGrantVsBan();
  openCollegialCase(store, { case_id: "case-3", element_ids: ["el-a"], rights: ["model_training"], occurred_at: "2026-04-10T00:00:00+08:00" });
  const decision = {
    case_id: "case-3",
    votes: [{ party: "inheritor", stance: "prohibit" }],
    outcomes: { model_training: "prohibited" },
    occurred_at: "2026-05-01T00:00:00+08:00",
  };
  recordCollegialDecision(store, decision);
  assert.throws(() => recordCollegialDecision(store, decision), /已有裁定/);
});
