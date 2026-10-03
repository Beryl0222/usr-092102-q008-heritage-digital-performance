import { buildDomain, elementScope, transitiveElements } from "./domain.js";
import { effectiveRights, intersectRights, RIGHT_LABELS } from "./permissions.js";

/**
 * 发布审核：回答“这条内容依据什么、允许在哪用”。
 * draft: { release_id, asset_id, channel_id, rights_used, territory, at, title?, release_version? }
 * 返回 { decision, findings, basis }，不改动事件流。
 */
export function reviewRelease(domain, draft) {
  const findings = [];
  const basis = [];

  const asset = domain.assets.get(draft.asset_id);
  if (!asset) {
    return { decision: "rejected", findings: [`生成资产不存在：${draft.asset_id}`], basis };
  }
  if (!Array.isArray(draft.rights_used) || draft.rights_used.length === 0) {
    findings.push("未声明本次发布使用的权利");
  }

  const channel = domain.channels.get(draft.channel_id);
  if (!channel) findings.push(`商业渠道未登记：${draft.channel_id}`);

  const elements = [...transitiveElements(domain, draft.asset_id)];
  const territories = draft.territory?.length ? draft.territory : [null];

  for (const territory of territories) {
    const intersection = intersectRights(domain, elements, { at: draft.at, territory });
    for (const right of draft.rights_used ?? []) {
      if (intersection.rights.includes(right)) {
        const statements = [];
        for (const elementId of elements) {
          const eff = effectiveRights(domain, elementId, { at: draft.at, territory });
          for (const id of eff.basis[right] ?? []) statements.push({ element_id: elementId, statement_id: id });
        }
        basis.push({ right, territory, statements });
        continue;
      }
      for (const elementId of elements) {
        const eff = effectiveRights(domain, elementId, { at: draft.at, territory });
        const name = `「${eff.element.name}」(${elementId})`;
        const label = RIGHT_LABELS[right] ?? right;
        if (eff.prohibited.has(right)) {
          findings.push(`元素${name}的${label}权被禁用：${(eff.blocks[right] ?? []).join("；")}`);
        } else if (eff.contested.has(right)) {
          findings.push(`元素${name}的${label}权存在抵触：${(eff.contestedReasons[right] ?? []).join("；")}`);
        } else if (!eff.granted.has(right)) {
          const usable = [...eff.granted].map((r) => RIGHT_LABELS[r] ?? r).join("、") || "无";
          findings.push(`元素${name}未授予${label}权（已授权：${usable}）`);
        }
      }
    }
  }

  if (channel) {
    for (const right of draft.rights_used ?? []) {
      if (!channel.rights_offered.includes(right)) {
        findings.push(`渠道「${channel.name}」不支持${RIGHT_LABELS[right] ?? right}权`);
      }
    }
    if (channel.territory?.length) {
      for (const t of territories) {
        if (t && !channel.territory.includes(t)) findings.push(`渠道「${channel.name}」不覆盖地域 ${t}`);
      }
    }
  }

  return { decision: findings.length ? "rejected" : "approved", findings: [...new Set(findings)], basis };
}

/** 执行审核并把结果写入事件流（RELEASE_REVIEWED）。 */
export function recordReleaseReview(store, draft) {
  const domain = buildDomain(store);
  const { decision, findings, basis } = reviewRelease(domain, draft);
  return store.record({
    event_type: "RELEASE_REVIEWED",
    aggregate_type: "distribution_release",
    aggregate_id: draft.release_id,
    occurred_at: draft.at,
    summary: draft.summary ?? `发布审核 ${draft.release_id}：${decision === "approved" ? "通过" : "驳回"}`,
    payload: { ...draft, decision, findings, basis },
  });
}

/** 声明撤回后实际覆盖的元素集合（元素级/项目级/共同体级）。 */
function coveredElements(domain, stmt) {
  const a = stmt.applies_to ?? {};
  const covered = new Set([...(a.element_ids ?? []), ...(a.element_id ? [a.element_id] : [])]);
  for (const id of domain.elements.keys()) {
    const scope = elementScope(domain, id);
    if (!scope) continue;
    if (a.project_id && scope.projectId === a.project_id) covered.add(id);
    if (a.community_id && scope.communityId === a.community_id) covered.add(id);
  }
  return covered;
}

/**
 * 授权撤回后的精确下架清单：只列出真正包含被撤回素材、且用到被撤回权利的
 * 已批准发布版本；不含该素材或不用该权利的发布不受牵连。
 */
export function computeTakedown(domain, permissionId) {
  const stmt = domain.statements.get(permissionId);
  if (!stmt) throw new Error(`授权声明不存在：${permissionId}`);
  if (!stmt.withdrawn) throw new Error(`授权 ${permissionId} 尚未撤回，无需下架`);

  const covered = coveredElements(domain, stmt);
  const result = [];
  for (const rel of domain.releases.values()) {
    const review = rel.reviews.at(-1);
    if (!review || review.payload.decision !== "approved") continue;
    const elements = transitiveElements(domain, review.payload.asset_id);
    const hit = [...covered].filter((id) => elements.has(id));
    if (hit.length === 0) continue;
    const rightsHit = (review.payload.rights_used ?? []).filter((r) => stmt.rights.includes(r));
    if (rightsHit.length === 0) continue;
    const territories = review.payload.territory ?? [];
    if (stmt.territory?.length && territories.length && !stmt.territory.some((t) => territories.includes(t))) continue;
    result.push({
      release_id: rel.id,
      release_version: review.payload.release_version ?? null,
      title: review.payload.title ?? null,
      asset_id: review.payload.asset_id,
      elements: hit,
      rights: rightsHit,
      reason: `授权 ${permissionId} 已撤回${stmt.withdrawn.reason ? `（${stmt.withdrawn.reason}）` : ""}`,
    });
  }
  return result;
}

/** 依据撤回声明生成并追加 TAKEDOWN_ISSUED 事件（每个受影响发布一条）。 */
export function issueTakedowns(store, permissionId, { occurred_at }) {
  const domain = buildDomain(store);
  const items = computeTakedown(domain, permissionId);
  return items.map((item) =>
    store.record({
      event_type: "TAKEDOWN_ISSUED",
      aggregate_type: "distribution_release",
      aggregate_id: item.release_id,
      occurred_at,
      summary: `下架 ${item.title ?? item.release_id}（${item.release_version ?? "未标注版本"}）：${item.reason}`,
      payload: { ...item, withdrawn_permission: permissionId },
    }),
  );
}

/** 复核历史发布在当前时刻是否仍然合法（停止未来使用的核对）。 */
export function recheckRelease(domain, releaseId, at) {
  const rel = domain.releases.get(releaseId);
  if (!rel || rel.reviews.length === 0) throw new Error(`发布不存在：${releaseId}`);
  const review = rel.reviews.at(-1);
  const result = reviewRelease(domain, { ...review.payload, at });
  return {
    release_id: releaseId,
    reviewed_as: review.payload.decision,
    now: result.decision,
    findings: result.findings,
  };
}
