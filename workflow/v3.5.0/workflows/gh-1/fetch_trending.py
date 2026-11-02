"""采集 GitHub Trending 榜单。

支持 language / since 参数；使用 requests 抓取网页并解析 HTML。
无第三方 HTML 解析库依赖（仅用标准库 re），保证共享环境可跑。
"""

from __future__ import annotations

import re

import requests

TRENDING_URL = "https://github.com/trending"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# 单条项目卡片定位：每个项目一个 <article class="Box-row"> ... </article>
_ARTICLE_RE = re.compile(r'<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>(.*?)</article>', re.S)
_HREF_RE = re.compile(r'<a[^>]+href="/([^/"]+/[^/"]+)"[^>]*>')
_H1_RE = re.compile(r"<h2[^>]*>(.*?)</h2>", re.S)
_DESC_RE = re.compile(r'<p[^>]*class="[^"]*col-9[^"]*"[^>]*>(.*?)</p>', re.S)
_LANG_RE = re.compile(r'itemprop="programmingLanguage">([^<]+)</span>')
_STARS_RE = re.compile(r'href="/[^\s"]+/stargazers[^"]*"[^>]*>.*?</svg>\s*([\d,]+)', re.S)
_FORKS_RE = re.compile(r'href="/[^\s"]+/forks[^"]*"[^>]*>.*?</svg>\s*([\d,]+)', re.S)
_TOTAL_RE = re.compile(r"([\d,]+)")


def _clean(html: str) -> str:
    text = re.sub(r"<[^>]+>", "", html)
    return re.sub(r"\s+", " ", text).strip()


def _num(s: str) -> int:
    m = _TOTAL_RE.search(s or "")
    return int(m.group(1).replace(",", "")) if m else 0


def _parse_article(idx: int, block: str) -> dict:
    href_match = _HREF_RE.search(block)
    repo_path = href_match.group(1) if href_match else ""
    h1_match = _H1_RE.search(block)
    full_name = _clean(h1_match.group(1)) if h1_match else repo_path
    desc_match = _DESC_RE.search(block)
    desc = _clean(desc_match.group(1)) if desc_match else ""
    lang_match = _LANG_RE.search(block)
    lang = lang_match.group(1).strip() if lang_match else ""
    stars_match = _STARS_RE.search(block)
    forks_match = _FORKS_RE.search(block)

    # 榜单页会展示“今天新增 star”之类的增量（最后一个数字链接）
    today_stars_match = re.search(
        r'<a[^>]+href="/[^\s"]+/stargazers[^"]*"[^>]*>.*?</svg>\s*([\d,]+)', block, re.S
    )
    stars_total = _num(stars_match.group(1)) if stars_match else 0
    forks_total = _num(forks_match.group(1)) if forks_match else 0
    # 增量：取最后一个 stargazers 链接（页面里通常出现两次：总数 + 今天新增）
    all_star_numbers = re.findall(r'href="/[^\s"]+/stargazers[^"]*"[^>]*>.*?</svg>\s*([\d,]+)', block, re.S)
    stars_today = _num(all_star_numbers[-1]) if all_star_numbers else 0

    return {
        "rank": idx + 1,
        "name": full_name or repo_path,
        "url": f"https://github.com/{repo_path}" if repo_path else f"https://github.com/{full_name}",
        "description": desc,
        "language": lang,
        "stars": stars_total,
        "stars_today": stars_today,
        "forks": forks_total,
    }


def fetch_trending(language: str = "", since: str = "daily") -> list[dict]:
    """抓取 GitHub trending 榜单，返回项目列表（已按榜单顺序）。

    language: 如 "python" / "javascript"；空表示 all languages
    since: daily / weekly / monthly
    """
    url = TRENDING_URL + (f"/{language}" if language else "")
    params = {"since": since} if since else {}
    headers = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}

    resp = requests.get(url, params=params, headers=headers, timeout=30)
    resp.raise_for_status()
    html = resp.text

    articles = _ARTICLE_RE.findall(html)
    projects = [_parse_article(i, block) for i, block in enumerate(articles)]
    return projects


def run(ctx):
    """步骤入口：抓取 trending 榜单并保存为任务产物 trending。"""
    inp = ctx.input or {}
    language = (inp.get("language") or "").strip()
    since = (inp.get("since") or "daily").strip()

    ctx.log(f"开始抓取 GitHub Trending：language={language or 'all'}, since={since}")
    projects = fetch_trending(language=language, since=since)
    if not projects:
        raise RuntimeError("未解析到任何项目，可能页面结构变化或网络异常")

    ctx.task.save_json("trending", {
        "language": language or "all",
        "since": since,
        "count": len(projects),
        "projects": projects,
    })
    ctx.progress(100, f"采集完成：{len(projects)} 个项目")
    ctx.emit("trending", {"count": len(projects), "language": language or "all", "since": since})
