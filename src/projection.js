// 投影：把事件流重放成便于查询的当前状态。
// asOf 可只重放某时间点之前的事件，用于“当时依据什么”的历史性核对。

function asSet(value) {
  return new Set(Array.isArray(value) ? value : value === undefined ? [] : [value]);
}

export function fold(events, { asOf } = {}) {
  const state = {
    elements: new Map(),
    communities: new Map(),
    materials: new Map(),
    permissions: new Map(),
    consentCases: new Map(),
    batches: new Map(),
    assets: new Map(),
    channels: new Map(),
    releases: new Map(),
    revenues: new Map(),
    takedowns: new Map(),
  };

  const ensureAsset = (assetId) => {
    if (!state.assets.has(assetId)) {
      state.assets.set(assetId, { asset_id: assetId, title: undefined, versions: new Map() });
    }
    return state.assets.get(assetId);
  };

  for (const e of events) {
    if (asOf && e.occurred_at > asOf) continue;
    const p = e.payload ?? {};
    switch (e.event_type) {
      case "ELEMENT_CLASSIFIED":
        state.elements.set(p.element_id, {
          element_id: p.element_id,
          name: p.name,
          community_id: p.community_id,
          restricted_step_ids: asSet(p.restricted_step_ids),
        });
        break;
      case "COMMUNITY_REGISTERED":
        state.communities.set(p.community_id, { community_id: p.community_id, name: p.name });
        break;
      case "COMMUNITY_TERMS_SET":
        // 共同体约定以许可事件表达，此处仅登记约定文本引用
        state.communities.set(p.community_id, {
          ...(state.communities.get(p.community_id) ?? { community_id: p.community_id }),
          terms_ref: p.terms_ref,
          terms_summary: p.summary,
        });
        break;
      case "MATERIAL_REGISTERED":
        state.materials.set(p.material_id, {
          material_id: p.material_id,
          kind: p.kind,
          element_id: p.element_id,
          community_id: p.community_id ?? null,
          holder_id: p.holder_id ?? null,
          holder_name: p.holder_name ?? null,
          subject_party_id: p.subject_party_id ?? null,
          subject_name: p.subject_name ?? null,
          title: p.title,
          visibility: p.visibility ?? "public",
          // 默认不进入训练库；线下体验作品尤其如此
          training_opted_in: p.training_opted_in === true,
          detail: p.detail ?? null,
          status: "active",
        });
        break;
      case "MATERIAL_RECLASSIFIED": {
        const m = state.materials.get(p.material_id);
        if (m) {
          if (p.kind) m.kind = p.kind;
          if (p.visibility) m.visibility = p.visibility;
          m.status = p.status ?? "active";
        }
        break;
      }
      case "MATERIAL_TRAINING_CHOICE": {
        const m = state.materials.get(p.material_id);
        if (m) m.training_opted_in = p.opted_in === true;
        break;
      }
      case "PERMISSION_GRANTED":
      case "PERMISSION_DENIED":
        state.permissions.set(p.permission_id, {
          permission_id: p.permission_id,
          state: e.event_type === "PERMISSION_GRANTED" ? "granted" : "denied",
          grantor_id: p.grantor_id,
          grantor_name: p.grantor_name ?? null,
          grantor_type: p.grantor_type,
          material_ids: asSet(p.material_ids),
          rights: asSet(p.rights),
          regions: asSet(p.regions),
          channels: p.channels ? asSet(p.channels) : null,
          valid_from: p.valid_from,
          valid_until: p.valid_until ?? null,
          derived_from: p.derived_from ?? null,
          revenue_share_bps: p.revenue_share_bps ?? 0,
          attribution_required: p.attribution_required !== false,
          conditions: p.conditions ?? {},
          reason: p.reason ?? null,
          withdrawn: null,
        });
        break;
      case "PERMISSION_WITHDRAWN": {
        const perm = state.permissions.get(p.permission_id);
        if (perm) {
          perm.withdrawn = {
            at: e.occurred_at,
            reason: p.reason ?? "",
            continued_distribution: p.continued_distribution ?? "stop",
          };
        }
        break;
      }
      case "CONSENT_CASE_OPENED":
        state.consentCases.set(p.case_id, {
          case_id: p.case_id,
          material_ids: asSet(p.material_ids),
          related_permission_ids: asSet(p.related_permission_ids),
          issue: p.issue,
          opened_at: e.occurred_at,
          decision: null,
          rule: null,
          votes: null,
        });
        break;
      case "CONSENT_RULE_ISSUED": {
        const c = state.consentCases.get(p.case_id);
        if (c) {
          c.decision = p.decision;
          c.rule = p.rule ?? null;
          c.votes = p.votes ?? null;
          c.issued_at = e.occurred_at;
        }
        break;
      }
      case "BATCH_RECORDED":
        state.batches.set(p.batch_id, {
          batch_id: p.batch_id,
          tool_name: p.tool_name,
          tool_version: p.tool_version,
          model_version: p.model_version,
          prompt_ref: p.prompt_ref ?? null,
          training_corpus_ids: asSet(p.training_corpus_ids),
        });
        break;
      case "ASSET_GENERATED": {
        const asset = ensureAsset(p.asset_id);
        asset.title = p.title ?? asset.title;
        asset.versions.set(p.version_id, {
          version_id: p.version_id,
          batch_id: p.batch_id,
          parent_version_id: p.parent_version_id ?? null,
          title: p.title,
          manifest: (p.manifest ?? []).map((m) => ({
            material_id: m.material_id,
            role: m.role ?? null,
            permission_ids: [...(m.permission_ids ?? [])],
          })),
          human_edits: p.human_edits ?? [],
          tool_version: p.tool_version ?? null,
          model_version: p.model_version ?? null,
          intended_rights: asSet(p.intended_rights),
          intended_region: p.intended_region ?? null,
          created_at: e.occurred_at,
          taken_down: false,
          takedown_ids: [],
          takedown_release_ids: new Set(),
        });
        break;
      }
      case "ASSET_REVIEWED": {
        // 版本级内部审查备注（与渠道发布 RELEASE_REVIEWED 区分）
        const asset = state.assets.get(p.asset_id);
        const v = asset?.versions.get(p.version_id);
        if (v) v.review = { decision: p.decision, note: p.note ?? null, at: e.occurred_at };
        break;
      }
      case "CHANNEL_REGISTERED":
        state.channels.set(p.channel_id, {
          channel_id: p.channel_id,
          name: p.name,
          type: p.type,
          regions: asSet(p.regions),
          required_rights: asSet(p.required_rights),
        });
        break;
      case "RELEASE_REVIEWED": {
        const prev = state.releases.get(p.release_id);
        state.releases.set(p.release_id, {
          release_id: p.release_id,
          channel_id: p.channel_id,
          asset_id: p.asset_id,
          version_id: p.version_id,
          decision: p.decision,
          reasons: p.reasons ?? [],
          region: p.region ?? null,
          segments: p.segments ?? [],
          reviewed_at: e.occurred_at,
          reviews: [...(prev?.reviews ?? []), { at: e.occurred_at, decision: p.decision }],
          taken_down: prev?.taken_down ?? false,
        });
        break;
      }
      case "REVENUE_RECORDED":
        state.revenues.set(p.revenue_id, {
          revenue_id: p.revenue_id,
          release_id: p.release_id,
          amount: p.amount,
          currency: p.currency,
          recorded_at: e.occurred_at,
          allocated: false,
          allocations: [],
          residual: null,
        });
        break;
      case "REVENUE_ALLOCATED": {
        const r = state.revenues.get(p.revenue_id);
        if (r) {
          r.allocated = true;
          r.allocations = p.allocations ?? [];
          r.residual = p.operator_residual ?? null;
        }
        break;
      }
      case "TAKEDOWN_LISTED":
        state.takedowns.set(e.aggregate_id, {
          takedown_id: e.aggregate_id,
          trigger_permission_id: p.trigger_permission_id,
          items: p.items ?? [],
          future_use_blocked: p.future_use_blocked ?? "",
          listed_at: e.occurred_at,
          executed: [],
        });
        break;
      case "ASSET_TAKEN_DOWN": {
        const order = state.takedowns.get(p.takedown_id);
        if (order) order.executed.push({ at: e.occurred_at, ...p });
        const asset = state.assets.get(p.asset_id);
        const v = asset?.versions.get(p.version_id);
        if (v) {
          v.takedown_ids.push(p.takedown_id);
          v.takedown_release_ids = new Set([...(v.takedown_release_ids ?? []), p.release_id].filter(Boolean));
          // 版本整体下架仅当其全部已批准发布都已下架；在其他合法渠道仍可继续，避免牵连
          const approved = [...state.releases.values()].filter(
            (r) => r.asset_id === p.asset_id && r.version_id === p.version_id && r.decision === "approved"
          );
          v.taken_down = approved.length > 0 && approved.every((r) => r.taken_down);
        }
        if (p.release_id) {
          const rel = state.releases.get(p.release_id);
          if (rel) rel.taken_down = true;
        }
        break;
      }
      default:
        break;
    }
  }
  return state;
}
