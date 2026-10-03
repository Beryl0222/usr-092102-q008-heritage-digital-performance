// 景泰蓝制作技艺·数字演绎授权基线场景。
// 供端到端测试与数据种子共用：登记合法基线，返回全部稳定 id。
export const IDS = {
  element: "elt:jingtai",
  community: "comm:jingtailan-fang",
  holder: "party:zhang-dashi",
  apprentice: "party:li-xuedi",
  visitor: "party:wang-tiyan",
  enterprise: "party:media",
  operator: "party:operator",
  materials: {
    overview: "mat:pk-overview",
    firingStep: "mat:step-firing",
    pattern: "mat:pattern-changzhilian",
    story: "mat:story-jiulongbi",
    portraitLi: "mat:portrait-li",
    visitorWork: "mat:visitor-wang-work",
  },
  permissions: {
    holderPatternCn: "perm:holder-pattern-study-cn",
    communityOverseas: "perm:community-pattern-overseas",
    holderStepCn: "perm:holder-step-live-cn",
    holderDrama: "perm:holder-drama-all",
    mediaDrama: "perm:media-drama",
    holderSaleCn: "perm:holder-sale-shop-cn",
    liDeny: "perm:li-portrait-deny",
    holderTrainPattern: "perm:holder-train-pattern",
  },
  batches: {
    main: "batch:2026-09-modelx",
  },
  assets: {
    trailer: "asset:jingtai-trailer",
    tutorial: "asset:jingtai-tutorial",
    characterLi: "asset:character-li",
    greeting: "asset:greeting-card",
  },
  channels: {
    study: "ch:yanxue-class",
    overseas: "ch:overseas-festival",
    shop: "ch:gongfang-shop",
  },
  releases: {
    study: "rel:trailer-study-cn",
    overseas: "rel:trailer-overseas",
    shop: "rel:trailer-shop-cn",
  },
};

