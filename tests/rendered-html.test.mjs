import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the CNV planner shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>TaqMan CNV 板布局规划工具<\/title>/i);
  assert.match(html, /CNV Analysis 板布局规划工具/);
  assert.match(html, /支持 96\/384 孔、官方 duplex 与自建 multiplex/);
  assert.match(html, /10\.0 µL 体系计算/);
  assert.match(html, /请先完成左侧实验设置/);
  assert.match(html, /加样方式/);
  assert.match(html, /八道排枪直接上样/);
  assert.match(html, /A–H 纵向 · 复孔向右/);
  assert.match(html, /反应体系与用量/);
  assert.match(html, /class="layout-workbench"/);
  assert.match(html, /class="reaction-column"/);
  assert.match(html, /class="empty-state qpcr-empty-state card"/);
  assert.match(html, /class="ghost-plate"/);
  assert.match(html, /先添加样本和 CNV Assay/);
  assert.match(html, /载入示例/);
  assert.match(html, /系统会计算孔板数，并生成可点选、移动和编辑的布局/);
  assert.match(html, /class="unit-header">µL/);
  assert.doesNotMatch(html, /Ho_33001161_cn|Ho_33001153_cn|Ho_00021109_cn/);
  assert.doesNotMatch(html, /Unknown_001|Calibrator_2copy|GSTM1|GSTT1|RNase P/);
  assert.doesNotMatch(html, /class="metric"/);
  assert.match(html, />EN<\/button>/);
  assert.doesNotMatch(html, /方法边界/);
  assert.doesNotMatch(html, /\b(?:uL|μL)\b/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps instrument-copy guidance beside the plate actions", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../app/CnvPlanner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /className="copy-helper"/);
  assert.match(source, /复制含表头/);
  assert.match(source, /复制无表头/);
  assert.match(source, /两者都用于将当前板的样本列表直接粘贴到 QuantStudio\/SDS/);
  assert.doesNotMatch(source, /仪器样本列表预览|Instrument sample-list preview/);
  assert.match(source, /连续孔位上样/);
  assert.match(source, /9 mm 八道隔行/);
  assert.match(source, /A\/C\/E\/G\/I\/K\/M\/O/);
  assert.match(source, /className="loading-route-guide"/);
  assert.match(source, /row-route-marker/);
  assert.match(source, /每组 8 个样本纵向排列；复孔向右连续/);
  assert.match(source, /version: 5/);
  assert.match(source, /function loadExample\(\)/);
  assert.match(source, /function clearSamples\(\)/);
  assert.match(source, /setSamples\(\[\]\)/);
  assert.match(source, /autoSaveTimer/);
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(source, /载入示例/);
  assert.match(source, /样本录入区已清空/);
  assert.match(source, /migrateVerticalLoading/);
  assert.match(source, /migratePassMajor384/);
  assert.match(source, /先铺满第 1 轮全部列块，再开始第 2 轮/);
  assert.match(source, /defaultLoadingPattern\(type\)/);
  assert.match(source, /setLayoutPreset\("assay-major"\)/);
  assert.equal(
    source.match(/exportAllPlates\(plan, reactionSystem\)/g)?.length,
    1,
  );
  assert.match(css, /\.loading-pattern-option strong \{[^}]*font-size: 11px;/);
  assert.match(css, /\.ghost-plate \{[^}]*repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.section-heading-action \{/);
  assert.match(source, /loading-pattern-option selected is-static/);
  assert.doesNotMatch(source, /loading-pattern-option selected fixed/);
  assert.match(css, /\.control-column, \.result-column \{[^}]*align-content: start;/);
  assert.match(css, /\.plate-grid\.plate-96 \{[^}]*repeat\(12, var\(--well-size\)\)/);
  assert.match(css, /\.plate-grid\.plate-384 \{[^}]*--well-size: 32px;[^}]*repeat\(24, var\(--well-size\)\)/);
  assert.match(css, /@container \(max-width: 820px\)/);
  assert.match(source, /className="card reaction-card reaction-panel"/);
});
