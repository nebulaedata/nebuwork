import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, unlink, rmdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const dir = await mkdtemp(new URL("../.explorer-test-", import.meta.url));
const names = [
  "api",
  "ui",
  "ParsedContent",
  "WikiContent",
  "ProcessingPipeline",
  "GraphCanvas",
];
try {
  for (const name of names) {
    const source = await readFile(
      new URL(
        "../src/" + name + (name === "api" ? ".ts" : ".tsx"),
        import.meta.url,
      ),
      "utf8",
    );
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"')
      .replace(/import "[^"\n]+\.css";?/g, "");
    await writeFile(dir + "/" + name + ".mjs", compiled);
  }
  const { WikiContent, cleanWikiContent, wikiHeadings } = await import(
    pathToFileURL(dir + "/WikiContent.mjs")
  );
  const text =
    '<!-- source-document:document:32 -->\n## 概览\n\n正文 [证据](source:1234-5678)\n\n[[相关页面]]\n\n<table><tr><td colspan="2">合并内容</td></tr></table>\n<!-- /source-document -->';
  const props = {
    text,
    pages: [{ id: "page-2", title: "相关页面" }],
    onSelectPage: () => {},
  };
  const wiki = renderToStaticMarkup(React.createElement(WikiContent, props));
  assert.ok(!wiki.includes("source-document"));
  assert.ok(wiki.includes("wiki-citation") && wiki.includes("来源 1"));
  assert.ok(wiki.includes("wiki-page-link") && wiki.includes("相关页面"));
  assert.ok(wiki.includes("<table>") && wiki.includes('colSpan="2"'));
  for (const h of wikiHeadings(text))
    assert.ok(wiki.includes('id="' + h.id + '"'));
  assert.ok(cleanWikiContent(text).includes("正文"));
  const related = renderToStaticMarkup(React.createElement(WikiContent, {
    ...props, text: "## 关联页面\n- [相关页面](#)\n- **相关页面**\n\n## 正文\n- [相关页面](#)\n"
  }));
  assert.equal((related.match(/class="wiki-page-link"/g) || []).length, 2);
  const unsafe = renderToStaticMarkup(
    React.createElement(WikiContent, {
      ...props,
      text: '<script>bad()</script><img src="https://example.com/tracker" onerror="bad()"><iframe src="https://example.com"></iframe><a href="javascript:bad()">恶意链接</a>\n\n[恶意](javascript:bad())',
    }),
  );
  for (const bad of [
    "<script",
    "<iframe",
    "<img",
    "onerror",
    "javascript:",
    "tracker",
  ])
    assert.ok(!unsafe.includes(bad), bad);
  const { PipelineView, progressLabel } = await import(
    pathToFileURL(dir + "/ProcessingPipeline.mjs")
  );
  const legacy = {
    id: "old",
    type: "ingest",
    state: "partially_failed",
    attempts: 1,
    stage: "graph",
    checkpoint: { parse: "succeeded", wiki: "succeeded", graph: "failed" },
    updated_at: "2026-10-23T00:00:20Z",
    error: { message: "真实失败原因" },
  };
  const history = renderToStaticMarkup(
    React.createElement(PipelineView, { task: legacy, connected: true }),
  );
  assert.ok(
    !history.includes("pipeline-axis") && !history.includes("pipeline-track"),
  );
  assert.ok(
    history.includes("真实失败原因") && history.includes("未记录阶段耗时"),
  );
  assert.ok(
    !history.includes("实时更新"),
    "terminal tasks must not claim they are live",
  );
  const pipeline = {
    run_id: "test",
    attempt: 1,
    status: "succeeded",
    started_at: "2026-10-23T00:00:00Z",
    finished_at: "2026-10-23T00:00:20Z",
    stages: [
      {
        name: "parse",
        status: "succeeded",
        started_at: "2026-10-23T00:00:00Z",
        finished_at: "2026-10-23T00:00:20Z",
      },
    ],
  };
  const timed = renderToStaticMarkup(
    React.createElement(PipelineView, {
      task: {
        ...legacy,
        state: "succeeded",
        error: undefined,
        checkpoint: { pipeline },
      },
      connected: true,
    }),
  );
  assert.ok(timed.includes("pipeline-axis") && timed.includes("20 秒"));
  assert.ok(
    progressLabel({
      status: "running",
      progress: {
        unit: "docx_block",
        total: 20,
        completed: 5,
        paragraphs: 4,
        tables: 1,
      },
    }).includes("内容块"),
  );
  assert.ok(
    !progressLabel({
      status: "running",
      progress: { unit: "docx_block", total: 20, completed: 5 },
    }).includes("页"),
  );
  assert.match(progressLabel({status:"running",progress:{unit:"chunk",total:664,completed:16,batch:2,batches:42,attempt:2,max_retries:2}}), /第 2 \/ 42 批 · 重试 1 \/ 2 · 已保存 16 \/ 664 个分块/);
  assert.ok(progressLabel({status:"running",progress:{total:16,completed:0,batch:1,batches:1,attempt:2,max_retries:2,retrying:true}}).includes("等待重试 2 / 2"));
  const { WikiBatchProgress } = await import(pathToFileURL(dir + "/ProcessingPipeline.mjs"));
  const batchUI = renderToStaticMarkup(React.createElement(WikiBatchProgress, {task:{...legacy, checkpoint:{wiki:"failed",wiki_batches:{batches:[{index:1,status:"failed",attempts:3},{index:2,status:"succeeded",attempts:1}]}}}}));
  assert.ok(batchUI.includes("仅补跑失败批次") && batchUI.includes("已保存 1 / 2 批"));
  const graphUI = renderToStaticMarkup(React.createElement(WikiBatchProgress, {stage:"graph",task:{...legacy,checkpoint:{graph:"failed",graph_batches:{batches:[{index:1,status:"failed",attempts:3,accepted_entities:2},{index:2,status:"succeeded",attempts:1}]}}}}));
  assert.ok(graphUI.includes("实体图谱分块") && graphUI.includes("仅补跑失败分块") && graphUI.includes("已保存 1 / 2 块"));
  assert.ok(progressLabel({name:"extract_graph",status:"running",progress:{total:3,completed:1,batch:2,batches:3,attempt:2,max_retries:2}}).includes("第 2 / 3 块"));
  const { graphLayout } = await import(pathToFileURL(dir + "/GraphCanvas.mjs"));
  const nodes = [{ name: "甲" }, { name: "乙" }, { name: "独立实体" }];
  const relations = [
    { source: "甲", target: "乙" },
    { source: "甲", target: "不存在" },
  ];
  const before = JSON.stringify({ nodes, relations });
  const positions = graphLayout(nodes, relations);
  assert.equal(positions.size, 3);
  for (const p of positions.values())
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.equal(
    JSON.stringify({ nodes, relations }),
    before,
    "layout must not mutate API data",
  );
  console.log(
    "PASS: Wiki markers, citations, links, tables, HTML safety; legacy/timed pipelines and engine units; graph layout",
  );
} finally {
  for (const name of names)
    await unlink(dir + "/" + name + ".mjs").catch(() => {});
  await rmdir(dir);
}
