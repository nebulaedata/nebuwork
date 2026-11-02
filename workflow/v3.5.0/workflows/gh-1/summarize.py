"""汇总/分析 GitHub 项目榜单。

对 trending 列表做语言分布、Star 统计、Top 项目等聚合分析，
输出 JSON 与 Markdown 两种产物，便于下游消费。
"""

from __future__ import annotations


def _aggregate(projects: list[dict]) -> dict:
    total_stars = sum(p.get("stars", 0) for p in projects)
    total_stars_today = sum(p.get("stars_today", 0) for p in projects)
    total_forks = sum(p.get("forks", 0) for p in projects)

    lang_dist: dict[str, int] = {}
    for p in projects:
        lang = (p.get("language") or "Unknown").strip() or "Unknown"
        lang_dist[lang] = lang_dist.get(lang, 0) + 1
    lang_sorted = sorted(lang_dist.items(), key=lambda kv: (-kv[1], kv[0]))

    top_by_stars = sorted(projects, key=lambda p: -p.get("stars", 0))[:5]
    top_by_today = sorted(projects, key=lambda p: -p.get("stars_today", 0))[:5]

    return {
        "count": len(projects),
        "total_stars": total_stars,
        "total_stars_today": total_stars_today,
        "total_forks": total_forks,
        "language_distribution": dict(lang_sorted),
        "top_by_stars": top_by_stars,
        "top_by_stars_today": top_by_today,
    }


def _to_markdown(payload: dict) -> str:
    agg = payload.get("aggregate", {})
    projects = payload.get("projects", [])
    lang = payload.get("language", "all")
    since = payload.get("since", "daily")

    lines: list[str] = []
    lines.append(f"# GitHub Trending 榜单 - {lang} ({since})")
    lines.append("")
    lines.append(f"- 项目数: **{payload.get('count', 0)}**")
    lines.append(f"- 总 Star: **{agg.get('total_stars', 0):,}**")
    lines.append(f"- 新增 Star（{since}）: **{agg.get('total_stars_today', 0):,}**")
    lines.append(f"- 总 Fork: **{agg.get('total_forks', 0):,}**")
    lines.append("")

    lines.append("## 语言分布")
    lines.append("")
    for k, v in agg.get("language_distribution", {}).items():
        lines.append(f"- {k}: {v}")
    lines.append("")

    lines.append("## 榜单明细")
    lines.append("")
    lines.append("| # | 项目 | 语言 | Star | 新增 Star | Fork | 简介 |")
    lines.append("|---:|------|------|----:|----------:|-----:|------|")
    for p in projects:
        desc = (p.get("description") or "").replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| {p.get('rank')} | [{p.get('name')}]({p.get('url')}) "
            f"| {p.get('language') or '-'} | {p.get('stars', 0):,} "
            f"| {p.get('stars_today', 0):,} | {p.get('forks', 0):,} | {desc} |"
        )
    lines.append("")

    lines.append("## Top 5 (按总 Star)")
    lines.append("")
    for p in agg.get("top_by_stars", []):
        lines.append(f"{p.get('rank')}. **{p.get('name')}** - {p.get('stars', 0):,} stars")
    lines.append("")

    lines.append("## Top 5 (按新增 Star)")
    lines.append("")
    for p in agg.get("top_by_stars_today", []):
        lines.append(f"{p.get('rank')}. **{p.get('name')}** - +{p.get('stars_today', 0):,} stars")
    lines.append("")

    return "\n".join(lines)


def run(ctx):
    payload = ctx.task.read("fetch_trending", "trending")
    if not isinstance(payload, dict) or not payload.get("projects"):
        raise RuntimeError("上游 trending 产物为空，无法汇总")

    projects = payload["projects"]
    agg = _aggregate(projects)
    ctx.log(f"汇总完成：{agg['count']} 个项目，总 star {agg['total_stars']}")

    ctx.task.save_json("summary", {
        "language": payload.get("language", "all"),
        "since": payload.get("since", "daily"),
        "count": payload.get("count", len(projects)),
        "aggregate": agg,
        "projects": projects,
    })
    ctx.task.save_text("summary.md", _to_markdown({
        "language": payload.get("language", "all"),
        "since": payload.get("since", "daily"),
        "count": payload.get("count", len(projects)),
        "aggregate": agg,
        "projects": projects,
    }))

    ctx.progress(100, "汇总完成")
    ctx.emit("summary", {
        "count": agg["count"],
        "top_languages": list(agg["language_distribution"].items())[:3],
    })
