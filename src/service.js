// 数字演绎授权应用服务：登记事实、生成留痕、发布核验、收入结算、撤回与精确下架。
// 所有写操作都落成事件；所有判定都经策略引擎对当前投影重算。
import { fold } from "./projection.js";
import {
  PolicyError,
  evaluateManifest,
  evaluateMaterial,
  manifestClosure,
  assertWithinScope,
} from "./policy.js";

const RIGHT_LABEL = {
  display: "展示",
  teaching: "教学",
  training: "模型训练",
  adaptation: "改编",
  sale: "销售",
};

export { RIGHT_LABEL };

export class LicensingService {
  constructor(store, { now } = {}) {
    this.store = store;
    this.now = now ?? (() => new Date().toISOString());
  }

  get state() {
    return fold(this.store.events());
  }

  stateAt(at) {
    return fold(this.store.events(), { asOf: at });
  }

  #emit(eventType, aggregateType, aggregateId, payload, summary, { eventId } = {}) {
    const version = this.store.aggregateVersion(aggregateId) + 1;
    const seq = this.store.events().length + 1;
    const event = {
      event_id: eventId ?? `evt-${String(seq).padStart(5, "0")}-${aggregateId}`,
      event_type: eventType,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      occurred_at: this.now(),
      version,
      summary,
      payload,
    };
    return this.store.append(event);
  }

  // ---------- 登记：技艺、共同体、素材 ----------

  registerElement({ element_id, name, community_id, restricted_step_ids = [] }) {
    this.#emit(
      "ELEMENT_CLASSIFIED",
      "heritage_element",
      element_id,
      { element_id, name, community_id, restricted_step_ids },
      `登记技艺项目：${name}`
    );
    return element_id;
  }

  registerCommunity({ community_id, name }) {
    this.#emit(
      "COMMUNITY_REGISTERED",
      "source_community",
      community_id,
      { community_id, name },
      `登记来源共同体：${name}`
    );
    return community_id;
  }

  setCommunityTerms({ community_id, terms_ref, summary }) {
    this.#emit(
      "COMMUNITY_TERMS_SET",
      "source_community",
      community_id,
      { community_id, terms_ref, summary },
      `共同体约定更新：${summary}`
    );
  }

  registerMaterial(input) {
    const state = this.state;
    if (state.materials.has(input.material_id)) throw new PolicyError("素材已登记");
    if (input.element_id && !state.elements.has(input.element_id)) {
      throw new PolicyError(`技艺项目不存在：${input.element_id}`);
    }
    // 线下体验作品与参与者肖像默认不进入训练库，必须显式 opted_in
    const payload = {
      visibility: "public",
      training_opted_in: false,
      ...input,
      training_opted_in: input.training_opted_in === true,
    };
    if (input.kind === "offline_work" && input.training_opted_in === true && input.opt_in_confirmation !== true) {
      throw new PolicyError("线下体验作品进入训练库须作者本人显式确认（opt_in_confirmation）");
    }
    this.#emit(
      "MATERIAL_REGISTERED",
      "material",
      input.material_id,
      payload,
      `登记素材：${input.title}（${input.kind}）`
    );
    return input.material_id;
  }

  setTrainingChoice(material_id, opted_in, { by } = {}) {
    if (!this.state.materials.has(material_id)) throw new PolicyError("素材不存在");
    this.#emit(
      "MATERIAL_TRAINING_CHOICE",
      "material",
      material_id,
      { material_id, opted_in: opted_in === true, by: by ?? null },
      opted_in ? "作者/参与者同意进入训练库" : "作者/参与者退出训练库"
    );
  }

  reclassifyMaterial({ material_id, kind, visibility, status, reason }) {
    if (!this.state.materials.has(material_id)) throw new PolicyError("素材不存在");
    this.#emit(
      "MATERIAL_RECLASSIFIED",
      "material",
      material_id,
      { material_id, kind, visibility, status: status ?? "active", reason },
      `素材重新归类：${reason ?? ""}`
    );
  }

  // ---------- 许可：授权 / 明确禁用 / 撤回 ----------

  #validatePermissionInput(input) {
    const state = this.state;
    for (const id of input.material_ids) {
      if (!state.materials.has(id)) throw new PolicyError(`素材不存在：${id}`);
    }
    if (input.derived_from) {
      const upstream = state.permissions.get(input.derived_from);
      if (!upstream) throw new PolicyError(`上游许可不存在：${input.derived_from}`);
      if (upstream.state === "denied") throw new PolicyError("上游是明确禁用，不得据其再授权");
      assertWithinScope(
        {
          rights: new Set(input.rights),
          regions: input.regions,
          valid_until: input.valid_until,
          material_ids: input.material_ids,
        },
        upstream
      );
    }
  }

  grantPermission(input) {
    this.#validatePermissionInput(input);
    this.#emit(
      "PERMISSION_GRANTED",
      "usage_permission",
      input.permission_id,
      { ...input, revenue_share_bps: input.revenue_share_bps ?? 0 },
      `授权：${input.rights.map((r) => RIGHT_LABEL[r] ?? r).join("/")}（${input.grantor_type}:${input.grantor_id}）`
    );
    return input.permission_id;
  }

  denyPermission(input) {
    this.#validatePermissionInput(input);
    if (!input.reason) throw new PolicyError("明确禁用必须给出理由");
    this.#emit(
      "PERMISSION_DENIED",
      "usage_permission",
      input.permission_id,
      input,
      `明确禁用：${input.reason}`
    );
    return input.permission_id;
  }

  withdrawPermission(permission_id, { reason, continued_distribution = "stop" } = {}) {
    const perm = this.state.permissions.get(permission_id);
    if (!perm) throw new PolicyError("许可不存在");
    if (perm.withdrawn) throw new PolicyError("许可已撤回");
    this.#emit(
      "PERMISSION_WITHDRAWN",
      "usage_permission",
      permission_id,
      { permission_id, reason: reason ?? "", continued_distribution },
      `授权撤回：${reason ?? ""}`
    );
    // 撤回即停止未来使用；已发布版本的精确下架由 planTakedown 列出
    return this.planTakedown(permission_id, { reason, continued_distribution });
  }

  // ---------- 合议 ----------

  openConsentCase({ case_id, material_ids, related_permission_ids, issue }) {
    this.#emit(
      "CONSENT_CASE_OPENED",
      "consent_council",
      case_id,
      { case_id, material_ids, related_permission_ids, issue },
      `合议立案：${issue}`
    );
    return case_id;
  }

  issueConsentRule({ case_id, decision, rule = {}, votes }) {
    const state = this.state;
    const c = state.consentCases.get(case_id);
    if (!c) throw new PolicyError("合议案件不存在");
    if (c.decision) throw new PolicyError("合议案件已有裁决");
    if (decision === "reconciled") {
      // 合议只能在“无明确禁用”的范围内求交集；发现禁用必须维持禁用
      const rights = rule.rights ?? ["display"];
      const regions = rule.regions ?? ["*"];
      for (const materialId of c.material_ids) {
        for (const right of rights) {
          for (const region of regions) {
            const r = evaluateMaterial(state, materialId, { right, region, at: this.now() });
            if (r.status === "denied" && (r.code === "explicit_prohibition" || r.code === "council_prohibition_upheld")) {
              throw new PolicyError(
                `存在明确禁用，合议不得表决越过（素材 ${materialId}：${r.detail}）；应裁决 prohibition_upheld`
              );
            }
          }
        }
      }
    }
    this.#emit(
      "CONSENT_RULE_ISSUED",
      "consent_council",
      case_id,
      { case_id, decision, rule, votes: votes ?? null },
      decision === "prohibition_upheld" ? "合议维持明确禁用" : "合议形成交集规则"
    );
  }

  // ---------- 训练批次 ----------

  // 训练库准入 = 本人 training_opted_in 且存在有效的 training 授权链；
  // 服务只把实际准入的素材写入批次事实，被排除者不会静默入库。
  recordBatch(batch) {
    const state = this.state;
    const at = this.now();
    const admitted = [];
    const excluded = [];
    for (const materialId of batch.training_corpus_ids ?? []) {
      const material = state.materials.get(materialId);
      if (!material) {
        excluded.push({ material_id: materialId, reason: "未登记" });
        continue;
      }
      if (material.training_opted_in !== true) {
        excluded.push({ material_id: materialId, reason: "未获本人训练入库同意（默认退出）" });
        continue;
      }
      const candidates = new Set(["*"]);
      for (const p of state.permissions.values()) {
        if (p.state === "granted" && p.material_ids.has(materialId) && p.rights.has("training")) {
          for (const r of p.regions) candidates.add(r);
        }
      }
      const ok = [...candidates].some(
        (region) =>
          evaluateMaterial(state, materialId, { right: "training", region, at }).status === "allowed"
      );
      if (ok) admitted.push(materialId);
      else excluded.push({ material_id: materialId, reason: "缺少有效 training 授权" });
    }
    this.#emit(
      "BATCH_RECORDED",
      "generation_batch",
      batch.batch_id,
      {
        batch_id: batch.batch_id,
        tool_name: batch.tool_name,
        tool_version: batch.tool_version,
        model_version: batch.model_version,
        prompt_ref: batch.prompt_ref ?? null,
        training_corpus_ids: admitted,
        excluded_corpus_ids: excluded,
      },
      `登记生成批次：${batch.tool_name}@${batch.tool_version}`
    );
    return { batch_id: batch.batch_id, admitted, excluded };
  }

  // ---------- 生成内容：输入清单、工具版本、人工修改 ----------

  // 预检，不落事件；返回逐素材判定与可冻结的许可 id。
  // manifest 条目可为 {material_id, role} 或纯素材 id 字符串。
  #normalizeManifest(manifest = []) {
    return manifest.map((m) => (typeof m === "string" ? { material_id: m } : m));
  }

  evaluateVersionPlan({ manifest, intended_rights = ["display"], intended_region = "*", at = this.now() }) {
    const state = this.state;
    const entries = this.#normalizeManifest(manifest);
    const ids = entries.map((m) => m.material_id);
    const verdict = evaluateManifest(state, ids, { rights: intended_rights, region: intended_region, at });
    return verdict;
  }

  generateAsset(input) {
    const state = this.state;
    if (!state.batches.has(input.batch_id)) throw new PolicyError("生成批次不存在");
    const ownEntries = this.#normalizeManifest(input.manifest);
    for (const m of ownEntries) {
      if (!state.materials.has(m.material_id)) throw new PolicyError(`清单素材未登记：${m.material_id}`);
    }
    const parent = input.parent_version_id
      ? [...state.assets.values()].flatMap((a) => [...a.versions.values()]).find((v) => v.version_id === input.parent_version_id)
      : null;
    if (input.parent_version_id && !parent) throw new PolicyError("父版本不存在");
    // 核验范围 = 本次输入 ∪ 改编链闭包：父版本用过的素材仍需在权利交集内
    const closureIndexIds = parent ? manifestClosure(state, parent).map((e) => e.material_id) : [];
    const allMaterialIds = [...new Set([...ownEntries.map((m) => m.material_id), ...closureIndexIds])];

    const intendedRights = input.intended_rights ?? ["display"];
    const intendedRegion = input.intended_region ?? "*";
    const verdict = evaluateManifest(state, allMaterialIds, {
      rights: intendedRights,
      region: intendedRegion,
      at: this.now(),
    });
    if (verdict.status !== "allowed") {
      const detail = verdict.blocked
        .map((b) => `${b.material_id} ${b.right}: ${b.code} ${b.detail ?? ""}`)
        .join("；");
      throw new PolicyError(`生成被拒绝（组合素材须取许可交集）：${detail}`);
    }
    // 冻结当时依据的许可，写入输入清单
    const frozen = [];
    for (const m of ownEntries) {
      const permission_ids = new Set(m.permission_ids ?? []);
      for (const right of intendedRights) {
        const r = evaluateMaterial(state, m.material_id, {
          right,
          region: intendedRegion,
          at: this.now(),
        });
        for (const p of r.covering ?? []) permission_ids.add(p.permission_id);
      }
      frozen.push({ material_id: m.material_id, role: m.role ?? null, permission_ids: [...permission_ids] });
    }
    this.#emit(
      "ASSET_GENERATED",
      "generated_asset",
      input.asset_id,
      {
        asset_id: input.asset_id,
        version_id: input.version_id,
        batch_id: input.batch_id,
        parent_version_id: input.parent_version_id ?? null,
        title: input.title,
        manifest: frozen,
        human_edits: input.human_edits ?? [],
        tool_version: input.tool_version ?? state.batches.get(input.batch_id).tool_version,
        model_version: input.model_version ?? state.batches.get(input.batch_id).model_version,
        intended_rights: intendedRights,
        intended_region: intendedRegion,
      },
      `生成版本：${input.title}（${input.version_id}）`
    );
    return { asset_id: input.asset_id, version_id: input.version_id, manifest: frozen };
  }

  // ---------- 渠道与发布 ----------

  registerChannel({ channel_id, name, type, regions, required_rights }) {
    this.#emit(
      "CHANNEL_REGISTERED",
      "distribution_channel",
      channel_id,
      { channel_id, name, type, regions, required_rights },
      `登记商业渠道：${name}`
    );
  }

  #getVersion(state, asset_id, version_id) {
    const v = state.assets.get(asset_id)?.versions.get(version_id);
    if (!v) throw new PolicyError("版本不存在");
    return v;
  }

  // 发布审查：逐秒片段素材必须出自输入清单闭包；缺权/禁用/合议未决均留痕为驳回
  reviewRelease({ release_id, channel_id, asset_id, version_id, region, segments = [], reviewer = "auto" }) {
    const state = this.state;
    const channel = state.channels.get(channel_id);
    if (!channel) throw new PolicyError("渠道不存在");
    const version = this.#getVersion(state, asset_id, version_id);
    const existing = state.releases.get(release_id);
    if (existing?.taken_down) throw new PolicyError("该发布已下架，不得重新送审");

    const closure = manifestClosure(state, version);
    const closureIds = new Set(closure.map((e) => e.material_id));
    const reasons = [];
    for (const seg of segments) {
      for (const mid of seg.material_ids) {
        if (!closureIds.has(mid)) {
          reasons.push(`片段 ${seg.start_sec}-${seg.end_sec}s 引用了不在输入清单中的素材 ${mid}`);
        }
      }
    }

    const rights = [...channel.required_rights];
    const verdict = evaluateManifest(state, closureIds, {
      rights,
      region,
      channel: channel_id,
      at: this.now(),
    });

    let decision;
    if (reasons.length) {
      decision = "rejected";
    } else if (verdict.status === "allowed") {
      decision = "approved";
    } else if (verdict.status === "denied") {
      decision = "rejected";
      for (const b of verdict.blocked.filter((x) => x.status === "denied" || x.status === "no_grant")) {
        reasons.push(`${b.material_id} 需${RIGHT_LABEL[b.right] ?? b.right}权：${b.detail}`);
      }
    } else {
      decision = "council_pending";
      for (const b of verdict.blocked) reasons.push(`${b.material_id}：${b.detail}`);
    }

    this.#emit(
      "RELEASE_REVIEWED",
      "distribution_release",
      release_id,
      {
        release_id,
        channel_id,
        asset_id,
        version_id,
        region,
        decision,
        reasons,
        segments,
        reviewer,
      },
      `发布审查 ${decision}：${state.assets.get(asset_id).title} → ${channel.name}`
    );
    return { decision, reasons };
  }

  // ---------- 收入：记账时重验合法性，结算按许可份额 ----------

  recordRevenue({ revenue_id, release_id, amount, currency = "CNY" }) {
    const state = this.state;
    const release = state.releases.get(release_id);
    if (!release || release.decision !== "approved") {
      throw new PolicyError("发布未获批，不得记账");
    }
    if (release.taken_down) throw new PolicyError("发布已下架，不得再记账");
    if (!Number.isInteger(amount) || amount <= 0) throw new PolicyError("收入金额须为正整数（最小货币单位）");
    // 记账当时重新核验：许可可能已在发布后到期或被撤回
    const channel = state.channels.get(release.channel_id);
    const version = this.#getVersion(state, release.asset_id, release.version_id);
    const at = this.now();
    const verdict = evaluateManifest(state, manifestClosure(state, version).map((e) => e.material_id), {
      rights: [...channel.required_rights],
      region: release.region,
      channel: release.channel_id,
      at,
    });
    if (verdict.status !== "allowed") {
      throw new PolicyError(
        `发布已不再合法，收入不得确认：${verdict.blocked.map((b) => `${b.material_id}:${b.code}`).join("；")}`
      );
    }
    this.#emit(
      "REVENUE_RECORDED",
      "revenue_record",
      revenue_id,
      { revenue_id, release_id, amount, currency, recorded_at: at },
      `确认收入：${amount} ${currency}（发布 ${release_id}）`
    );
    return revenue_id;
  }

  allocateRevenue(revenue_id, { operator_id = "operator" } = {}) {
    const state = this.state;
    const revenue = state.revenues.get(revenue_id);
    if (!revenue) throw new PolicyError("收入不存在");
    if (revenue.allocated) throw new PolicyError("收入已分配");
    const release = state.releases.get(revenue.release_id);
    const channel = state.channels.get(release.channel_id);
    const version = this.#getVersion(state, release.asset_id, release.version_id);
    const materialIds = manifestClosure(state, version).map((e) => e.material_id);

    // 记账时点仍有效的覆盖许可，按份额（基点）参与分配。
    // 同一素材×权利若存在“点名该渠道”的许可，渠道专属许可优先，
    // 不再与开放范围许可叠加抽成；不同授权方共同覆盖时份额相加（超 100% 报错）。
    const chosenById = new Map();
    for (const materialId of materialIds) {
      for (const right of channel.required_rights) {
        const r = evaluateMaterial(state, materialId, {
          right,
          region: release.region,
          channel: release.channel_id,
          at: revenue.recorded_at,
        });
        const covers = r.covering ?? [];
        if (covers.length === 0) continue;
        const channelScoped = covers.filter((p) => p.channels && p.channels.has(release.channel_id));
        for (const p of channelScoped.length ? channelScoped : covers) {
          if (p.revenue_share_bps > 0) chosenById.set(p.permission_id, p);
        }
      }
    }
    const sharePerms = [...chosenById.values()];
    const totalBps = sharePerms.reduce((s, p) => s + p.revenue_share_bps, 0);
    if (totalBps > 10000) {
      throw new PolicyError(
        `许可份额合计 ${totalBps} bps 超过 100%，须先经合议重新约定分配，不得自动摊薄`
      );
    }
    const allocations = sharePerms.map((p) => ({
      payee_id: p.grantor_id,
      payee_type: p.grantor_type,
      permission_id: p.permission_id,
      share_bps: p.revenue_share_bps,
      amount: Math.floor((revenue.amount * p.revenue_share_bps) / 10000),
    }));
    const allocatedAmount = allocations.reduce((s, a) => s + a.amount, 0);
    const operator_residual = {
      payee_id: operator_id,
      amount: revenue.amount - allocatedAmount,
      note: totalBps < 10000 ? `许可份额合计 ${totalBps} bps，余额归运营方` : "分整尾差",
    };
    this.#emit(
      "REVENUE_ALLOCATED",
      "revenue_record",
      revenue_id,
      { revenue_id, allocations, operator_residual },
      `收入分配：${allocations.length} 笔许可收益，余额 ${operator_residual.amount}`
    );
    return { allocations, operator_residual };
  }

  // ---------- 撤回后的精确下架 ----------

  // 只列“真正需要下架”的版本：输入清单闭包实际含该许可覆盖素材、
  // 且排除该许可后在发布权利×地域下不再合法。无关版本绝不列入。
  planTakedown(permission_id, { reason = "", continued_distribution = "stop" } = {}) {
    const state = this.state;
    const perm = state.permissions.get(permission_id);
    if (!perm) throw new PolicyError("许可不存在");
    const at = this.now();
    const items = [];
    const blocked_future_versions = [];

    // 许可在某用途范围上（忽略“此刻已撤回”状态）是否覆盖素材
    const scoped = (materialId, { right, region, channel, at }) => {
      if (!perm.material_ids.has(materialId)) return false;
      if (!perm.rights.has(right)) return false;
      if (!(perm.regions.has("*") || perm.regions.has(region))) return false;
      if (perm.channels && channel && !perm.channels.has(channel)) return false;
      if (perm.valid_from > at) return false;
      if (perm.valid_until && at > perm.valid_until) return false;
      return true;
    };

    for (const asset of state.assets.values()) {
      for (const version of asset.versions.values()) {
        if (version.taken_down) continue;
        const closure = manifestClosure(state, version);
        const closureIds = closure.map((e) => e.material_id);
        const frozenByVersion = new Set(closure.flatMap((e) => e.permission_ids));

        // 该版本承担过的发布（批准且未下架）；下架按发布隔离，不波及其他合法渠道
        const releases = [...state.releases.values()].filter(
          (r) =>
            r.asset_id === asset.asset_id &&
            r.version_id === version.version_id &&
            r.decision === "approved" &&
            !r.taken_down
        );

        const stillLegal = (release) => {
          const channel = state.channels.get(release.channel_id);
          const verdict = evaluateManifest(state, closureIds, {
            rights: [...channel.required_rights],
            region: release.region,
            channel: release.channel_id,
            at,
            excludePermissionIds: new Set([permission_id]),
          });
          return verdict.status === "allowed";
        };

        let listed = false;
        for (const release of releases) {
          const channel = state.channels.get(release.channel_id);
          // 该发布在送审时点是否实际落在本许可范围（渠道专属许可在发布时才成为依据，
          // 故不能只看生成时冻结清单）
          const relied = closureIds.some((mid) =>
            scoped(mid, {
              right: [...channel.required_rights][0],
              region: release.region,
              channel: release.channel_id,
              at: release.reviewed_at,
            })
          ) && [...channel.required_rights].every((right) =>
            closureIds.some((mid) =>
              scoped(mid, { right, region: release.region, channel: release.channel_id, at: release.reviewed_at })
            )
          );
          if (!relied) continue;
          if (continued_distribution === "term_end" && perm.valid_until && at <= perm.valid_until) continue;
          if (!stillLegal(release)) {
            items.push({
              asset_id: asset.asset_id,
              version_id: version.version_id,
              release_id: release.release_id,
              reason: `撤回许可 ${permission_id} 后，${reason || "该发布权利×地域下已无有效授权交集"}`,
            });
            listed = true;
          }
        }
        // 没有需要立即下架的发布，但该版本的原定用途曾依据本许可且现已失去交集：
        // 记录为“停止未来使用”；仍有其他授权完整覆盖的版本不受牵连。
        if (!listed && version.intended_rights.size > 0) {
          const intendedRelied =
            frozenByVersion.has(permission_id) ||
            [...version.intended_rights].every((right) =>
              closureIds.some((mid) =>
                scoped(mid, {
                  right,
                  region: version.intended_region ?? "*",
                  channel: null,
                  at: version.created_at,
                })
              )
            );
          if (!intendedRelied) continue;
          const futureVerdict = evaluateManifest(state, closureIds, {
            rights: [...version.intended_rights],
            region: version.intended_region ?? "*",
            at,
            excludePermissionIds: new Set([permission_id]),
          });
          if (futureVerdict.status !== "allowed") {
            blocked_future_versions.push({ asset_id: asset.asset_id, version_id: version.version_id });
          }
        }
      }
    }

    const takedown_id = `takedown-${permission_id}`;
    if (!state.takedowns.has(takedown_id)) {
      this.#emit(
        "TAKEDOWN_LISTED",
        "takedown_order",
        takedown_id,
        {
          trigger_permission_id: permission_id,
          items,
          blocked_future_versions,
          future_use_blocked: `停止依据许可 ${permission_id} 的一切未来使用；已批准发布中仅列失去授权交集的版本`,
        },
        `生成下架清单：${items.length} 个版本需下架，${blocked_future_versions.length} 个版本仅停止未来使用`
      );
    }
    return { takedown_id, items, blocked_future_versions };
  }

  executeTakedown(takedown_id) {
    const state = this.state;
    const order = state.takedowns.get(takedown_id);
    if (!order) throw new PolicyError("下架指令不存在");
    const done = [];
    for (const item of order.items) {
      const release = item.release_id ? state.releases.get(item.release_id) : null;
      if (release?.taken_down) continue;
      const version = state.assets.get(item.asset_id)?.versions.get(item.version_id);
      if (version?.taken_down) continue;
      this.#emit(
        "ASSET_TAKEN_DOWN",
        "takedown_order",
        takedown_id,
        {
          takedown_id,
          asset_id: item.asset_id,
          version_id: item.version_id,
          release_id: item.release_id ?? null,
        },
        `下架版本：${item.version_id}${item.release_id ? `（发布 ${item.release_id}）` : ""}`
      );
      done.push(item);
    }
    return done;
  }

  // ---------- 查询：公开来源、逐秒依据、收入台账 ----------

  // 公开页：呈现技艺与创作者来源；受限步骤不输出工艺细节
  publicView(asset_id) {
    const state = this.state;
    const asset = state.assets.get(asset_id);
    if (!asset) throw new PolicyError("作品不存在");
    const elementOf = (materialId) => state.elements.get(state.materials.get(materialId)?.element_id);
    const versions = [...asset.versions.values()].map((v) => {
      const sources = manifestClosure(state, v).map((e) => {
        const m = state.materials.get(e.material_id);
        const base = {
          material_id: e.material_id,
          role: e.role,
          kind: m.kind,
          title: m.title,
          element: elementOf(e.material_id)?.name ?? null,
          attribution: [],
        };
        if (m.kind === "restricted_step") {
          // 工艺细节不公开，只说明该步骤为受限展示及其来源
          return {
            ...base,
            title: m.title,
            restricted: true,
            detail: undefined,
            source_community: m.community_id ? state.communities.get(m.community_id)?.name ?? null : null,
            holder: m.holder_name ?? null,
          };
        }
        const holder = m.holder_name ? { party: m.holder_name, as: "传承人" } : null;
        const subject = m.subject_name ? { party: m.subject_name, as: "参与者本人" } : null;
        const community = m.community_id ? { party: state.communities.get(m.community_id)?.name, as: "来源共同体" } : null;
        base.attribution = [holder, subject, community].filter(Boolean);
        return base;
      });
      return {
        version_id: v.version_id,
        title: v.title,
        created_at: v.created_at,
        taken_down: v.taken_down,
        tool: { name: state.batches.get(v.batch_id)?.tool_name, version: v.tool_version, model_version: v.model_version },
        sources,
        human_edits: v.human_edits,
      };
    });
    return { asset_id, title: asset.title, versions };
  }

  // “这一秒画面依据什么、允许在哪用、收益归谁”
  frameLookup(release_id, sec) {
    const state = this.state;
    const release = state.releases.get(release_id);
    if (!release) throw new PolicyError("发布不存在");
    const channel = state.channels.get(release.channel_id);
    const version = this.#getVersion(state, release.asset_id, release.version_id);
    const hits = release.segments.filter((s) => sec >= s.start_sec && sec < s.end_sec);
    const materialIds = [...new Set(hits.flatMap((s) => s.material_ids))];
    const answer = materialIds.map((materialId) => {
      const m = state.materials.get(materialId);
      const perRight = {};
      for (const right of ["display", "teaching", "training", "adaptation", "sale"]) {
        const r = evaluateMaterial(state, materialId, {
          right,
          region: release.region,
          channel: release.channel_id,
          at: this.now(),
        });
        perRight[right] = {
          status: r.status,
          detail: r.detail ?? null,
          permissions: (r.covering ?? []).map((p) => ({
            permission_id: p.permission_id,
            grantor: p.grantor_name ?? p.grantor_id,
            grantor_type: p.grantor_type,
            regions: [...p.regions],
            valid_from: p.valid_from,
            valid_until: p.valid_until,
            revenue_share_bps: p.revenue_share_bps,
            withdrawn: p.withdrawn?.at ?? null,
          })),
        };
      }
      return {
        material_id: materialId,
        title: m?.title ?? null,
        kind: m?.kind ?? null,
        restricted: m?.kind === "restricted_step",
        rights: perRight,
      };
    });
    return {
      release_id,
      at_sec: sec,
      channel: channel.name,
      region: release.region,
      release_status: release.taken_down ? "taken_down" : release.decision,
      materials: answer,
    };
  }

  revenueLedger(revenue_id) {
    const state = this.state;
    const revenue = state.revenues.get(revenue_id);
    if (!revenue) throw new PolicyError("收入不存在");
    const release = state.releases.get(revenue.release_id);
    const version = this.#getVersion(state, release.asset_id, release.version_id);
    const channel = state.channels.get(release.channel_id);
    const closure = manifestClosure(state, version);
    return {
      revenue: { ...revenue },
      release: {
        release_id: release.release_id,
        channel: channel.name,
        region: release.region,
        asset_id: release.asset_id,
        version_id: release.version_id,
        segments: release.segments,
      },
      proof: closure.map((e) => {
        // 发布时点（渠道×地域）实际成立的许可依据，与生成时冻结清单分开留痕
        const release_permission_ids = new Set();
        for (const right of channel.required_rights) {
          const r = evaluateMaterial(state, e.material_id, {
            right,
            region: release.region,
            channel: release.channel_id,
            at: release.reviewed_at,
          });
          for (const p of r.covering ?? []) release_permission_ids.add(p.permission_id);
        }
        return {
          material_id: e.material_id,
          title: state.materials.get(e.material_id)?.title,
          frozen_permission_ids: e.permission_ids,
          release_permission_ids: [...release_permission_ids],
        };
      }),
      attribution: this.publicView(release.asset_id).versions
        .find((v) => v.version_id === release.version_id)
        ?.sources.flatMap((s) => (s.attribution ?? []).map((a) => ({ material_id: s.material_id, ...a }))) ?? [],
    };
  }
}
