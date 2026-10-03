import { decisionFor, elementScope, openCases, statementSpecificity, statementsForElement } from "./domain.js";

/** 权利维度：展示、教学、模型训练、改编、销售；地域与期限是声明上的约束。 */
export const RIGHTS = Object.freeze(["display", "teaching", "model_training", "adaptation", "sales"]);
export const RIGHT_LABELS = Object.freeze({
  display: "展示",
  teaching: "教学",
  model_training: "模型训练",
  adaptation: "改编",
  sales: "销售",
});

/** 授权声明来源：传承人、共同体约定、企业合同、参与者本人。 */
export const PERMISSION_SOURCES = Object.freeze(["inheritor", "community_covenant", "enterprise_contract", "participant"]);
export const SOURCE_LABELS = Object.freeze({
  inheritor: "传承人",
  community_covenant: "共同体约定",
  enterprise_contract: "企业合同",
  participant: "参与者本人",
});

/** 参与者肖像仅以本人声明为授权依据，其他来源的授予对该类元素不生效。 */
export const PORTRAIT_CONSENT_SOURCE = "participant";
export const PORTRAIT_ELEMENT_KIND = "participant_portrait";

/** 线下体验者作品默认不进入训练库，除非有针对该元素的明示授权。 */
export const OFFLINE_ORIGIN = "offline_experience";

const ts = (value) => Date.parse(value);

/** 声明在 at 时刻是否有效：已生效、未被撤回、期限覆盖。 */
export function isActiveAt(stmt, at) {
  const t = ts(at);
  if (ts(stmt.granted_at) > t) return false;
  if (stmt.withdrawn && ts(stmt.withdrawn.effective_at) <= t) return false;
  if (stmt.term?.start && ts(stmt.term.start) > t) return false;
  if (stmt.term?.end && ts(stmt.term.end) < t) return false;
  return true;
}

/** 声明的地域是否覆盖目标地域；声明不限地域时覆盖一切。 */
export function territoryCovers(stmt, territory) {
  if (!territory) return true;
  if (!stmt.territory || stmt.territory.length === 0) return true;
  return stmt.territory.includes(territory);
}

/**
 * 元素在某时刻、某地域的有效权利。
 * 规则：
 * - 授权与禁用都是声明；两者相抵触且未有合议裁定时，该权利为 contested（暂不可用）；
 * - 只有禁用、没有有效授权时，该权利为 prohibited；
 * - 合议裁定落地后按裁定执行，但明确禁用不得被裁定越过（立案时校验）；
 * - 参与者肖像的授予只认本人声明；
 * - 线下体验者作品默认不进入训练库，除非有元素级明示授权。
 */
export function effectiveRights(domain, elementId, { at, territory = null } = {}) {
  if (!at) throw new Error("effectiveRights 需要明确的 at 时间");
  const scope = elementScope(domain, elementId);
  if (!scope) throw new Error(`未知元素：${elementId}`);
  const element = scope.element;

  const active = statementsForElement(domain, elementId).filter((s) => isActiveAt(s, at) && territoryCovers(s, territory));
  const isPortrait = element.kind === PORTRAIT_ELEMENT_KIND;
  const grants = active.filter((s) => s.effect === "grant" && (!isPortrait || s.source === PORTRAIT_CONSENT_SOURCE));
  const bans = active.filter((s) => s.effect === "prohibit");

  const grantedSet = new Set();
  const basis = {};
  for (const stmt of grants) {
    for (const right of stmt.rights) {
      grantedSet.add(right);
      (basis[right] ??= []).push(stmt.id);
    }
  }
  const bannedSet = new Set();
  const banBasis = {};
  for (const stmt of bans) {
    for (const right of stmt.rights) {
      bannedSet.add(right);
      (banBasis[right] ??= []).push(stmt.id);
    }
  }

  const granted = new Set();
  const prohibited = new Set();
  const contested = new Set();
  const blocks = {};
  const contestedReasons = {};
  const block = (right, reason) => {
    prohibited.add(right);
    (blocks[right] ??= []).push(reason);
  };
  const contest = (right, reason) => {
    contested.add(right);
    (contestedReasons[right] ??= []).push(reason);
  };

  for (const right of RIGHTS) {
    const decision = decisionFor(domain, elementId, right, at);
    const hasGrant = grantedSet.has(right);
    const hasBan = bannedSet.has(right);
    if (decision?.outcome === "prohibited") {
      block(right, `合议案件 ${decision.case_id} 裁定禁用`);
      continue;
    }
    if (decision?.outcome === "granted" && !hasBan) {
      granted.add(right);
      (basis[right] ??= []).push(`合议:${decision.case_id}`);
      continue;
    }
    if (hasGrant && hasBan) {
      contest(right, `授权声明 ${basis[right].join("、")} 与禁用声明 ${banBasis[right].join("、")} 相抵触，待合议裁定`);
      continue;
    }
    if (hasBan) {
      block(right, `明确禁用（${banBasis[right].join("、")}）`);
      continue;
    }
    if (hasGrant) granted.add(right);
  }

  if (element.origin === OFFLINE_ORIGIN) {
    // 默认不进入训练库；只有针对该元素本身的明示授权才能解除，项目级笼统主张不算
    const explicitOptIn = grants.some(
      (g) => g.rights.includes("model_training") && (g.applies_to.element_ids?.includes(elementId) || g.applies_to.element_id === elementId),
    );
    if (!explicitOptIn && !prohibited.has("model_training") && !contested.has("model_training")) {
      granted.delete("model_training");
      block("model_training", "线下体验者作品默认不进入训练库");
    }
  }

  // 已立案未裁定的合议案件覆盖的权利暂不可用
  for (const kase of openCases(domain, at)) {
    if (!kase.element_ids.includes(elementId)) continue;
    for (const right of kase.rights) {
      if (!prohibited.has(right)) contest(right, `合议案件 ${kase.id} 审理中`);
    }
  }

  for (const right of contested) granted.delete(right);
  return { element, granted, prohibited, contested, basis, blocks, contestedReasons };
}

