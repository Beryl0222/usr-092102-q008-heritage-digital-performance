/**
 * 领域读模型：把事件流折叠成可供权利解析、合规审核与审计使用的索引。
 * 所有读模型都是纯函数式派生，不改动事件。
 */

export function buildDomain(store) {
  const communities = new Map();
  const elements = new Map();
  const statements = new Map();
  const batches = new Map();
  const assets = new Map();
  const channels = new Map();
  const releases = new Map();
  const cases = new Map();
  const revenues = new Map();

  for (const event of store.all()) {
    const p = event.payload ?? {};
    switch (event.event_type) {
      case "COMMUNITY_REGISTERED":
        communities.set(event.aggregate_id, { id: event.aggregate_id, ...p, registered_at: event.occurred_at });
        break;
      case "ELEMENT_CLASSIFIED": {
        const prev = elements.get(event.aggregate_id) ?? { id: event.aggregate_id, projectId: null, communityId: null };
        elements.set(event.aggregate_id, { ...prev, ...p, classified_at: event.occurred_at });
        break;
      }
      case "ELEMENT_LINKED": {
        const element = elements.get(event.aggregate_id);
        if (!element) break;
        if (p.link_type === "belongs_to_project") element.projectId = p.target_id;
        if (p.link_type === "maintained_by_community") element.communityId = p.target_id;
        break;
      }
      case "PERMISSION_GRANTED":
      case "PROHIBITION_DECLARED":
        statements.set(event.aggregate_id, {
          id: event.aggregate_id,
          effect: event.event_type === "PROHIBITION_DECLARED" ? "prohibit" : (p.effect ?? "grant"),
          source: p.source ?? null,
          rights: p.rights ?? [],
          territory: p.territory ?? null,
          term: p.term ?? null,
          applies_to: p.applies_to ?? {},
          revenue_shares: p.revenue_shares ?? null,
          note: p.note ?? p.reason ?? null,
          granted_at: event.occurred_at,
          withdrawn: null,
        });
        break;
      case "PERMISSION_WITHDRAWN": {
        const stmt = statements.get(event.aggregate_id);
        if (stmt) {
          stmt.withdrawn = {
            effective_at: p.effective_at ?? event.occurred_at,
            reason: p.reason ?? null,
            recorded_at: event.occurred_at,
          };
        }
        break;
      }
      case "BATCH_REGISTERED":
        batches.set(event.aggregate_id, { id: event.aggregate_id, ...p });
        break;
      case "ASSET_GENERATED":
        assets.set(event.aggregate_id, {
          id: event.aggregate_id,
          title: p.title ?? event.summary,
          batch_id: p.batch_id ?? null,
          inputs: p.inputs ?? [],
          tool: p.tool ?? null,
          human_edits: p.human_edits ?? [],
          segments: p.segments ?? [],
          created_at: event.occurred_at,
        });
        break;
      case "CHANNEL_REGISTERED":
        channels.set(event.aggregate_id, {
          id: event.aggregate_id,
          name: p.name ?? event.aggregate_id,
          kind: p.kind ?? null,
          rights_offered: p.rights_offered ?? [],
          territory: p.territory ?? null,
          operator: p.operator ?? null,
        });
        break;
      case "RELEASE_REVIEWED": {
        const rel = releases.get(event.aggregate_id) ?? { id: event.aggregate_id, reviews: [], takedowns: [] };
        rel.reviews.push(event);
        releases.set(event.aggregate_id, rel);
        break;
      }
      case "TAKEDOWN_ISSUED": {
        const rel = releases.get(event.aggregate_id) ?? { id: event.aggregate_id, reviews: [], takedowns: [] };
        rel.takedowns.push(event);
        releases.set(event.aggregate_id, rel);
        break;
      }
      case "COLLEGIAL_CASE_OPENED":
        cases.set(event.aggregate_id, {
          id: event.aggregate_id,
          opened: event,
          decision: null,
          element_ids: p.element_ids ?? [],
          rights: p.rights ?? [],
          statement_ids: p.statement_ids ?? [],
          reason: p.reason ?? null,
        });
        break;
      case "COLLEGIAL_DECISION_RECORDED": {
        const kase = cases.get(event.aggregate_id);
        if (kase) kase.decision = event;
        break;
      }
      case "REVENUE_RECORDED":
        revenues.set(event.aggregate_id, { id: event.aggregate_id, ...p, recorded_at: event.occurred_at });
        break;
      default:
        break;
    }
  }

  // 技艺项目本身是项目层级的根
  for (const element of elements.values()) {
    if (element.kind === "craft_project" && !element.projectId) element.projectId = element.id;
  }

  return { store, communities, elements, statements, batches, assets, channels, releases, cases, revenues };
}

