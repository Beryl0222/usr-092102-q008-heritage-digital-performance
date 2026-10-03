import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { computeTakedown, recheckRelease, reviewRelease } from "../src/compliance.js";
import { buildDomain } from "../src/domain.js";
import { effectiveRights } from "../src/permissions.js";
import { publicProvenance, segmentAttribution } from "../src/provenance.js";
import { renderProvenancePage } from "../src/publicPage.js";
import { auditRevenue } from "../src/revenue.js";
import { EventStore } from "../src/store.js";
import { validateEvent } from "../src/validator.js";

const events = JSON.parse(await readFile(new URL("../data/scenario.json", import.meta.url), "utf8"));
const store = new EventStore(events);
const domain = buildDomain(store);

test("场景事件全部符合领域契约且版本连续", () => {
  assert.equal(events.length, 47);
  for (const event of events) assert.deepEqual(validateEvent(event), [], event.event_id);
  // 构造函数内已完成版本连续性校验，能建出 store 即通过
  assert.equal(store.all().length, 47);
});

test("历史发布审核结论可按当时状态复现", () => {
  for (const event of store.ofType("RELEASE_REVIEWED")) {
    const p = event.payload;
    const result = reviewRelease(domain, { ...p, at: p.at });
    assert.equal(result.decision, p.decision, `${event.aggregate_id} 的审核结论应可复现`);
  }
});

test("预告 v1 在禁用与合议裁定后复核不再合法", () => {
  const recheck = recheckRelease(domain, "rel-trailer-v1", "2026-10-02T00:00:00+08:00");
  assert.equal(recheck.reviewed_as, "approved");
  assert.equal(recheck.now, "rejected");
  assert.match(recheck.findings.join("\n"), /禁用/);
});

test("撤回肖像授权后，新的同类发布被阻止（停止未来使用）", () => {
  const result = reviewRelease(domain, {
    release_id: "rel-highlights-2",
    asset_id: "asset-highlights",
    channel_id: "ch-drama",
    rights_used: ["display"],
    territory: ["CN"],
    at: "2026-10-02T00:00:00+08:00",
  });
  assert.equal(result.decision, "rejected");
});

test("下架清单精确：只含花絮与预告 v1，不牵连研学、海外、工坊与预告 v2", () => {
  const takedown = computeTakedown(domain, "perm-participant");
  assert.deepEqual(
    takedown.map((t) => t.release_id).sort(),
    ["rel-highlights", "rel-trailer-v1"],
  );
  const trailer = takedown.find((t) => t.release_id === "rel-trailer-v1");
  assert.deepEqual(trailer.elements, ["el-portrait"], "衍生链追溯到肖像元素");
});

test("这一秒画面依据什么：分段来源可定位到元素", () => {
  const at8 = segmentAttribution(domain, "asset-trailer-v1", 8);
  assert.deepEqual(at8.elements.map((e) => e.id), ["el-step"]);
  assert.match(at8.elements[0].name, /受限步骤，细节不公开/);

  const at20 = segmentAttribution(domain, "asset-trailer-v1", 20);
  assert.deepEqual(at20.elements.map((e) => e.id), ["el-portrait"], "AI角色段落追溯到学徒形象");
});

test("线下体验者作品默认不进入训练库", () => {
  const eff = effectiveRights(domain, "el-visitor", { at: "2026-10-02T00:00:00+08:00" });
  assert.equal(eff.prohibited.has("model_training"), true);
  assert.match(eff.blocks.model_training.join(" "), /默认不进入训练库/);
});

test("从一笔收入核对许可、署名、分配和处置", () => {
  const audit = auditRevenue(domain, "rev-001");
  assert.equal(audit.release.id, "rel-kit");
  assert.equal(audit.disposal, "distributable");

  const patternLicense = audit.licenses.find((l) => l.element_id === "el-pattern");
  assert.ok(patternLicense.statements.some((s) => s.id === "perm-inheritor-core"));

  const names = audit.attributions.map((a) => a.name);
  assert.ok(names.includes("张景泰"));
  assert.ok(names.includes("景泰蓝制作技艺共同体"));

  assert.deepEqual(
    audit.allocation.map((a) => [a.beneficiary, a.percent, a.amount]),
    [
      ["张景泰", 40, 4800],
      ["景泰蓝制作技艺共同体", 30, 3600],
      ["焕新影业", 30, 3600],
    ],
  );

  const study = auditRevenue(domain, "rev-002");
  assert.deepEqual(
    study.allocation.map((a) => a.amount),
    [3200, 2400, 2400],
  );
});

test("公开页呈现技艺与创作者来源，且不泄露受限步骤细节", () => {
  const view = publicProvenance(domain, "rel-trailer-v2");
  assert.equal(view.craft.project, "景泰蓝制作技艺");
  assert.equal(view.craft.community, "景泰蓝制作技艺共同体");
  assert.ok(view.attributions.some((a) => a.name === "张景泰"));

  const html = renderProvenancePage(view);
  assert.match(html, /景泰蓝制作技艺/);
  assert.match(html, /张景泰/);
  assert.match(html, /焕新GenVideo 2\.3\.1/);
  assert.match(html, /收益归属/);

  const v1Html = renderProvenancePage(publicProvenance(domain, "rel-trailer-v1"));
  assert.match(v1Html, /受限步骤，细节不公开/);
  assert.ok(!v1Html.includes("三火九转"), "受限步骤的口诀内容不得出现在公开页");
  assert.ok(!v1Html.includes("口诀全文"), "受限步骤的私密字段不得出现在公开页");
});
