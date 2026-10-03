import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { computeTakedown, recheckRelease } from "../src/compliance.js";
import { buildDomain } from "../src/domain.js";
import { publicProvenance, segmentAttribution } from "../src/provenance.js";
import { renderProvenancePage } from "../src/publicPage.js";
import { auditRevenue } from "../src/revenue.js";
import { EventStore } from "../src/store.js";

const events = JSON.parse(readFileSync(new URL("../data/scenario.json", import.meta.url), "utf8"));
const store = new EventStore(events);
const domain = buildDomain(store);

const line = (title) => console.log(`\n== ${title} ==`);

line("发布审核复核（2026-10-02 视角）");
for (const id of ["rel-trailer-v1", "rel-trailer-v2", "rel-highlights", "rel-study", "rel-overseas", "rel-kit"]) {
  const r = recheckRelease(domain, id, "2026-10-02T00:00:00+08:00");
  console.log(`${id}：审核时 ${r.reviewed_as} → 现在 ${r.now}`);
  for (const f of r.findings) console.log(`  - ${f}`);
}

line("这一秒画面依据什么（预告 v1）");
for (const second of [3, 8, 20]) {
  const seg = segmentAttribution(domain, "asset-trailer-v1", second);
  console.log(`第 ${second} 秒：${seg.elements.map((e) => e.name).join("、") || "无登记来源"}`);
}

line("授权撤回后的精确下架清单（perm-participant）");
for (const item of computeTakedown(domain, "perm-participant")) {
  console.log(`${item.release_id}（${item.release_version}）：${item.reason}；涉及元素 ${item.elements.join("、")}，权利 ${item.rights.join("、")}`);
}

line("收入审计（rev-001 工坊材料包 12000 元）");
const audit = auditRevenue(domain, "rev-001");
console.log(`许可依据：${audit.licenses.map((l) => `${l.name}←${l.statements.map((s) => s.id).join("/")}`).join("；")}`);
console.log(`署名：${audit.attributions.map((a) => `${a.name}（${a.role}）`).join("、")}`);
console.log(`分配：${audit.allocation.map((a) => `${a.beneficiary} ${a.percent}% = ${a.amount} 元`).join("；")}`);
console.log(`处置：${audit.disposal}`);

line("公开溯源页");
const view = publicProvenance(domain, "rel-trailer-v2");
mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
const out = new URL("../dist/provenance-rel-trailer-v2.html", import.meta.url);
writeFileSync(out, renderProvenancePage(view));
console.log(`已生成 dist/provenance-rel-trailer-v2.html（技艺：${view.craft.project}；共同体：${view.craft.community}）`);
