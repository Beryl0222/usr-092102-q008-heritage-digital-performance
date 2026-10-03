import assert from "node:assert/strict";
import test from "node:test";

import { computeTakedown, issueTakedowns, recheckRelease, reviewRelease } from "../src/compliance.js";
import { asset, channel, classify, domain, grant, makeStore, withdraw } from "./fixtures.js";

const AT = "2026-06-01T00:00:00+08:00";

function storeWithTwoReleases() {
  const store = makeStore();
  classify(store, "el-face", { name: "肖像", kind: "participant_portrait" });
  classify(store, "el-pub", { name: "公开知识", kind: "public_knowledge" });
  grant(store, "p-face", { source: "participant", applies_to: { element_ids: ["el-face"] }, rights: ["display"], territory: ["CN"] });
  grant(store, "p-pub", { source: "inheritor", applies_to: { element_ids: ["el-pub"] }, rights: ["display", "teaching"] });
  channel(store, "ch-video", { name: "视频平台", rights_offered: ["display"], territory: null });
  channel(store, "ch-study", { name: "研学平台", rights_offered: ["teaching"], territory: ["CN"] });
  asset(store, "asset-face", { inputs: [{ kind: "element", id: "el-face" }], tool: { name: "t", version: "1" } });
  asset(store, "asset-pub", { inputs: [{ kind: "element", id: "el-pub" }], tool: { name: "t", version: "1" } });
  for (const [id, assetId, channelId, rights] of [
    ["rel-face", "asset-face", "ch-video", ["display"]],
    ["rel-pub", "asset-pub", "ch-study", ["teaching"]],
  ]) {
    store.record({
      event_type: "RELEASE_REVIEWED",
      aggregate_type: "distribution_release",
      aggregate_id: id,
      occurred_at: AT,
      summary: `审核 ${id}`,
      payload: { asset_id: assetId, channel_id: channelId, rights_used: rights, territory: ["CN"], at: AT, decision: "approved", findings: [] },
    });
  }
  return store;
}

test("发布审核：未授权的权利被驳回并给出依据", () => {
  const store = storeWithTwoReleases();
  const result = reviewRelease(domain(store), {
    release_id: "rel-new",
    asset_id: "asset-pub",
    channel_id: "ch-video",
    rights_used: ["sales"],
    territory: ["CN"],
    at: AT,
  });
  assert.equal(result.decision, "rejected");
  assert.match(result.findings.join("\n"), /未授予销售权/);
});

test("发布审核：渠道不支持的权利或地域被驳回", () => {
  const store = storeWithTwoReleases();
  const wrongRight = reviewRelease(domain(store), {
    release_id: "rel-new",
    asset_id: "asset-pub",
    channel_id: "ch-study",
    rights_used: ["display"],
    territory: ["CN"],
    at: AT,
  });
  assert.equal(wrongRight.decision, "rejected");
  assert.match(wrongRight.findings.join("\n"), /渠道「研学平台」不支持展示权/);

  const wrongTerritory = reviewRelease(domain(store), {
    release_id: "rel-new",
    asset_id: "asset-face",
    channel_id: "ch-video",
    rights_used: ["display"],
    territory: ["overseas"],
    at: AT,
  });
  assert.equal(wrongTerritory.decision, "rejected");
});

test("授权撤回：下架清单只包含真正受影响的版本", () => {
  const store = storeWithTwoReleases();
  withdraw(store, "p-face", { effective_at: "2026-07-01T00:00:00+08:00", reason: "本人撤回" }, "2026-07-01T00:00:00+08:00");

  const takedown = computeTakedown(domain(store), "p-face");
  assert.deepEqual(takedown.map((t) => t.release_id), ["rel-face"], "只有含肖像的发布需要下架");
  assert.deepEqual(takedown[0].rights, ["display"]);

  const events = issueTakedowns(store, "p-face", { occurred_at: "2026-07-02T00:00:00+08:00" });
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "TAKEDOWN_ISSUED");
  assert.equal(events[0].aggregate_id, "rel-face");
  assert.equal(events[0].version, 2, "下架事件接续发布聚合的版本流");
});

test("授权撤回：停止未来使用，历史审核结论不被改写", () => {
  const store = storeWithTwoReleases();
  withdraw(store, "p-face", { effective_at: "2026-07-01T00:00:00+08:00" }, "2026-07-01T00:00:00+08:00");

  const future = reviewRelease(domain(store), {
    release_id: "rel-face-2",
    asset_id: "asset-face",
    channel_id: "ch-video",
    rights_used: ["display"],
    territory: ["CN"],
    at: "2026-07-02T00:00:00+08:00",
  });
  assert.equal(future.decision, "rejected", "撤回后同类发布不再通过");

  const recheck = recheckRelease(domain(store), "rel-face", "2026-07-02T00:00:00+08:00");
  assert.equal(recheck.reviewed_as, "approved", "历史审核结论保持原样");
  assert.equal(recheck.now, "rejected", "但按当前状态复核已不再合法");
});

test("未撤回的授权不能生成下架清单", () => {
  const store = storeWithTwoReleases();
  assert.throws(() => computeTakedown(domain(store), "p-face"), /尚未撤回/);
});
