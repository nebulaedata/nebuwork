"""抓取微博热搜榜。

数据源：https://weibo.com/ajax/side/hotSearch
该接口返回 JSON，data.realtime 为热搜条目列表，字段包含：
  - word / note       热搜词
  - num               热度值
  - label_name        标签（新/热/爆/沸/剧 等）
  - rank              排名
  - label             标签编号
  - is_ad             是否广告位
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx

API_URL = "https://weibo.com/ajax/side/hotSearch"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://weibo.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# 仅保留常见字段，便于展示
_KEEP_FIELDS = ("word", "note", "num", "rank", "label_name", "category", "flag")


def _clean_text(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _pick(entry):
    item = {"rank": entry.get("rank")}
    for field in _KEEP_FIELDS:
        if field in entry:
            item[field] = entry.get(field)
    if not item.get("word"):
        item["word"] = entry.get("note") or entry.get("title") or ""
    item["word"] = _clean_text(item["word"])
    if item.get("num") is not None:
        try:
            item["num"] = int(item["num"])
        except (TypeError, ValueError):
            pass
    return item


def _fetch_hot_list():
    """抓取热搜榜，返回 (items, raw_meta)。失败抛异常，让步骤失败。"""
    resp = httpx.get(
        API_URL,
        headers=HEADERS,
        timeout=15.0,
        follow_redirects=True,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    if data.get("ok") not in (1, None) and data.get("code") not in (200, "200", None):
        raise RuntimeError(f"接口返回非成功: code={data.get('code')} msg={data.get('msg')}")

    payload = data.get("data") or {}
    realtime = payload.get("realtime") or []
    if not realtime:
        raise RuntimeError("realtime 为空，可能接口结构变更或被反爬拦截")

    items = [_pick(e) for e in realtime]
    # 过滤空词
    items = [it for it in items if it.get("word")]
    if not items:
        raise RuntimeError("过滤后无有效热搜条目")

    meta = {
        "top_sum": payload.get("topSum"),
        "total": payload.get("total"),
        "last_modify_time": payload.get("lastModifyTime"),
    }
    return items, meta


def _to_markdown(items, meta, fetched_at):
    lines = [
        f"# 微博热搜榜",
        "",
        f"- 抓取时间：{fetched_at}",
    ]
    if meta.get("top_sum"):
        lines.append(f"- 总榜条目数：{meta.get('top_sum')}")
    lines += ["", "| 排名 | 热搜 | 热度 | 标签 |", "| ---: | :--- | ---: | :--- |"]
    for it in items:
        rank = it.get("rank", "")
        word = it.get("word", "").replace("|", "\\|")
        num = it.get("num")
        num_s = f"{num:,}" if isinstance(num, int) else ""
        label = it.get("label_name") or ""
        lines.append(f"| {rank} | {word} | {num_s} | {label} |")
    lines.append("")
    return "\n".join(lines)


def run(ctx):
    ctx.log("开始抓取微博热搜")
    items, meta = _fetch_hot_list()
    fetched_at = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")

    ctx.task.save_json("hot_search", {
        "fetched_at": fetched_at,
        "count": len(items),
        "meta": meta,
        "items": items,
    })

    md = _to_markdown(items, meta, fetched_at)
    ctx.task.save_text("hot_search.md", md)

    # 跨任务共享产物：每天一份 markdown，方便查看/订阅
    day = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
    ctx.workflow.save_text(f"weibo_hot_{day}", md)

    ctx.emit(
        "summary",
        {"count": len(items), "top3": [it.get("word") for it in items[:3]]},
    )
    ctx.progress(100, f"完成，共 {len(items)} 条热搜")
