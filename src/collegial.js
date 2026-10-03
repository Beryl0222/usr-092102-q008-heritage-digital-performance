import { buildDomain, statementsForElement } from "./domain.js";
import { detectConflicts, isActiveAt, RIGHT_LABELS } from "./permissions.js";

/**
 * 合议立案：传承人、共同体约定、企业合同等来源的声明相抵触时进入合议。
 * 只有检测到真实抵触（授权 vs 禁用，或授权方案互相矛盾）才允许立案。
 */
export function openCollegialCase(store, { case_id, element_ids, rights, reason, statement_ids = null, occurred_at, opened_by = null, summary }) {
  const domain = buildDomain(store);
  const conflicts = detectConflicts(domain, occurred_at);
  const missing = [];
  for (const elementId of element_ids) {
    for (const right of rights) {
      if (!conflicts.some((c) => c.element_id === elementId && c.right === right)) {
        missing.push(`${elementId}/${right}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`以下元素与权利不存在抵触，不能立案：${missing.join("、")}`);
  }
  const related = conflicts
    .filter((c) => element_ids.includes(c.element_id) && rights.includes(c.right))
    .flatMap((c) => [...c.grants, ...c.prohibitions]);
  return store.record({
    event_type: "COLLEGIAL_CASE_OPENED",
    aggregate_type: "collegial_case",
    aggregate_id: case_id,
    occurred_at,
    summary: summary ?? `就 ${element_ids.join("、")} 的 ${rights.map((r) => RIGHT_LABELS[r] ?? r).join("、")} 权利抵触立案合议`,
    payload: {
      element_ids,
      rights,
      reason: reason ?? null,
      statement_ids: statement_ids ?? [...new Set(related)],
      opened_by,
      status: "open",
    },
  });
}

/**
 * 记录合议裁定。
 * 硬性规则：案件涉及的任一元素对某权利存在有效明确禁用时，该权利必须裁定 prohibited——
 * 任何明确禁用都不得被多数票越过。无明确禁用时按多数票，平票从严（prohibited）。
 */
export function recordCollegialDecision(store, { case_id, votes, outcomes, rationale, occurred_at, summary }) {
  const domain = buildDomain(store);
  const kase = domain.cases.get(case_id);
  if (!kase) throw new Error(`合议案件不存在：${case_id}`);
  if (kase.decision) throw new Error(`合议案件已有裁定：${case_id}`);

  const grantVotes = votes.filter((v) => v.stance === "grant").length;
  const banVotes = votes.filter((v) => v.stance === "prohibit").length;

  for (const right of kase.rights) {
    const outcome = outcomes[right];
    if (!outcome) throw new Error(`缺少对权利 ${right} 的裁定`);
    const explicitBan = kase.element_ids.some((elementId) =>
      statementsForElement(domain, elementId).some(
        (s) => s.effect === "prohibit" && s.rights.includes(right) && isActiveAt(s, occurred_at),
      ),
    );
    if (explicitBan && outcome !== "prohibited") {
      throw new Error(`权利 ${right} 存在明确禁用，多数票不得越过，必须裁定 prohibited`);
    }
    if (!explicitBan && outcome === "granted" && grantVotes <= banVotes) {
      throw new Error(`权利 ${right} 的授予未获多数支持（${grantVotes} 票对 ${banVotes} 票）`);
    }
    if (!explicitBan && outcome === "prohibited" && grantVotes > banVotes) {
      throw new Error(`权利 ${right} 无明确禁用且多数支持授予，不能裁定禁用`);
    }
  }

  return store.record({
    event_type: "COLLEGIAL_DECISION_RECORDED",
    aggregate_type: "collegial_case",
    aggregate_id: case_id,
    occurred_at,
    summary: summary ?? `合议裁定：${Object.entries(outcomes).map(([r, o]) => `${RIGHT_LABELS[r] ?? r}=${o}`).join("，")}`,
    payload: { votes, outcomes, rationale: rationale ?? null, status: "decided" },
  });
}
