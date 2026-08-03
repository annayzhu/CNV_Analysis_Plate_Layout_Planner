import assert from "node:assert/strict";
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
  assert.match(html, /八道排枪各行上样/);
  assert.match(html, /反应体系与用量/);
  assert.match(html, /class="unit-header">µL/);
  assert.doesNotMatch(html, /Ho_33001161_cn|Ho_33001153_cn|Ho_00021109_cn/);
  assert.doesNotMatch(html, /class="metric"/);
  assert.match(html, />EN<\/button>/);
  assert.doesNotMatch(html, /方法边界/);
  assert.doesNotMatch(html, /\b(?:uL|μL)\b/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});