/**
 * 组合素材的许可交集：只有每个输入元素都授予的权利才可用；
 * 任一元素的禁用或合议未决都会把该权利排除出交集。
 */
export function intersectRights(domain, elementIds, { at, territory = null } = {}) {
  const perElement = elementIds.map((id) => ({ id, rights: effectiveRights(domain, id, { at, territory }) }));
  const rights = RIGHTS.filter((right) => perElement.every(({ rights: r }) => r.granted.has(right)));

  const blocked = [];
  const contested = [];
  for (const { id, rights: r } of perElement) {
    for (const right of r.prohibited) blocked.push({ element_id: id, right, reasons: r.blocks[right] ?? [] });
    for (const right of r.contested) contested.push({ element_id: id, right, reasons: r.contestedReasons[right] ?? [] });
  }

  // 地域交集：各元素有效授权地域的并集再求交；不限地域（null）是交集的单位元
  let territorySet = null;
  for (const { id } of perElement) {
    const grants = statementsForElement(domain, id).filter((s) => s.effect === "grant" && isActiveAt(s, at));
    const territories = new Set();
    for (const g of grants) {
      if (!g.territory || g.territory.length === 0) territories.add("*");
      else g.territory.forEach((t) => territories.add(t));
    }
    if (territories.has("*") || territories.size === 0) continue;
    const elementTerritory = [...territories];
    territorySet = territorySet === null ? new Set(elementTerritory) : new Set([...territorySet].filter((t) => elementTerritory.includes(t)));
  }

  // 期限包络：各元素有效授权期限的交集（最晚开始、最早结束），供展示参考
  let start = null;
  let end = null;
  for (const { id } of perElement) {
    for (const g of statementsForElement(domain, id).filter((s) => s.effect === "grant" && isActiveAt(s, at))) {
      if (g.term?.start && (!start || ts(g.term.start) > ts(start))) start = g.term.start;
      if (g.term?.end && (!end || ts(g.term.end) < ts(end))) end = g.term.end;
    }
  }

  return {
    rights,
    territory: territorySet ? [...territorySet] : null,
    term: start || end ? { start, end } : null,
    blocked,
    contested,
  };
}

/**
 * 抵触检测（看全部来源的原始声明，不套用肖像同意过滤）：
 * - 授权与禁用同时有效 → grant_vs_prohibit；
 * - 不同来源对同一权利给出不同的收益分配方案 → grant_vs_grant。
 */
export function detectConflicts(domain, at) {
  const conflicts = [];
  const territoryOverlap = (a, b) =>
    !a.territory?.length || !b.territory?.length || a.territory.some((t) => b.territory.includes(t));

  for (const elementId of domain.elements.keys()) {
    const active = statementsForElement(domain, elementId).filter((s) => isActiveAt(s, at));
    for (const right of RIGHTS) {
      const grants = active.filter((s) => s.effect === "grant" && s.rights.includes(right));
      const bans = active.filter((s) => s.effect === "prohibit" && s.rights.includes(right));
      const relevantBans = bans.filter((b) => grants.some((g) => territoryOverlap(g, b)));
      if (grants.length > 0 && relevantBans.length > 0) {
        conflicts.push({
          element_id: elementId,
          right,
          type: "grant_vs_prohibit",
          grants: grants.map((s) => s.id),
          prohibitions: relevantBans.map((s) => s.id),
        });
        continue;
      }
      const shareGrants = grants.filter((g) => g.revenue_shares);
      const sources = new Set(shareGrants.map((g) => g.source));
      const shapes = new Set(shareGrants.map((g) => JSON.stringify(g.revenue_shares)));
      if (shareGrants.length > 1 && sources.size > 1 && shapes.size > 1) {
        conflicts.push({
          element_id: elementId,
          right,
          type: "grant_vs_grant",
          grants: shareGrants.map((s) => s.id),
          prohibitions: [],
        });
      }
    }
  }
  return conflicts;
}

/** 选取收益分配方案：层级最具体、时间最新的有效授权声明中的 revenue_shares。 */
export function selectShareStatement(domain, elementIds, rights, at) {
  return (
    elementIds
      .flatMap((id) => statementsForElement(domain, id))
      .filter((s) => s.effect === "grant" && s.revenue_shares && isActiveAt(s, at) && s.rights.some((r) => rights.includes(r)))
      .sort((a, b) => statementSpecificity(b) - statementSpecificity(a) || ts(b.granted_at) - ts(a.granted_at))[0] ?? null
  );
}