// 登记合法基线：技艺 / 共同体 / 素材 / 许可 / 批次 / 合规版本 / 三个渠道发布
export function buildBaseline(service) {
  const id = IDS;
  service.registerCommunity({ community_id: id.community, name: "景泰蓝坊传承共同体" });
  service.registerElement({
    element_id: id.element,
    name: "景泰蓝制作技艺",
    community_id: id.community,
    restricted_step_ids: [id.materials.firingStep],
  });

  service.registerMaterial({
    material_id: id.materials.overview,
    kind: "public_knowledge",
    element_id: id.element,
    community_id: id.community,
    title: "景泰蓝掐丝工艺公开概述",
    visibility: "public",
  });
  service.registerMaterial({
    material_id: id.materials.firingStep,
    kind: "restricted_step",
    element_id: id.element,
    community_id: id.community,
    holder_id: id.holder,
    holder_name: "张大师",
    title: "点蓝与烧蓝火候控制（现场展示受限步骤）",
    visibility: "restricted",
    detail: "釉料第八层配比与窑温曲线（仅限工坊现场，不得外传）",
  });
  service.registerMaterial({
    material_id: id.materials.pattern,
    kind: "traditional_pattern",
    element_id: id.element,
    community_id: id.community,
    holder_id: id.holder,
    holder_name: "张大师",
    title: "缠枝莲纹传统纹样",
  });
  service.registerMaterial({
    material_id: id.materials.story,
    kind: "story_material",
    element_id: id.element,
    community_id: id.community,
    title: "九龙璧传说素材",
  });
  service.registerMaterial({
    material_id: id.materials.portraitLi,
    kind: "participant_portrait",
    element_id: id.element,
    subject_party_id: id.apprentice,
    subject_name: "学徒小李",
    title: "学徒小李工坊现场肖像",
    visibility: "restricted",
  });
  // 线下体验者作品：默认不进入训练库
  service.registerMaterial({
    material_id: id.materials.visitorWork,
    kind: "offline_work",
    element_id: id.element,
    subject_party_id: id.visitor,
    subject_name: "体验者王某",
    title: "王某线下体验掐丝小盘",
  });

  const term = { valid_from: "2026-09-01T00:00:00+08:00", valid_until: "2027-12-31T23:59:59+08:00" };

  // 传承人：纹样/故事在国内研学渠道的展示与教学，15% 收益份额，须署名
  service.grantPermission({
    permission_id: id.permissions.holderPatternCn,
    grantor_id: id.holder,
    grantor_name: "张大师",
    grantor_type: "holder",
    material_ids: [id.materials.pattern, id.materials.story],
    rights: ["display", "teaching"],
    regions: ["CN"],
    channels: [id.channels.study],
    ...term,
    revenue_share_bps: 1500,
    attribution_required: true,
  });
  // 共同体约定：海外展示，10% 份额
  service.grantPermission({
    permission_id: id.permissions.communityOverseas,
    grantor_id: id.community,
    grantor_name: "景泰蓝坊传承共同体",
    grantor_type: "community",
    material_ids: [id.materials.pattern, id.materials.story],
    rights: ["display"],
    regions: ["*"],
    channels: [id.channels.overseas],
    ...term,
    revenue_share_bps: 1000,
    attribution_required: true,
  });
  // 受限步骤：只授权国内现场展示
  service.grantPermission({
    permission_id: id.permissions.holderStepCn,
    grantor_id: id.holder,
    grantor_name: "张大师",
    grantor_type: "holder",
    material_ids: [id.materials.firingStep],
    rights: ["display"],
    regions: ["CN"],
    channels: [id.channels.study],
    ...term,
  });
  // 传承人给传媒的改编授权（8%），企业下游许可必须引用且不得宽于上游
  service.grantPermission({
    permission_id: id.permissions.holderDrama,
    grantor_id: id.holder,
    grantor_name: "张大师",
    grantor_type: "holder",
    material_ids: [id.materials.pattern, id.materials.story],
    rights: ["display", "adaptation"],
    regions: ["*"],
    ...term,
    revenue_share_bps: 800,
    attribution_required: true,
  });
  service.grantPermission({
    permission_id: id.permissions.mediaDrama,
    grantor_id: id.enterprise,
    grantor_name: "某传媒",
    grantor_type: "enterprise",
    material_ids: [id.materials.pattern, id.materials.story],
    rights: ["display", "adaptation"],
    regions: ["*"],
    ...term,
    derived_from: id.permissions.holderDrama,
  });
  // 国内工坊销售：12% 份额
  service.grantPermission({
    permission_id: id.permissions.holderSaleCn,
    grantor_id: id.holder,
    grantor_name: "张大师",
    grantor_type: "holder",
    material_ids: [id.materials.pattern, id.materials.story],
    rights: ["display", "sale"],
    regions: ["CN"],
    channels: [id.channels.shop],
    ...term,
    revenue_share_bps: 1200,
    attribution_required: true,
  });
  // 学徒小李明确禁用：不得用其肖像改编或训练
  service.denyPermission({
    permission_id: id.permissions.liDeny,
    grantor_id: id.apprentice,
    grantor_name: "学徒小李",
    grantor_type: "holder",
    material_ids: [id.materials.portraitLi],
    rights: ["adaptation", "training"],
    regions: ["*"],
    valid_from: "2026-09-01T00:00:00+08:00",
    reason: "不同意以我的形象生成新角色或训练模型",
  });

  service.registerChannel({
    channel_id: id.channels.study,
    name: "非遗研学课堂",
    type: "teaching",
    regions: ["CN"],
    required_rights: ["display", "teaching"],
  });
  service.registerChannel({
    channel_id: id.channels.overseas,
    name: "海外非遗影像展",
    type: "display",
    regions: ["*"],
    required_rights: ["display"],
  });
  service.registerChannel({
    channel_id: id.channels.shop,
    name: "工坊线上商城",
    type: "sale",
    regions: ["CN"],
    required_rights: ["display", "sale"],
  });

  service.recordBatch({
    batch_id: id.batches.main,
    tool_name: "云锦生成器",
    tool_version: "3.2.1",
    model_version: "modelx-2026-08",
    prompt_ref: "prompts/jingtai-v1.yaml",
    training_corpus_ids: [],
  });

  // 合规预告版本：只用公开概述 + 纹样 + 故事，保留输入清单与工具版本
  service.generateAsset({
    asset_id: id.assets.trailer,
    version_id: "ver:trailer-v1",
    batch_id: id.batches.main,
    title: "景泰蓝AI短剧预告",
    intended_rights: ["display", "adaptation"],
    intended_region: "*",
    manifest: [
      { material_id: id.materials.overview, role: "reference_text" },
      { material_id: id.materials.pattern, role: "style" },
      { material_id: id.materials.story, role: "storyline" },
    ],
    human_edits: [
      { by: "editor:chen", at: "2026-09-10T10:00:00+08:00", description: "修正结尾字幕署名" },
    ],
  });

  // 与合规预告无关的独立作品（撤回时不应被牵连）
  service.generateAsset({
    asset_id: id.assets.greeting,
    version_id: "ver:greeting-v1",
    batch_id: id.batches.main,
    title: "景泰蓝纹电子贺卡",
    intended_rights: ["display"],
    intended_region: "*",
    manifest: [{ material_id: id.materials.overview, role: "reference_text" }],
  });

  const segments = [
    { start_sec: 0, end_sec: 10, material_ids: [id.materials.overview, id.materials.story] },
    { start_sec: 10, end_sec: 20, material_ids: [id.materials.pattern] },
    { start_sec: 20, end_sec: 30, material_ids: [id.materials.story, id.materials.pattern] },
  ];
  const study = service.reviewRelease({
    release_id: id.releases.study,
    channel_id: id.channels.study,
    asset_id: id.assets.trailer,
    version_id: "ver:trailer-v1",
    region: "CN",
    segments,
  });
  const overseas = service.reviewRelease({
    release_id: id.releases.overseas,
    channel_id: id.channels.overseas,
    asset_id: id.assets.trailer,
    version_id: "ver:trailer-v1",
    region: "FR",
    segments,
  });
  const shop = service.reviewRelease({
    release_id: id.releases.shop,
    channel_id: id.channels.shop,
    asset_id: id.assets.trailer,
    version_id: "ver:trailer-v1",
    region: "CN",
    segments,
  });
  return { reviews: { study, overseas, shop }, segments };
}
