// 授权策略引擎：回答“这一用途凭什么允许 / 为什么不允许”。
// 核心不变量：
//  1. 展示、教学、训练、改编、销售是独立权利，授权按 权利×地域×期限×渠道 判定；
//  2. 组合素材只能取许可交集——任一素材不成立，整组不成立；
//  3. PERMISSION_DENIED 是明确禁用，优先于一切授权，合议多数票也不能越过；
//  4. 未决合议期间相关用途挂起（council_pending），合议维持禁用即禁用；
//  5. 进入训练库还需素材本人的 training_opted_in，线下作品默认不进入；
//  6. 下游（企业）许可的上游失效时，下游不再独立有效。

export class PolicyError extends Error {}

const ALL_RIGHTS = ["display", "teaching", "training", "adaptation", "sale"];

function covers(perm, { right, region, channel, at }) {
  if (!perm.rights.has(right)) return false;
  if (!(perm.regions.has("*") || perm.regions.has(region))) return false;
  if (perm.channels && channel && !perm.channels.has(channel)) return false;
  if (perm.valid_from > at) return false;
  if (perm.valid_until && at > perm.valid_until) return false;
  return true;
}

function effectiveAt(perm, at) {
  if (perm.valid_from > at) return false;
  if (perm.valid_until && at > perm.valid_until) return false;
  if (perm.withdrawn && perm.withdrawn.at <= at) return false;
  return true;
}

// 某素材在某时点、某使用场景下的判定。
// opts: { right, region, channel, at, excludePermissionIds?: Set }
export function evaluateMaterial(state, materialId, opts) {
  const { right, region, at, channel = null, excludePermissionIds = null } = opts;
  const material = state.materials.get(materialId);
  const fail = (code, detail) => ({
    status: "denied",
    material_id: materialId,
    right,
    code,
    detail,
    covering: [],
  });

  if (!material) return fail("material_missing", "素材未登记，无法核验来源");
  if (material.status === "removed") return fail("material_removed", "素材已下线");

  // 1. 明确禁用优先：任何 PERMISSION_DENIED 覆盖该用途即否决，票决不能推翻。
  for (const perm of state.permissions.values()) {
    if (perm.state !== "denied") continue;
    if (!perm.material_ids.has(materialId)) continue;
    if (excludePermissionIds?.has(perm.permission_id)) continue;
    if (covers(perm, { right, region, channel, at })) {
      return fail(
        "explicit_prohibition",
        `明确禁用不得越过（${perm.grantor_type}:${perm.grantor_id}${perm.reason ? `：${perm.reason}` : ""}）`
      );
    }
  }

  // 2. 合议状态：未决挂起；维持禁用即否决；已和解按规则收窄。
  const rules = [];
  for (const c of state.consentCases.values()) {
    if (!c.material_ids.has(materialId)) continue;
    if (!c.decision) {
      return {
        status: "council_pending",
        material_id: materialId,
        right,
        code: "council_pending",
        detail: `传承人、共同体约定与企业合同相抵触，合议案件 ${c.case_id} 未决：${c.issue}`,
        covering: [],
      };
    }
    if (c.decision === "prohibition_upheld") {
      const rule = c.rule ?? {};
      const hit =
        !rule.rights || rule.rights.includes(right)
          ? !rule.regions || rule.regions.includes("*") || rule.regions.includes(region)
          : false;
      if (hit) {
        return fail(
          "council_prohibition_upheld",
          `合议 ${c.case_id} 维持禁用，多数票不得越过明确禁用`
        );
      }
    }
    if (c.decision === "reconciled" && c.rule) rules.push(c.rule);
  }

  // 3. 公开知识：在无禁用、无合议限制时可自由使用（仍须署名的要求由投影另行汇总）；
  //    若该素材存在合议交集规则，仍须落在规则范围内。
  if (material.kind === "public_knowledge") {
    const ruleAllows =
      rules.length === 0 ||
      rules.some(
        (rule) =>
          (!rule.rights || rule.rights.includes(right)) &&
          (!rule.regions || rule.regions.includes("*") || rule.regions.includes(region))
      );
    if (!ruleAllows) {
      return fail(
        "council_rule_excludes",
        `合议规则未将该素材的 ${right}@${region} 纳入允许范围`
      );
    }
    return { status: "allowed", material_id: materialId, right, code: "public_knowledge", covering: [] };
  }

  // 4. 有效授权链：granted、在期限内、未撤回、渠道地域相符，
  //    且 derived_from 的上游仍有效；合议规则再做交集收窄。
  const covering = [];
  for (const perm of state.permissions.values()) {
    if (perm.state !== "granted") continue;
    if (!perm.material_ids.has(materialId)) continue;
    if (excludePermissionIds?.has(perm.permission_id)) continue;
    if (!covers(perm, { right, region, channel, at })) continue;
    if (perm.withdrawn) continue;
    if (perm.derived_from) {
      const upstream = state.permissions.get(perm.derived_from);
      if (!upstream || upstream.state !== "granted" || !effectiveAt(upstream, at) || upstream.withdrawn) {
        continue;
      }
    }
    let narrowed = true;
    for (const rule of rules) {
      if (rule.governing_permission_ids && !rule.governing_permission_ids.includes(perm.permission_id)) {
        narrowed = false;
        break;
      }
      if (rule.rights && !rule.rights.includes(right)) {
        narrowed = false;
        break;
      }
      if (rule.regions && !(rule.regions.includes("*") || rule.regions.includes(region))) {
        narrowed = false;
        break;
      }
    }
    if (narrowed) covering.push(perm);
  }

  if (covering.length === 0) {
    return {
      status: "no_grant",
      material_id: materialId,
      right,
      code: "no_effective_grant",
      detail: `素材《${material.title}》缺少 ${right} 权利在 ${region}${channel ? ` / 渠道 ${channel}` : ""} 的有效授权`,
      covering: [],
    };
  }

  // 5. 训练用途的额外门槛：素材本人显式选择入库。
  if (right === "training" && material.training_opted_in !== true) {
    return {
      status: "denied",
      material_id: materialId,
      right,
      code: "training_not_opted_in",
      detail: `素材《${material.title}》未获作者/参与者本人训练入库同意，默认不进入训练库`,
      covering: [],
    };
  }

  // 受限步骤不改变权利判定：若授权只含 display，则教学/改编/训练自然落空。
  return { status: "allowed", material_id: materialId, right, code: "licensed", covering };
}