/** 元素的归属链：元素 → 技艺项目 → 来源共同体。 */
export function elementScope(domain, elementId) {
  const element = domain.elements.get(elementId);
  if (!element) return null;
  const projectId = element.projectId ?? null;
  const project = projectId ? domain.elements.get(projectId) : null;
  const communityId = element.communityId ?? project?.communityId ?? null;
  return { element, projectId, communityId };
}

function appliesToElement(stmt, elementId, scope) {
  const a = stmt.applies_to ?? {};
  if (Array.isArray(a.element_ids) && a.element_ids.includes(elementId)) return true;
  if (a.element_id && a.element_id === elementId) return true;
  if (a.project_id && a.project_id === scope.projectId) return true;
  if (a.community_id && a.community_id === scope.communityId) return true;
  return false;
}

/** 作用于某元素的全部授权/禁用声明（元素级、项目级、共同体级）。 */
export function statementsForElement(domain, elementId) {
  const scope = elementScope(domain, elementId);
  if (!scope) return [];
  const result = [];
  for (const stmt of domain.statements.values()) {
    if (appliesToElement(stmt, elementId, scope)) result.push(stmt);
  }
  return result;
}

/** 声明的细粒度层级：元素级 > 项目级 > 共同体级。 */
export function statementSpecificity(stmt) {
  const a = stmt.applies_to ?? {};
  if (Array.isArray(a.element_ids) || a.element_id) return 3;
  if (a.project_id) return 2;
  if (a.community_id) return 1;
  return 0;
}

/** 资产的传递元素依赖：资产可引用元素，也可引用其他资产（衍生链）。 */
export function transitiveElements(domain, assetId) {
  const elements = new Set();
  const visitedAssets = new Set();
  const visit = (id) => {
    if (visitedAssets.has(id)) return;
    visitedAssets.add(id);
    const asset = domain.assets.get(id);
    if (!asset) return;
    for (const input of asset.inputs ?? []) {
      if (input.kind === "element") elements.add(input.id);
      else if (input.kind === "asset") visit(input.id);
    }
  };
  visit(assetId);
  return elements;
}

/**
 * 合议案件是否处于未决状态。
 * 不传 at：当前仍未裁定；传 at：在 at 时刻已立案且尚未裁定。
 */
export function openCases(domain, at = null) {
  return [...domain.cases.values()].filter((kase) => {
    if (at && Date.parse(kase.opened.occurred_at) > Date.parse(at)) return false;
    if (!kase.decision) return true;
    return at ? Date.parse(kase.decision.occurred_at) > Date.parse(at) : false;
  });
}

/** 某元素某项权利的最新合议裁定（不晚于 at；at 为空则取最新）。 */
export function decisionFor(domain, elementId, right, at = null) {
  let latest = null;
  for (const kase of domain.cases.values()) {
    if (!kase.decision) continue;
    if (!kase.element_ids.includes(elementId) || !kase.rights.includes(right)) continue;
    if (at && Date.parse(kase.decision.occurred_at) > Date.parse(at)) continue;
    if (!latest || Date.parse(kase.decision.occurred_at) > Date.parse(latest.decision.occurred_at)) latest = kase;
  }
  if (!latest) return null;
  return {
    case_id: latest.id,
    outcome: latest.decision.payload.outcomes?.[right] ?? null,
    decided_at: latest.decision.occurred_at,
  };
}
