# 非遗数字演绎授权

面向非遗数字演绎的授权后端：以事件追溯的方式把技艺项目、来源共同体、公开知识、受限步骤、传统纹样、故事素材、参与者肖像、生成批次与商业渠道建立细粒度关系，使任意一条已发布内容都能回答“这一秒画面依据什么、允许在哪用、收益归谁”。

## 目录

- `contracts/domain.schema.json`：领域事件信封及稳定枚举。信封字段（`event_id`/`event_type`/`aggregate_type`/`aggregate_id`/`occurred_at`/`version`/`summary`）保持不变，业务数据放在可选的 `payload` 对象里。
- `data/sample.json`：最小联调样例。
- `data/scenario.json`：景泰蓝完整场景事件流（47 条事件），覆盖授权、抵触、合议、生成、审核、收入、撤回与精确下架。
- `src/`：事件存储、领域读模型、权利解析、合议、合规审核、收益审计、溯源公开页。
- `scripts/demo.js`：场景演示。
- `tests/`：契约、权利、合议、合规、收益与场景的一致性检查。

## 领域词汇

**聚合**：`heritage_element`（技艺元素，按 `kind` 区分技艺项目/公开知识/受限步骤/传统纹样/故事素材/参与者肖像/体验作品）、`source_community`（来源共同体）、`usage_permission`（授权或禁用声明）、`generation_batch`（生成批次）、`generated_asset`（生成内容）、`commercial_channel`（商业渠道）、`distribution_release`（发布版本）、`collegial_case`（合议案件）、`revenue_record`（收入记录）。

**事件**：`COMMUNITY_REGISTERED`、`ELEMENT_CLASSIFIED`、`ELEMENT_LINKED`、`PERMISSION_GRANTED`、`PROHIBITION_DECLARED`、`PERMISSION_WITHDRAWN`、`COLLEGIAL_CASE_OPENED`、`COLLEGIAL_DECISION_RECORDED`、`BATCH_REGISTERED`、`ASSET_GENERATED`、`CHANNEL_REGISTERED`、`RELEASE_REVIEWED`、`TAKEDOWN_ISSUED`、`REVENUE_RECORDED`。

**权利维度**：`display`（展示）、`teaching`（教学）、`model_training`（模型训练）、`adaptation`（改编）、`sales`（销售）；地域（`territory`）与期限（`term`）是声明上的约束维度。

**声明来源**：`inheritor`（传承人）、`community_covenant`（共同体约定）、`enterprise_contract`（企业合同）、`participant`（参与者本人）。声明可作用于元素、项目或共同体三个层级。

## 核心规则

- **许可交集**：组合素材只能采用所有输入元素许可的交集；任一元素的禁用或合议未决都会把该权利排除。
- **抵触即合议**：授权与禁用同时有效，或不同来源给出矛盾的收益分配方案时，权利暂不可用（contested）并可立案合议。
- **禁用否决**：存在有效明确禁用的权利必须裁定 `prohibited`，多数票不得越过；无禁用时按多数票，平票从严。
- **肖像本人同意**：参与者肖像的授予只认本人声明，企业合同等其他来源的主张不生效。
- **线下默认**：线下体验者作品默认不进入训练库，只有针对该元素的明示授权才能解除。
- **生成留痕**：生成内容保留输入清单（可引用元素或其他资产，形成衍生链）、工具版本与人工修改记录。
- **撤回语义**：授权撤回后停止未来使用（历史审核结论不改写，复核可重新定性），并只列出真正包含被撤回素材、用到被撤回权利的已批准版本，无关内容不受牵连。
- **收入审计**：从一笔收入可核对许可依据、署名、按比例计算的分配方案与处置状态；涉及元素存在未决合议时暂缓分配。
- **公开页**：呈现技艺与创作者来源、素材清单、生成信息、许可范围与分段来源；受限步骤只显示标签，不带出细节内容。

## 本地检查

```bash
npm test    # 运行全部一致性检查
npm run demo  # 重放景泰蓝场景并生成公开溯源页 dist/provenance-rel-trailer-v2.html
```