// 多素材 × 多权利的组合判定：结果为逐素材交集，任一受阻整组受阻。
// denied/no_grant 为硬拒绝（明确禁用或缺授权），council_pending 为可等待的挂起。
export function evaluateManifest(state, materialIds, opts) {
  const rights = opts.rights ?? [opts.right].filter(Boolean);
  const results = [];
  for (const materialId of [...new Set(materialIds)]) {
    for (const right of rights) {
      results.push(evaluateMaterial(state, materialId, { ...opts, right }));
    }
  }
  const hard = results.filter((r) => r.status === "denied" || r.status === "no_grant");
  const pending = results.filter((r) => r.status === "council_pending");
  return {
    status: hard.length ? "denied" : pending.length ? "blocked" : "allowed",
    results,
    blocked: hard.concat(pending),
  };
}

// 版本沿改编链向上闭包输入清单，并按渠道要求核验。
export function manifestClosure(state, version) {
  const index = new Map();
  for (const asset of state.assets.values()) {
    for (const v of asset.versions.values()) index.set(v.version_id, v);
  }
  const entries = new Map();
  const walk = (v, depth) => {
    if (!v || depth > 64) return;
    for (const entry of v.manifest) {
      const prev = entries.get(entry.material_id);
      entries.set(entry.material_id, {
        material_id: entry.material_id,
        role: prev?.role ?? entry.role,
        permission_ids: [...new Set([...(prev?.permission_ids ?? []), ...(entry.permission_ids ?? [])])],
      });
    }
    if (v.parent_version_id) walk(index.get(v.parent_version_id), depth + 1);
  };
  walk(version, 0);
  return [...entries.values()];
}

// 下游许可不得宽于上游（授权时校验）。
export function assertWithinScope(downstream, upstream) {
  const badRight = [...downstream.rights].filter((r) => !upstream.rights.has(r));
  if (badRight.length) throw new PolicyError(`下游权利 ${badRight} 超出上游许可范围`);
  if (!downstream.regions.every((r) => upstream.regions.has("*") || upstream.regions.has(r))) {
    throw new PolicyError("下游地域范围超出上游许可");
  }
  if (downstream.valid_until && upstream.valid_until && downstream.valid_until > upstream.valid_until) {
    throw new PolicyError("下游期限超出上游许可期限");
  }
  for (const m of downstream.material_ids) {
    if (!upstream.material_ids.has(m)) throw new PolicyError(`下游包含上游未覆盖素材：${m}`);
  }
}

export { ALL_RIGHTS };
