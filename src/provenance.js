import { elementScope, transitiveElements } from "./domain.js";
import { intersectRights, RIGHT_LABELS, selectShareStatement } from "./permissions.js";

export const KIND_LABELS = Object.freeze({
  craft_project: "技艺项目",
  public_knowledge: "公开知识",
  restricted_step: "受限步骤",
  traditional_pattern: "传统纹样",
  story_material: "故事素材",
  participant_portrait: "参与者肖像",
  experience_work: "体验作品",
});

/** 面向公开页的元素视图：受限步骤只呈现标签，不带出任何细节内容。 */
function publicElement(domain, elementId) {
  const scope = elementScope(domain, elementId);
  if (!scope) return { id: elementId, name: elementId, kind: null, kind_label: null, restricted: false, creators: [] };
  const restricted = scope.element.kind === "restricted_step";
  return {
    id: elementId,
    name: restricted ? `${scope.element.name}（受限步骤，细节不公开）` : scope.element.name,
    kind: scope.element.kind,
    kind_label: KIND_LABELS[scope.element.kind] ?? scope.element.kind,
    restricted,
    creators: scope.element.creators ?? [],
  };
}

/** “这一秒画面依据什么”：定位资产在 second 秒的分段，解析该段的元素来源。 */
export function segmentAttribution(domain, assetId, second) {
  const asset = domain.assets.get(assetId);
  if (!asset) throw new Error(`生成资产不存在：${assetId}`);
  const segment = (asset.segments ?? []).find((s) => s.start <= second && second < s.end) ?? null;
  if (!segment) return { second, segment: null, elements: [] };
  const elementIds = new Set();
  for (const input of segment.inputs ?? []) {
    if (input.kind === "element") elementIds.add(input.id);
    else if (input.kind === "asset") for (const id of transitiveElements(domain, input.id)) elementIds.add(id);
  }
  return { second, segment, elements: [...elementIds].map((id) => publicElement(domain, id)) };
}

/**
 * 公开页视图模型：技艺与创作者来源、素材清单、生成信息（工具版本/人工修改）、
 * 许可范围、收益归属结构与分段来源。只含可公开信息。
 */
export function publicProvenance(domain, releaseId) {
  const rel = domain.releases.get(releaseId);
  if (!rel || rel.reviews.length === 0) throw new Error(`发布不存在：${releaseId}`);
  const review = rel.reviews.at(-1);
  const p = review.payload;
  const asset = domain.assets.get(p.asset_id);
  const elementIds = [...transitiveElements(domain, p.asset_id)];

  let project = null;
  let community = null;
  for (const id of elementIds) {
    const scope = elementScope(domain, id);
    if (scope?.projectId && !project) project = domain.elements.get(scope.projectId) ?? null;
    if (scope?.communityId && !community) community = domain.communities.get(scope.communityId) ?? null;
  }

  const attributions = [];
  const seen = new Set();
  const push = (name, role) => {
    const key = `${name}/${role}`;
    if (name && !seen.has(key)) {
      seen.add(key);
      attributions.push({ name, role });
    }
  };
  for (const c of project?.creators ?? []) push(c.name, c.role);
  for (const id of elementIds) for (const c of domain.elements.get(id)?.creators ?? []) push(c.name, c.role);
  if (community) push(community.name, "来源共同体");

  const intersection = intersectRights(domain, elementIds, { at: review.occurred_at, territory: p.territory?.[0] ?? null });
  const channel = domain.channels.get(p.channel_id);
  const batch = asset?.batch_id ? domain.batches.get(asset.batch_id) : null;
  const shareStmt = selectShareStatement(domain, elementIds, p.rights_used ?? [], review.occurred_at);

  return {
    release: {
      id: releaseId,
      title: p.title ?? releaseId,
      release_version: p.release_version ?? null,
      channel: channel?.name ?? p.channel_id,
      rights: (p.rights_used ?? []).map((r) => RIGHT_LABELS[r] ?? r),
      territory: p.territory ?? null,
      reviewed_at: review.occurred_at,
    },
    craft: { project: project?.name ?? null, community: community?.name ?? null },
    attributions,
    elements: elementIds.map((id) => publicElement(domain, id)),
    generation: asset
      ? {
          tool: asset.tool,
          batch_id: asset.batch_id,
          batch_tool: batch?.tool ?? null,
          human_edits: asset.human_edits ?? [],
        }
      : null,
    segments: (asset?.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      sources: (s.inputs ?? []).flatMap((input) => {
        if (input.kind === "element") return [publicElement(domain, input.id).name];
        if (input.kind === "asset") return [...transitiveElements(domain, input.id)].map((id) => publicElement(domain, id).name);
        return [];
      }),
    })),
    license: {
      rights: intersection.rights.map((r) => RIGHT_LABELS[r] ?? r),
      territory: intersection.territory,
      term: intersection.term,
    },
    revenue_shares: (shareStmt?.revenue_shares ?? []).map((s) => ({
      beneficiary: s.beneficiary,
      role: s.role,
      percent: s.percent,
    })),
  };
}
