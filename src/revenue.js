import { elementScope, openCases, statementsForElement, transitiveElements } from "./domain.js";
import { isActiveAt, selectShareStatement, SOURCE_LABELS } from "./permissions.js";

/** 登记一笔收入（REVENUE_RECORDED）。 */
export function recordRevenue(store, { revenue_id, release_id, amount, currency = "CNY", occurred_at, note = null, summary }) {
  return store.record({
    event_type: "REVENUE_RECORDED",
    aggregate_type: "revenue_record",
    aggregate_id: revenue_id,
    occurred_at,
    summary: summary ?? `登记收入 ${revenue_id}：${amount} ${currency}（发布 ${release_id}）`,
    payload: { release_id, amount, currency, note },
  });
}

/**
 * 收入审计：从一笔收入反查许可、署名、分配和处置。
 * - 许可：发布所涉每个元素支撑本次权利的授权声明；
 * - 署名：元素、项目的创作者与来源共同体；
 * - 分配：按最具体、最新的分配方案计算各受益人金额；
 * - 处置：涉及元素存在未决合议时暂缓分配（held_pending_collegial）。
 */
export function auditRevenue(domain, revenueId) {
  const revenue = domain.revenues.get(revenueId);
  if (!revenue) throw new Error(`收入记录不存在：${revenueId}`);
  const rel = domain.releases.get(revenue.release_id);
  if (!rel || rel.reviews.length === 0) throw new Error(`收入 ${revenueId} 关联的发布不存在：${revenue.release_id}`);

  const review = rel.reviews.at(-1);
  const at = review.occurred_at;
  const rightsUsed = review.payload.rights_used ?? [];
  const elementIds = [...transitiveElements(domain, review.payload.asset_id)];

  const licenses = elementIds.map((elementId) => {
    const scope = elementScope(domain, elementId);
    const supporting = statementsForElement(domain, elementId).filter(
      (s) => s.effect === "grant" && isActiveAt(s, at) && s.rights.some((r) => rightsUsed.includes(r)),
    );
    return {
      element_id: elementId,
      name: scope.element.name,
      statements: supporting.map((s) => ({
        id: s.id,
        source: s.source,
        source_label: SOURCE_LABELS[s.source] ?? s.source,
        rights: s.rights.filter((r) => rightsUsed.includes(r)),
      })),
    };
  });

  const attributions = [];
  const seen = new Set();
  const push = (name, role) => {
    const key = `${name}/${role}`;
    if (name && !seen.has(key)) {
      seen.add(key);
      attributions.push({ name, role });
    }
  };
  for (const elementId of elementIds) {
    const scope = elementScope(domain, elementId);
    for (const c of scope.element.creators ?? []) push(c.name, c.role);
    if (scope.projectId) for (const c of domain.elements.get(scope.projectId)?.creators ?? []) push(c.name, c.role);
    if (scope.communityId) push(domain.communities.get(scope.communityId)?.name, "来源共同体");
  }

  const shareStmt = selectShareStatement(domain, elementIds, rightsUsed, at);
  const shares = shareStmt?.revenue_shares ?? [];
  const allocation = shares.map((s) => ({
    beneficiary: s.beneficiary,
    role: s.role,
    percent: s.percent,
    amount: Math.round(((revenue.amount * s.percent) / 100) * 100) / 100,
  }));

  const pending = openCases(domain, revenue.recorded_at).filter((kase) => kase.element_ids.some((id) => elementIds.includes(id)));
  const disposal = pending.length > 0 ? "held_pending_collegial" : shares.length > 0 ? "distributable" : "unallocated";

  return {
    revenue: { id: revenueId, amount: revenue.amount, currency: revenue.currency, recorded_at: revenue.recorded_at },
    release: {
      id: rel.id,
      title: review.payload.title ?? null,
      release_version: review.payload.release_version ?? null,
      channel_id: review.payload.channel_id,
      rights_used: rightsUsed,
      reviewed_at: at,
    },
    asset_id: review.payload.asset_id,
    licenses,
    attributions,
    allocation,
    disposal,
    open_cases: pending.map((kase) => kase.id),
    share_source: shareStmt?.id ?? null,
  };
}
