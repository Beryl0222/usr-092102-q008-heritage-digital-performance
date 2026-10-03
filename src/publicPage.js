const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const list = (items) => items.map((item) => `<li>${item}</li>`).join("");

/** 渲染公开溯源页（纯函数，输入 publicProvenance 的视图模型）。 */
export function renderProvenancePage(view) {
  const territory = view.license.territory?.length ? view.license.territory.join("、") : "不限";
  const term = view.license.term
    ? `${view.license.term.start ?? "不限"} 至 ${view.license.term.end ?? "不限"}`
    : "不限";

  const generation = view.generation
    ? `<p>生成工具：${esc(view.generation.tool?.name)} ${esc(view.generation.tool?.version)}（批次 ${esc(view.generation.batch_id ?? "无")}）</p>
       <p>人工修改：${
         view.generation.human_edits.length
           ? view.generation.human_edits.map((e) => `${esc(e.editor)}：${esc(e.note)}`).join("；")
           : "无"
       }</p>`
    : "<p>非生成内容</p>";

  const segmentRows = view.segments
    .map((s) => `<tr><td>${esc(s.start)}s–${esc(s.end)}s</td><td>${esc(s.sources.join("、"))}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>来源公示：${esc(view.release.title)}</title>
<style>
body{font-family:system-ui,"Noto Sans SC",sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#222}
h1{font-size:1.5rem} h2{font-size:1.1rem;border-bottom:1px solid #ddd;padding-bottom:.2rem}
table{border-collapse:collapse} td,th{border:1px solid #ccc;padding:.3rem .6rem}
.meta{color:#666;font-size:.9rem}
</style>
</head>
<body>
<h1>${esc(view.release.title)}${view.release.release_version ? `（${esc(view.release.release_version)}）` : ""}</h1>
<p class="meta">发布渠道：${esc(view.release.channel)}；本次使用权利：${esc(view.release.rights.join("、"))}；审核时间：${esc(view.release.reviewed_at)}</p>

<section>
<h2>技艺与来源</h2>
<p>技艺项目：${esc(view.craft.project ?? "未关联")}</p>
<p>来源共同体：${esc(view.craft.community ?? "未关联")}</p>
</section>

<section>
<h2>创作者署名</h2>
<ul>${list(view.attributions.map((a) => `${esc(a.name)}（${esc(a.role)}）`))}</ul>
</section>

<section>
<h2>素材清单</h2>
<ul>${list(view.elements.map((e) => `${esc(e.name)}（${esc(e.kind_label)}）`))}</ul>
</section>

<section>
<h2>生成信息</h2>
${generation}
</section>

<section>
<h2>许可范围</h2>
<p>可用权利：${esc(view.license.rights.join("、") || "无")}；地域：${esc(territory)}；期限：${esc(term)}</p>
</section>

<section>
<h2>收益归属</h2>
<ul>${list(view.revenue_shares.map((s) => `${esc(s.beneficiary)}（${esc(s.role)}）：${esc(s.percent)}%`))}</ul>
</section>

<section>
<h2>分段来源</h2>
<table><thead><tr><th>时间段</th><th>依据素材</th></tr></thead><tbody>${segmentRows}</tbody></table>
</section>
</body>
</html>
`;
}
