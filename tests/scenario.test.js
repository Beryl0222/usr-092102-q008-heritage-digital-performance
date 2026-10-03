import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EventStore } from "../src/store.js";
import { LicensingService } from "../src/service.js";
import { buildBaseline, IDS } from "../src/scenario.js";

const CLOCK = "2026-10-03T09:00:00+08:00";
const id = IDS;

function newService() {
  const store = new EventStore({ now: () => CLOCK });
  const service = new LicensingService(store, { now: () => CLOCK });
  buildBaseline(service);
  return { service, store };
}

test("基线：三个已获许可渠道的发布均通过，事件类型全部落在契约枚举内", async () => {
  const { store } = newService();
  const schema = JSON.parse(await readFile(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"));
  for (const e of store.events()) {
    assert.ok(schema.properties.event_type.enum.includes(e.event_type), `未知事件 ${e.event_type}`);
    assert.ok(schema.properties.aggregate_type.enum.includes(e.aggregate_type));
    assert.ok(e.version >= 1);
  }
  const state = new LicensingService(store).state;
  assert.equal(state.releases.get(id.releases.study).decision, "approved");
  assert.equal(state.releases.get(id.releases.overseas).decision, "approved");
  assert.equal(state.releases.get(id.releases.shop).decision, "approved");
});

test("逐秒核对：第15秒依据缠枝莲纹，能回答权利范围与收益归属", () => {
  const { service } = newService();
  const lookup = service.frameLookup(id.releases.study, 15);
  const pattern = lookup.materials.find((m) => m.material_id === id.materials.pattern);
  assert.ok(pattern, "该秒画面应能定位到纹样素材");
  assert.equal(pattern.rights.teaching.status, "allowed");
  assert.equal(pattern.rights.training.status, "no_grant");
  // 研学渠道没有销售权（许可按渠道限定）
  assert.equal(pattern.rights.sale.status, "no_grant");
  // 改编权来自传承人全球许可，收益份额 8%
  assert.equal(pattern.rights.adaptation.status, "allowed");
  const dramaPerm = pattern.rights.adaptation.permissions.find((p) => p.permission_id === id.permissions.holderDrama);
  assert.equal(dramaPerm.revenue_share_bps, 800);
});

test("受限步骤不能被还原成教程：缺教学权即整组拒绝", () => {
  const { service } = newService();
  assert.throws(
    () =>
      service.generateAsset({
        asset_id: id.assets.tutorial,
        version_id: "ver:tutorial-v1",
        batch_id: id.batches.main,
        title: "点蓝烧蓝逐步教程",
        intended_rights: ["display", "teaching"],
        intended_region: "CN",
        manifest: [
          { material_id: id.materials.overview, role: "reference_text" },
          { material_id: id.materials.firingStep, role: "step_footage" },
        ],
      }),
    /许可交集/
  );
  // 海外展示同样不成立：受限步骤许可仅限国内研学渠道
  const plan = service.evaluateVersionPlan({
    manifest: [{ material_id: id.materials.firingStep }],
    intended_rights: ["display"],
    intended_region: "FR",
  });
  assert.equal(plan.status, "denied");
});

test("学徒肖像生成新角色被明确禁用，合议全体一致也不能越过", () => {
  const { service } = newService();
  assert.throws(
    () =>
      service.generateAsset({
        asset_id: id.assets.characterLi,
        version_id: "ver:char-v1",
        batch_id: id.batches.main,
        title: "以学徒形象生成的角色",
        intended_rights: ["display", "adaptation"],
        intended_region: "*",
        manifest: [{ material_id: id.materials.portraitLi, role: "likeness" }],
      }),
    /明确禁用/
  );

  service.openConsentCase({
    case_id: "case:li-portrait",
    material_ids: [id.materials.portraitLi],
    related_permission_ids: [id.permissions.liDeny, id.permissions.mediaDrama],
    issue: "企业主张合同包含肖像，学徒本人反对",
  });
  // 即使多数票（此处为全体一致）要求放开，服务也拒绝出具和解规则
  assert.throws(
    () =>
      service.issueConsentRule({
        case_id: "case:li-portrait",
        decision: "reconciled",
        rule: { rights: ["display", "adaptation"], regions: ["*"] },
        votes: { for: 7, against: 0, abstain: 0 },
      }),
    /明确禁用/
  );
  service.issueConsentRule({
    case_id: "case:li-portrait",
    decision: "prohibition_upheld",
    rule: { rights: ["adaptation", "training"], regions: ["*"] },
    votes: { for: 7, against: 0, abstain: 0 },
  });
  const state = service.state;
  const evalAfter = state;
  assert.equal(evalAfter.consentCases.get("case:li-portrait").decision, "prohibition_upheld");
  assert.throws(
    () =>
      service.generateAsset({
        asset_id: id.assets.characterLi,
        version_id: "ver:char-v2",
        batch_id: id.batches.main,
        title: "再试一次",
        intended_rights: ["adaptation"],
        intended_region: "CN",
        manifest: [{ material_id: id.materials.portraitLi, role: "likeness" }],
      }),
    /明确禁用|维持禁用/
  );
});

test("训练准入：线下作品与未授权素材默认不入库，opt-in 与 training 授权取交集", () => {
  const { service } = newService();
  // 登记时试图直接让线下作品入库，须本人显式确认
  assert.throws(
    () =>
      service.registerMaterial({
        material_id: "mat:visitor-work-2",
        kind: "offline_work",
        element_id: id.element,
        title: "另一体验者作品",
        training_opted_in: true,
      }),
    /显式确认/
  );
  // 体验者本人后来选择加入，但没有任何 training 授权：仍排除
  service.setTrainingChoice(id.materials.visitorWork, true, { by: id.visitor });
  // 纹样：本人（传承人）opt-in 且补授 training 权后才准入
  service.setTrainingChoice(id.materials.pattern, true, { by: id.holder });
  service.grantPermission({
    permission_id: id.permissions.holderTrainPattern,
    grantor_id: id.holder,
    grantor_name: "张大师",
    grantor_type: "holder",
    material_ids: [id.materials.pattern],
    rights: ["training"],
    regions: ["CN"],
    valid_from: "2026-09-01T00:00:00+08:00",
  });
  const result = service.recordBatch({
    batch_id: "batch:training-admit",
    tool_name: "云锦生成器",
    tool_version: "3.3.0",
    model_version: "modelx-2026-10",
    training_corpus_ids: [
      id.materials.visitorWork,
      id.materials.portraitLi,
      id.materials.pattern,
      "mat:not-exist",
    ],
  });
  assert.deepEqual(result.admitted, [id.materials.pattern]);
  const reasons = Object.fromEntries(result.excluded.map((x) => [x.material_id, x.reason]));
  assert.match(reasons[id.materials.visitorWork], /training 授权/);
  assert.match(reasons[id.materials.portraitLi], /同意|禁用/);
  assert.match(reasons["mat:not-exist"], /未登记/);
  // 事件事实中训练库只包含准入素材
  assert.deepEqual([...service.state.batches.get("batch:training-admit").training_corpus_ids], [
    id.materials.pattern,
  ]);
});

test("收入：一笔研学收入可核对许可、署名与分配（传承人15%）", () => {
  const { service } = newService();
  service.recordRevenue({ revenue_id: "rev:study-001", release_id: id.releases.study, amount: 100000, currency: "CNY" });
  const allocation = service.allocateRevenue("rev:study-001");
  const holder = allocation.allocations.find((a) => a.payee_id === id.holder);
  assert.equal(holder.amount, 15000); // 15% × 1000元
  assert.equal(allocation.operator_residual.amount, 85000);

  const ledger = service.revenueLedger("rev:study-001");
  const patternProof = ledger.proof.find((p) => p.material_id === id.materials.pattern);
  assert.ok(patternProof.release_permission_ids.includes(id.permissions.holderPatternCn));
  // 生成时冻结的是与渠道无关的全球改编许可
  assert.ok(patternProof.frozen_permission_ids.includes(id.permissions.holderDrama));
  const names = ledger.attribution.map((a) => a.party);
  assert.ok(names.includes("张大师"));
  assert.ok(names.includes("景泰蓝坊传承共同体"));
});

test("撤回许可：精确下架失去授权交集的研学发布，不牵连海外、商城与无关作品", () => {
  const { service } = newService();

  // 先撤改编上游许可：三个发布各自仍有独立授权，无一下架；只停止未来改编用途
  const dramaTakedown = service.withdrawPermission(id.permissions.holderDrama, {
    reason: "改编合作终止",
  });
  assert.deepEqual(dramaTakedown.items, []);
  assert.ok(
    dramaTakedown.blocked_future_versions.some(
      (v) => v.asset_id === id.assets.trailer && v.version_id === "ver:trailer-v1"
    )
  );
  assert.ok(
    !dramaTakedown.blocked_future_versions.some((v) => v.asset_id === id.assets.greeting)
  );

  // 再撤研学许可：仅研学发布失去教学权交集
  const studyTakedown = service.withdrawPermission(id.permissions.holderPatternCn, {
    reason: "传承人与机构合作终止",
  });
  assert.equal(studyTakedown.items.length, 1);
  assert.equal(studyTakedown.items[0].release_id, id.releases.study);
  assert.ok(!studyTakedown.items.some((i) => i.release_id === id.releases.overseas));
  assert.ok(!studyTakedown.items.some((i) => i.release_id === id.releases.shop));

  const done = service.executeTakedown(studyTakedown.takedown_id);
  assert.equal(done.length, 1);
  assert.equal(service.state.releases.get(id.releases.study).taken_down, true);
  // 同一版本在海外、商城仍合法：版本不整体下架，仅该发布下架（不牵连已获许可渠道）
  const version = service.state.assets.get(id.assets.trailer).versions.get("ver:trailer-v1");
  assert.deepEqual([...version.takedown_release_ids], [id.releases.study]);
  assert.equal(version.taken_down, false);
  assert.equal(service.state.releases.get(id.releases.overseas).taken_down, false);

  // 已下架发布不得再记账
  assert.throws(
    () => service.recordRevenue({ revenue_id: "rev:bad", release_id: id.releases.study, amount: 100 }),
    /下架|不再合法/
  );
  // 海外发布照常产生收入并按共同体 10% 分配
  service.recordRevenue({ revenue_id: "rev:os-001", release_id: id.releases.overseas, amount: 50000 });
  const osAllocation = service.allocateRevenue("rev:os-001");
  assert.equal(
    osAllocation.allocations.find((a) => a.payee_id === id.community).amount,
    5000
  );
});

test("撤回后未来使用被拦截：改编新版本不再生成", () => {
  const { service } = newService();
  service.withdrawPermission(id.permissions.holderDrama, { reason: "终止" });
  assert.throws(
    () =>
      service.generateAsset({
        asset_id: id.assets.trailer,
        version_id: "ver:trailer-v2",
        batch_id: id.batches.main,
        parent_version_id: "ver:trailer-v1",
        title: "预告改编版",
        intended_rights: ["display", "adaptation"],
        intended_region: "*",
        manifest: [
          { material_id: id.materials.overview, role: "reference_text" },
          { material_id: id.materials.pattern, role: "style" },
        ],
      }),
    /adaptation/
  );
});

test("下游企业许可不得宽于上游，上游撤回后下游自动失效", () => {
  const { service } = newService();
  assert.throws(
    () =>
      service.grantPermission({
        permission_id: "perm:media-overreach",
        grantor_id: id.enterprise,
        grantor_type: "enterprise",
        material_ids: [id.materials.pattern],
        rights: ["sale"], // 上游只有 display/adaptation
        regions: ["*"],
        valid_from: "2026-09-01T00:00:00+08:00",
        derived_from: id.permissions.holderDrama,
      }),
    /超出上游/
  );
  service.withdrawPermission(id.permissions.holderDrama, { reason: "终止" });
  const lookup = service.frameLookup(id.releases.overseas, 15);
  const pattern = lookup.materials.find((m) => m.material_id === id.materials.pattern);
  assert.ok(
    !pattern.rights.adaptation.permissions.some((p) => p.permission_id === id.permissions.mediaDrama),
    "上游失效后企业下游许可不得继续作为依据"
  );
});

test("公开页呈现技艺与创作者来源，受限步骤不泄露工艺细节", () => {
  const { service } = newService();
  // 含受限步骤但只做现场展示（display@CN/研学）的内部版本
  service.generateAsset({
    asset_id: "asset:live-show",
    version_id: "ver:live-v1",
    batch_id: id.batches.main,
    title: "工坊现场演示记录",
    intended_rights: ["display"],
    intended_region: "CN",
    manifest: [
      { material_id: id.materials.firingStep, role: "step_footage" },
      { material_id: id.materials.pattern, role: "style" },
    ],
  });
  const view = service.publicView("asset:live-show");
  const step = view.versions[0].sources.find((s) => s.material_id === id.materials.firingStep);
  assert.equal(step.restricted, true);
  assert.equal(step.detail, undefined);
  assert.equal(step.holder, "张大师");
  assert.equal(view.versions[0].tool.version, "3.2.1");
  assert.ok(view.versions[0].human_edits === undefined || Array.isArray(view.versions[0].human_edits));
});

test("期限：到期许可自动失效，无需撤回事件", () => {
  const { service } = newService();
  service.registerMaterial({
    material_id: "mat:pop-up-exhibit",
    kind: "story_material",
    element_id: id.element,
    title: "限时特展口述素材",
  });
  service.grantPermission({
    permission_id: "perm:pop-up",
    grantor_id: id.holder,
    grantor_type: "holder",
    material_ids: ["mat:pop-up-exhibit"],
    rights: ["display"],
    regions: ["CN"],
    valid_from: "2026-08-01T00:00:00+08:00",
    valid_until: "2026-09-30T23:59:59+08:00",
  });
  // 当前时钟 2026-10-03，许可已过期
  const plan = service.evaluateVersionPlan({
    manifest: ["mat:pop-up-exhibit"],
    intended_rights: ["display"],
    intended_region: "CN",
  });
  assert.equal(plan.status, "denied");
  assert.equal(plan.blocked[0].code, "no_effective_grant");
});

test("改编链闭包：子版本自身清单不含受限素材，但父版本含，撤回后改编被拦截", () => {
  const { service } = newService();
  // 先基于预告做一个改编子版本（自身只新增公开素材）
  service.generateAsset({
    asset_id: "asset:trailer-remix",
    version_id: "ver:remix-v1",
    batch_id: id.batches.main,
    parent_version_id: "ver:trailer-v1",
    title: "预告海外重剪版",
    intended_rights: ["display", "adaptation"],
    intended_region: "*",
    manifest: [{ material_id: id.materials.overview, role: "reference_text" }],
  });
  service.withdrawPermission(id.permissions.holderDrama, { reason: "终止改编合作" });
  // 再做下一代改编：闭包沿父版本追到纹样，adaptation 已无授权
  assert.throws(
    () =>
      service.generateAsset({
        asset_id: "asset:trailer-remix2",
        version_id: "ver:remix-v2",
        batch_id: id.batches.main,
        parent_version_id: "ver:remix-v1",
        title: "重剪再改编",
        intended_rights: ["adaptation"],
        intended_region: "*",
        manifest: [{ material_id: id.materials.overview, role: "reference_text" }],
      }),
    /adaptation/
  );
});

test("合议和解：无明确禁用时在冲突许可间形成交集，超出交集的用途落空", () => {
  const { service } = newService();
  service.registerMaterial({
    material_id: "mat:new-legend",
    kind: "story_material",
    element_id: id.element,
    community_id: id.community,
    title: "新搜集传说异本",
  });
  service.grantPermission({
    permission_id: "perm:holder-newlegend",
    grantor_id: id.holder,
    grantor_name: "张大师",
    grantor_type: "holder",
    material_ids: ["mat:new-legend"],
    rights: ["display", "adaptation"],
    regions: ["*"],
    valid_from: "2026-09-01T00:00:00+08:00",
  });
  service.grantPermission({
    permission_id: "perm:community-newlegend",
    grantor_id: id.community,
    grantor_name: "景泰蓝坊传承共同体",
    grantor_type: "community",
    material_ids: ["mat:new-legend"],
    rights: ["display"],
    regions: ["CN"],
    valid_from: "2026-09-01T00:00:00+08:00",
  });
  service.openConsentCase({
    case_id: "case:newlegend",
    material_ids: ["mat:new-legend"],
    related_permission_ids: ["perm:holder-newlegend", "perm:community-newlegend"],
    issue: "传承人允许全球改编，共同体约定只允许国内展示",
  });
  service.issueConsentRule({
    case_id: "case:newlegend",
    decision: "reconciled",
    rule: {
      rights: ["display"],
      regions: ["CN"],
      governing_permission_ids: ["perm:holder-newlegend", "perm:community-newlegend"],
    },
    votes: { for: 5, against: 1, abstain: 1 },
  });
  const cn = service.evaluateVersionPlan({
    manifest: ["mat:new-legend"],
    intended_rights: ["display"],
    intended_region: "CN",
  });
  assert.equal(cn.status, "allowed");
  const overseas = service.evaluateVersionPlan({
    manifest: ["mat:new-legend"],
    intended_rights: ["display"],
    intended_region: "JP",
  });
  assert.equal(overseas.status, "denied");
  const adapt = service.evaluateVersionPlan({
    manifest: ["mat:new-legend"],
    intended_rights: ["adaptation"],
    intended_region: "CN",
  });
  assert.equal(adapt.status, "denied");
});

test("事件流可持久化到 JSONL 并完整重建", async () => {
  const path = join(tmpdir(), `hdp-events-${process.pid}-${Date.now()}.jsonl`);
  try {
    const store1 = await EventStore.fromFile(path, { now: () => CLOCK });
    const service1 = new LicensingService(store1, { now: () => CLOCK });
    buildBaseline(service1);
    service1.recordRevenue({ revenue_id: "rev:persist", release_id: id.releases.study, amount: 1000 });

    const store2 = await EventStore.fromFile(path, { now: () => CLOCK });
    const service2 = new LicensingService(store2, { now: () => CLOCK });
    assert.equal(service2.state.releases.size, 3);
    const ledger = service2.revenueLedger("rev:persist");
    assert.equal(ledger.revenue.amount, 1000);
    // 重建后追加仍受聚合版本约束
    assert.throws(
      () =>
        store2.append({
          event_id: "dup",
          event_type: "ELEMENT_CLASSIFIED",
          aggregate_type: "heritage_element",
          aggregate_id: id.element,
          occurred_at: CLOCK,
          version: 1,
          summary: "错版本",
        }),
      /版本冲突/
    );
  } finally {
    rmSync(path, { force: true });
  }
});
