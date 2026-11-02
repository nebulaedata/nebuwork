"""LawRefBook-style collection, with resumable caches and atomic versioned snapshots.

Only Python's standard library is required. NPC remains the official source;
optional GitHub imports retain a separate provenance and identity.
"""
import hashlib
import html
import http.cookiejar
import io
import json
import math
import os
import re
import shutil
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from contextlib import closing, contextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

NPC = "https://flk.npc.gov.cn"
NUM = r"[零〇一二三四五六七八九十百千万两0-9]+"
ARTICLE = re.compile(rf"^(第{NUM}条(?:之{NUM})?)\s*(.*)$")
SECTION = re.compile(rf"^(第{NUM}([编篇章节]))(?:\s|$)")
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
HEADERS = {"User-Agent": "Mozilla/5.0 LawCollection/1.0",
           "Accept": "application/json, text/plain, */*",
           "Origin": NPC, "Referer": NPC + "/search"}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def atomic_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temp.open("wb") as file:
            file.write(value if isinstance(value, bytes) else value.encode("utf-8"))
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def load_config(value):
    if not isinstance(value, dict):
        raise ValueError("任务输入必须是 JSON 对象")
    config = read_json(Path(__file__).with_name("settings.json"))
    unknown = set(value) - set(config)
    if unknown:
        raise ValueError(f"未知参数: {sorted(unknown)}")
    config.update(value)
    if not isinstance(config["sources"], list) or not config["sources"] or set(config["sources"]) - {"npc", "github"}:
        raise ValueError("sources 必须是 npc/github 的非空数组")
    for key in ("max_pages", "max_documents", "refresh_days", "request_retries"):
        if type(config[key]) is not int or not 0 <= config[key] <= 100000:
            raise ValueError(f"{key} 必须是非负整数")
    if type(config["page_size"]) is not int or not 1 <= config["page_size"] <= 100:
        raise ValueError("page_size 必须在 1..100 之间")
    for key in ("request_interval", "request_timeout"):
        if type(config[key]) not in (int, float) or not math.isfinite(config[key]) or config[key] < 0:
            raise ValueError(f"{key} 必须是非负有限数字")
    if config["request_timeout"] == 0:
        raise ValueError("request_timeout 必须大于 0")
    if type(config["download_workers"]) is not int or not 1 <= config["download_workers"] <= 8:
        raise ValueError("download_workers 必须在 1..8 之间")
    for key in ("force_refresh", "dry_run", "publish_to_workflow", "allow_partial", "cache_only"):
        if type(config[key]) is not bool:
            raise ValueError(f"{key} 必须是布尔值")
    for key in ("type_codes", "status_codes"):
        if not isinstance(config[key], list) or any(type(code) is not int for code in config[key]):
            raise ValueError(f"{key} 必须是整数数组")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", config["github_repo"]):
        raise ValueError("github_repo 格式应为 owner/repository")
    output = Path(config["output_dir"])
    if not output.is_absolute():
        raise ValueError("output_dir 必须是绝对路径")
    config["output_dir"] = str(output.resolve())
    if config["cached_catalog_path"] is not None:
        path = Path(config["cached_catalog_path"])
        if not path.is_absolute() or not path.is_file():
            raise ValueError("cached_catalog_path 必须是已有目录 JSON 文件的绝对路径")
    if not isinstance(config["snapshot_inputs"], list):
        raise ValueError("snapshot_inputs 必须是已有快照根目录的数组")
    for directory in config["snapshot_inputs"]:
        if not isinstance(directory, str) or not Path(directory).is_absolute():
            raise ValueError("snapshot_inputs 必须包含绝对路径")
        if current_snapshot(directory) is None:
            raise ValueError(f"没有可导入的已发布快照: {directory}")
    return config


class SourceBlockedError(RuntimeError):
    """Stop batch requests when the source requires access verification."""


class LimitedRedirects(urllib.request.HTTPRedirectHandler):
    max_repeats = 1


class Client:
    def __init__(self, config):
        self.config = config
        self.last_request = 0
        self.request_lock = threading.Lock()
        self.blocked = threading.Event()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), LimitedRedirects())

    def get(self, url, payload=None, binary=False, max_bytes=100 * 1024 * 1024):
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = dict(HEADERS)
        if data is not None:
            headers["Content-Type"] = "application/json;charset=UTF-8"
        for attempt in range(self.config["request_retries"] + 1):
            if self.blocked.is_set():
                raise SourceBlockedError("来源防护已触发，本轮停止网络请求，保留缓存并等待补采")
            with self.request_lock:
                time.sleep(max(0, self.config["request_interval"] - (time.monotonic() - self.last_request)))
                self.last_request = time.monotonic()
            try:
                request = urllib.request.Request(url, data=data, headers=headers)
                with self.opener.open(request, timeout=self.config["request_timeout"]) as response:
                    raw = response.read(max_bytes + 1)
                if len(raw) > max_bytes:
                    raise ValueError("响应超过大小限制")
                if binary:
                    return raw
                try:
                    result = json.loads(raw.decode("utf-8-sig"))
                except (ValueError, UnicodeDecodeError) as error:
                    self.blocked.set()
                    raise SourceBlockedError("来源没有返回接口 JSON，可能需要访问验证；本轮停止请求") from error
                if not isinstance(result, dict):
                    raise ValueError("接口返回非 JSON 对象")
                if result.get("code", 200) not in (200, "200", 0, "0"):
                    raise ValueError(f"接口业务错误: {result.get('msg', result.get('code'))}")
                return result
            except urllib.error.HTTPError as error:
                if error.code in (302, 403):
                    self.blocked.set()
                    raise SourceBlockedError(f"来源返回 {error.code} 防护/重定向响应，本轮停止请求，不绕过验证") from error
                if error.code not in (408, 429, 500, 502, 503, 504) or attempt == self.config["request_retries"]:
                    raise
                retry_after = error.headers.get("Retry-After", "")
                delay = min(float(retry_after), 60) if retry_after.isdigit() else min(2 ** attempt, 30)
                time.sleep(delay)
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt == self.config["request_retries"]:
                    raise
                time.sleep(min(2 ** attempt, 30))


def current_snapshot(output):
    root = Path(output).resolve()
    pointer = root / "current.json"
    if not pointer.exists():
        return None
    snapshot = (root / read_json(pointer)["snapshot"]).resolve()
    if not snapshot.is_relative_to(root / "snapshots") or not (snapshot / "db.sqlite3").is_file():
        raise ValueError("current.json 指向无效快照")
    return snapshot


def stored_records(output):
    snapshot = current_snapshot(output)
    if snapshot is None:
        return {}
    with closing(sqlite3.connect(snapshot / "db.sqlite3")) as db:
        return {(source, source_id): json.loads(record) for source, source_id, record in
                db.execute("SELECT source, source_id, record_json FROM laws")}


def prepare(ctx):
    config = load_config(ctx.input)
    ctx.task.save_json("config", config)
    ctx.log(f"采集来源 {config['sources']}；输出 {config['output_dir']}；试运行 {config['dry_run']}")
    ctx.progress(100, "参数校验完成")


def list_npc(ctx):
    config = ctx.task.read("prepare", "config")
    if "npc" not in config["sources"] or config["snapshot_inputs"]:
        ctx.task.save_json("catalog", {"records": [], "complete": True, "total": 0})
        return
    if config["cached_catalog_path"]:
        catalog = read_json(config["cached_catalog_path"])
        if not isinstance(catalog.get("records"), list) or not isinstance(catalog.get("complete"), bool):
            raise ValueError("缓存目录格式无效")
        if any(not isinstance(item, dict) or item.get("source") != "npc" or not item.get("source_id") or not item.get("title") for item in catalog["records"]):
            raise ValueError("缓存目录条目无效")
        ctx.task.save_json("catalog", catalog)
        ctx.log(f"使用已保存的官方目录 {len(catalog['records'])} 个版本，不重复访问来源")
        return
    if config["cache_only"]:
        raise ValueError("cache_only 需要 cached_catalog_path")
    client, records, seen = Client(config), [], set()
    page, total, complete = 1, 0, False
    while True:
        payload = {"searchRange": 1, "sxrq": [], "gbrq": [], "searchType": 2,
                   "sxx": config["status_codes"], "gbrqYear": [], "flfgCodeId": config["type_codes"],
                   "zdjgCodeId": [], "searchContent": "", "orderByParam": {"order": "gbrq", "sort": "DESC"},
                   "pageNum": page, "pageSize": config["page_size"]}
        response = client.get(NPC + "/law-search/search/list", payload)
        if "rows" not in response or not isinstance(response["rows"], list):
            raise ValueError("官方目录响应缺少 rows，停止采集，保留已有库")
        total = int(response.get("total", 0))
        rows = response["rows"]
        if not rows:
            if len(records) < total:
                raise ValueError("分页目录提前为空，拒绝把不完整目录当成完整同步")
            complete = True
            break
        added = 0
        for row in rows:
            source_id = str(row.get("bbbs", ""))
            title = html.unescape(re.sub(r"<[^>]+>", "", row.get("title", ""))).strip()
            if not source_id or not title:
                raise ValueError("官方目录条目缺少 bbbs/title")
            if source_id in seen:
                continue
            seen.add(source_id)
            records.append({"source": "npc", "source_id": source_id, "title": title,
                            "category": row.get("flxz") or "其他", "type_code": row.get("flfgCodeId"),
                            "published_at": row.get("gbrq") or None, "effective_at": row.get("sxrq") or None,
                            "authority": row.get("zdjgName") or "", "status_code": row.get("sxx"),
                            "source_url": NPC + "/detail?bbbs=" + urllib.parse.quote(source_id)})
            added += 1
        if not added:
            raise ValueError("接口重复返回同一分页，停止以避免死循环")
        ctx.progress(min(99, len(records) * 100 / max(total, 1)), f"目录第 {page} 页，已发现 {len(records)}/{total}")
        if len(records) >= total and total:
            complete = True
            break
        if config["max_pages"] and page >= config["max_pages"]:
            break
        page += 1
        if page > 10000:
            raise ValueError("目录超过分页上限")
    ctx.task.save_json("catalog", {"records": records, "total": total, "complete": complete})
    ctx.progress(100, f"目录完成；完整扫描={complete}")


def paragraphs_from_docx(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entry = archive.getinfo("word/document.xml")
        if entry.file_size > 50 * 1024 * 1024:
            raise ValueError("Word 文档解压后过大")
        root = ET.fromstring(archive.read(entry))
    body = root.find(W + "body")
    if body is None:
        raise ValueError("Word 文档缺少正文")

    def text(element):
        parts = []
        for node in element.iter():
            if node.tag == W + "t":
                parts.append(node.text or "")
            elif node.tag == W + "tab":
                parts.append(" ")
            elif node.tag in (W + "br", W + "cr"):
                parts.append("\n")
        return "".join(parts).strip()

    lines = []
    for block in body:
        if block.tag == W + "p":
            lines.extend(line.strip() for line in text(block).splitlines() if line.strip())
        elif block.tag == W + "tbl":
            rows = []
            for row in block.findall(W + "tr"):
                cells = [text(cell).replace("\n", "<br>").replace("|", "\\|") for cell in row.findall(W + "tc")]
                if cells:
                    rows.append(cells)
            if rows:
                width = max(map(len, rows))
                table = ["| " + " | ".join(row + [""] * (width - len(row))) + " |" for row in rows]
                lines.extend(["<!-- TABLE -->", table[0], "| " + " | ".join(["---"] * width) + " |", *table[1:], "<!-- TABLE END -->"])
    if not lines:
        raise ValueError("Word 文档正文为空")
    return lines


def remove_toc(lines):
    """Remove a TOC only when its first heading repeats before the actual text."""
    start = next((i for i, line in enumerate(lines) if re.fullmatch(r"目\s*录", line)), None)
    if start is None:
        return lines
    first = next((line for line in lines[start + 1:] if SECTION.match(line)), None)
    if first:
        repeat = next((i for i in range(start + 2, len(lines)) if lines[i] == first), None)
        if repeat is not None:
            return lines[:start] + lines[repeat:]
    # With no exact repeated heading, retain content instead of guessing boundaries.
    return lines


def markdown_from_lines(record, lines):
    lines = remove_toc(lines)
    short = record["title"].removeprefix("中华人民共和国")
    if lines and lines[0] in (record["title"], short):
        lines = lines[1:]
    if not any(ARTICLE.match(line) for line in lines) and sum(len(line) for line in lines) < 80:
        raise ValueError("法律正文过短，拒绝发布空文档或错误页")
    header = ["# " + record["title"]]
    for key, label in (("published_at", "公布日期"), ("effective_at", "施行日期"), ("authority", "制定机关")):
        if record.get(key):
            header.append(f"{label}：{record[key]}")
    header.extend([f"来源：{record['source_url']}", "<!-- INFO END -->"])
    levels = {"编": 2, "篇": 2, "章": 3, "节": 4}
    content = []
    for line in lines:
        section = SECTION.match(line)
        article = ARTICLE.match(line)
        if section:
            content.append("#" * levels[section.group(2)] + " " + line)
        elif article:
            content.append(article.group(1) + " " + article.group(2))
        else:
            content.append(line)
    return "\n\n".join(header + content).strip() + "\n"


def parse_articles(markdown):
    body = markdown.split("<!-- INFO END -->", 1)[-1]
    articles, current, headings = [], None, {}
    in_table = False
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line == "<!-- TABLE -->":
            in_table = True
        elif line == "<!-- TABLE END -->":
            in_table = False
        heading = re.match(r"^(#{2,6})\s+(.*)$", line)
        if heading and not in_table:
            level = len(heading.group(1))
            headings = {key: value for key, value in headings.items() if key < level}
            headings[level] = heading.group(2)
            current = None
            continue
        match = ARTICLE.match(line) if not in_table else None
        if match:
            current = {"number": match.group(1), "heading_path": list(headings.values()), "text": line}
            articles.append(current)
        elif current is not None:
            current["text"] += "\n" + line
    return articles


def finish_record(record, markdown, checked_at=None):
    result = dict(record)
    result["markdown"] = markdown
    result["content_hash"] = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    result["metadata_hash"] = digest({key: record.get(key) for key in (
        "source", "source_id", "title", "category", "type_code", "published_at", "effective_at",
        "authority", "status_code", "source_url")})
    result["record_hash"] = digest([result["metadata_hash"], result["content_hash"]])
    result["checked_at"] = checked_at or now()
    return result


def repository_dates(markdown):
    """Only explicit metadata events establish dates; filename dates stay separate."""
    header = markdown.split("<!-- INFO END -->", 1)[0]
    published, effective = [], []
    for match in re.finditer(r"(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(.*?)(?=\d{4}年|\n|$)", header):
        year, month, day, event = match.groups()
        try:
            date = datetime(int(year), int(month), int(day)).date().isoformat()
        except ValueError:
            continue
        if re.search(r"公布|发布", event):
            published.append(date)
        if "施行" in event:
            effective.append(date)
    return max(published, default=None), max(effective, default=None)


def import_repo(ctx):
    config = ctx.task.read("prepare", "config")
    if "github" not in config["sources"] or config["snapshot_inputs"]:
        ctx.task.save_json("repository", {"records": [], "complete": True, "commit": None})
        return
    client = Client(config)
    repo = config["github_repo"]
    branch = urllib.parse.quote(config["github_branch"], safe="")
    commit = client.get(f"https://api.github.com/repos/{repo}/commits/{branch}")["sha"]
    tree = client.get(f"https://api.github.com/repos/{repo}/git/trees/{commit}?recursive=1")
    if tree.get("truncated"):
        raise ValueError("GitHub 目录被截断，拒绝不完整导入")
    files = [entry for entry in tree["tree"] if entry["type"] == "blob" and entry["path"].endswith(".md")
             and len(Path(entry["path"]).parts) > 1 and not entry["path"].startswith((".", "scripts/", "scrape/", "DLC/"))]
    existing = stored_records(config["output_dir"])

    def reusable(entry):
        cached = existing.get(("github", repo + ":" + entry["path"]))
        return cached and cached.get("git_blob") == entry["sha"] and cached.get("parser_version") == 2 and not config["force_refresh"]

    archive = None
    prefix = ""
    if not config["max_documents"] and any(not reusable(entry) for entry in files):
        archive_path = Path(config["output_dir"]) / ".cache" / f"github-{digest(repo)[:16]}-{commit}.zip"
        if not archive_path.exists():
            ctx.log(f"下载固定提交的仓库快照，准备导入 {len(files)} 份存量文件")
            raw = client.get(f"https://codeload.github.com/{repo}/zip/{commit}", binary=True)
            atomic_write(archive_path, raw)
        archive = zipfile.ZipFile(archive_path)
        prefix = archive.namelist()[0].split("/", 1)[0] + "/"
    records, downloads, skipped, complete = [], 0, 0, True
    try:
        for index, entry in enumerate(files):
            path = entry["path"]
            source_id = repo + ":" + path
            cached = existing.get(("github", source_id))
            if reusable(entry):
                records.append(cached)
                skipped += 1
                continue
            if config["max_documents"] and downloads >= config["max_documents"]:
                complete = False
                break
            if archive is not None:
                info = archive.getinfo(prefix + path)
                if info.file_size > 20 * 1024 * 1024:
                    raise ValueError(f"仓库正文过大: {path}")
                raw = archive.read(info)
            else:
                raw = client.get(f"https://raw.githubusercontent.com/{repo}/{commit}/" + urllib.parse.quote(path, safe="/"), binary=True)
            blob_hash = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\x00" + raw).hexdigest()
            if blob_hash != entry["sha"]:
                raise ValueError(f"仓库正文与固定提交哈希不一致: {path}")
            markdown = raw.decode("utf-8-sig")
            if not markdown.strip():
                raise ValueError(f"仓库存在空正文，不能标记全量导入完成: {path}")
            title_match = re.search(r"^#\s+(.+)", markdown, flags=re.MULTILINE)
            title = re.sub(r"<!--.*?-->", "", title_match.group(1)).strip() if title_match else re.sub(r"(?:\(|（)\d{4}-\d{2}-\d{2}(?:\)|）)$", "", Path(path).stem)
            repaired = "<!-- INFO END -->" not in markdown
            if repaired:
                # Older repository files have no metadata delimiter. Preserve their entire text.
                markdown = f"# {title}\n\n<!-- INFO END -->\n\n" + markdown
            date = re.search(r"(?:\(|（)(\d{4}-\d{2}-\d{2})(?:\)|）)", Path(path).stem)
            published_at, effective_at = repository_dates(markdown)
            record = {"source": "github", "source_id": source_id, "title": title,
                      "category": str(Path(path).parent).replace("\\", "/"), "published_at": published_at,
                      "effective_at": effective_at, "filename_date": date.group(1) if date else None,
                      "authority": "", "status_code": None, "parser_version": 2, "format_repaired": repaired,
                      "source_url": f"https://github.com/{repo}/blob/{commit}/" + urllib.parse.quote(path, safe="/"),
                      "git_blob": entry["sha"], "repository_path": path, "repository_commit": commit}
            records.append(finish_record(record, markdown))
            downloads += 1
            if index % 20 == 0 or index == len(files) - 1:
                ctx.progress((index + 1) * 100 / max(len(files), 1), f"参考仓库存量已导入 {len(records)}/{len(files)} 份")
    finally:
        if archive is not None:
            archive.close()
    ctx.task.save_json("repository", {"records": records, "commit": commit, "complete": complete,
                                      "total": len(files), "downloaded": downloads, "skipped": skipped})


def fetch_parse(ctx):
    config = ctx.task.read("prepare", "config")
    catalog = ctx.task.read("list_npc", "catalog")
    repository = ctx.task.read("import_repo", "repository")
    if config["snapshot_inputs"]:
        imported = {}
        complete = True
        for directory in config["snapshot_inputs"]:
            snapshot = current_snapshot(directory)
            complete = complete and bool(read_json(snapshot / "summary.json").get("complete", False))
            for key, record in stored_records(directory).items():
                if record["source"] not in config["sources"]:
                    continue
                if key not in imported or record["checked_at"] > imported[key]["checked_at"]:
                    imported[key] = record
        ctx.task.save_json("bundle", {"records": list(imported.values()), "failures": [],
            "downloaded": 0, "skipped": len(imported), "complete": complete, "npc_total": 0,
            "repository_commit": None, "imported_snapshots": config["snapshot_inputs"]})
        ctx.log(f"从现有快照导入 {len(imported)} 份文件，无需重新采集")
        return
    existing = stored_records(config["output_dir"])
    client, results, failures = Client(config), list(repository["records"]), []
    downloaded, skipped = 0, 0
    complete = catalog["complete"] and repository["complete"]
    pending = []
    cache_dir = Path(config["output_dir"]) / ".cache" / "npc-records"
    for item in catalog["records"]:
        cached = existing.get(("npc", item["source_id"]))
        cache_path = cache_dir / (digest(item["source_id"]) + ".json")
        if cache_path.exists():
            checkpoint = read_json(cache_path)
            if cached is None or checkpoint["checked_at"] > cached["checked_at"]:
                cached = checkpoint
        meta_hash = digest({key: item.get(key) for key in (
            "source", "source_id", "title", "category", "type_code", "published_at", "effective_at",
            "authority", "status_code", "source_url")})
        fresh = cached and time.time() - datetime.fromisoformat(cached["checked_at"]).timestamp() < config["refresh_days"] * 86400
        if cached and fresh and cached["metadata_hash"] == meta_hash and not config["force_refresh"]:
            results.append(cached)
            skipped += 1
            continue
        if config["max_documents"] and len(pending) >= config["max_documents"]:
            complete = False
            continue
        if config["cache_only"]:
            failures.append({"source_id": item["source_id"], "title": item["title"], "deferred": True,
                             "error": "官方来源防护期间暂未下载；等待补采，未将缺失正文当成已完成"})
            continue
        pending.append((item, cache_path))

    def download_one(item, cache_path):
        try:
            response = client.get(NPC + "/law-search/download/pc?format=docx&bbbs=" + urllib.parse.quote(item["source_id"]))
            url = (response.get("data") or {}).get("url")
            if not url or urllib.parse.urlparse(url).scheme != "https":
                raise ValueError("官方接口未返回 HTTPS 下载链接")
            raw = client.get(url, binary=True, max_bytes=50 * 1024 * 1024)
            lines = paragraphs_from_docx(raw)
            result = finish_record(item, markdown_from_lines(item, lines))
            if not config["dry_run"]:
                atomic_write(cache_path, json_text(result))
            return result, None
        except Exception as error:
            return None, {"source_id": item["source_id"], "title": item["title"], "error": str(error),
                          "deferred": isinstance(error, SourceBlockedError)}

    ctx.log(f"官方目录 {len(catalog['records'])} 份；复用 {skipped}，待下载 {len(pending)}；并发 {config['download_workers']}，请求统一限速")
    with ThreadPoolExecutor(max_workers=config["download_workers"]) as executor:
        jobs = [executor.submit(download_one, item, cache_path) for item, cache_path in pending]
        for index, job in enumerate(as_completed(jobs), 1):
            record, failure = job.result()
            if failure:
                failures.append(failure)
                ctx.log(f"采集失败 {failure['title']}：{failure['error']}")
            else:
                results.append(record)
                downloaded += 1
            ctx.progress(index * 100 / max(len(pending), 1), f"已获取 {downloaded}，缓存复用 {skipped}，失败 {len(failures)}；本轮 {index}/{len(pending)}")
    bundle = {"records": results, "failures": failures, "downloaded": downloaded, "skipped": skipped,
              "complete": complete and not failures, "npc_total": catalog["total"], "npc_scanned": len(catalog["records"]),
              "github_total": repository.get("total", 0), "github_imported": len(repository["records"]),
              "repository_commit": repository["commit"]}
    ctx.task.save_json("bundle", bundle)
    if failures and not config["allow_partial"]:
        raise RuntimeError(f"{len(failures)} 份文档失败，已保存失败清单；未发布新快照，重跑 fetch_parse 可重试")


def compare_records(existing, records):
    changes = []
    counts = {"added": 0, "updated": 0, "unchanged": 0}
    for record in records:
        old = existing.get((record["source"], record["source_id"]))
        kind = "added" if old is None else "unchanged" if old["record_hash"] == record["record_hash"] else "updated"
        counts[kind] += 1
        if kind != "unchanged":
            changes.append({"kind": kind, "source": record["source"], "source_id": record["source_id"],
                            "title": record["title"], "published_at": record.get("published_at"),
                            "old_hash": old["record_hash"] if old else None, "new_hash": record["record_hash"]})
    return counts, changes


def diff(ctx):
    config = ctx.task.read("prepare", "config")
    bundle = ctx.task.read("fetch_parse", "bundle")
    bundle["counts"], bundle["changes"] = compare_records(stored_records(config["output_dir"]), bundle["records"])
    ctx.task.save_json("changes", bundle)
    ctx.log(f"差异检查 {bundle['counts']}，完整扫描={bundle['complete']}")


@contextmanager
def output_lock(output):
    output.mkdir(parents=True, exist_ok=True)
    with (output / ".publish.lock").open("a+b") as file:
        file.seek(0)
        if not file.read(1):
            file.write(b"0")
            file.flush()
        file.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            file.seek(0)
            if os.name == "nt":
                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(file, fcntl.LOCK_UN)


def initialize_db(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS laws (
            source TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT NOT NULL,
            category TEXT NOT NULL, published_at TEXT, effective_at TEXT,
            authority TEXT, status_code INTEGER, content_hash TEXT NOT NULL,
            record_hash TEXT NOT NULL, checked_at TEXT NOT NULL, record_json TEXT NOT NULL,
            PRIMARY KEY(source, source_id));
        CREATE TABLE IF NOT EXISTS law_history (
            source TEXT NOT NULL, source_id TEXT NOT NULL, record_hash TEXT NOT NULL,
            captured_at TEXT NOT NULL, record_json TEXT NOT NULL,
            PRIMARY KEY(source, source_id, record_hash));
        CREATE TABLE IF NOT EXISTS articles (
            source TEXT NOT NULL, source_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
            number TEXT NOT NULL, heading_path TEXT NOT NULL, text TEXT NOT NULL,
            PRIMARY KEY(source, source_id, ordinal));
        CREATE TABLE IF NOT EXISTS sync_runs (
            task_id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, summary_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS laws_title ON laws(title);
        CREATE INDEX IF NOT EXISTS laws_publication ON laws(published_at);
    """)


def safe_name(value):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(". ")[:100] or "未分类"


def write_snapshot(config, records, summary, task_id):
    output = Path(config["output_dir"])
    with output_lock(output):
        previous = current_snapshot(output)
        existing = stored_records(output)
        summary = dict(summary)
        summary["counts"], summary["changes"] = compare_records(existing, records)
        stage = output / "snapshots" / (".staging-" + uuid.uuid4().hex)
        stage.mkdir(parents=True)
        try:
            database = stage / "db.sqlite3"
            if previous:
                shutil.copyfile(previous / "db.sqlite3", database)
            with closing(sqlite3.connect(database)) as db:
                initialize_db(db)
                for record in records:
                    values = [record.get(key) for key in ("source", "source_id", "title", "category", "published_at",
                              "effective_at", "authority", "status_code", "content_hash", "record_hash", "checked_at")]
                    db.execute("INSERT OR REPLACE INTO laws VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", values + [json_text(record)])
                    db.execute("INSERT OR IGNORE INTO law_history VALUES(?,?,?,?,?)", (record["source"], record["source_id"],
                               record["record_hash"], now(), json_text(record)))
                    if not existing.get((record["source"], record["source_id"])) or existing[(record["source"], record["source_id"])]["record_hash"] != record["record_hash"]:
                        db.execute("DELETE FROM articles WHERE source=? AND source_id=?", (record["source"], record["source_id"]))
                        for ordinal, article in enumerate(parse_articles(record["markdown"]), 1):
                            db.execute("INSERT INTO articles VALUES(?,?,?,?,?,?)", (record["source"], record["source_id"], ordinal,
                                       article["number"], json_text(article["heading_path"]), article["text"]))
                summary["total_stored"] = db.execute("SELECT COUNT(*) FROM laws").fetchone()[0]
                summary["article_count"] = db.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
                summary["history_count"] = db.execute("SELECT COUNT(*) FROM law_history").fetchone()[0]
                summary["source_counts"] = dict(db.execute("SELECT source, COUNT(*) FROM laws GROUP BY source"))
                summary["official_status_counts"] = {str(status): count for status, count in
                    db.execute("SELECT status_code, COUNT(*) FROM laws WHERE source='npc' GROUP BY status_code")}
                summary["completed_at"] = now()
                db.execute("INSERT OR REPLACE INTO sync_runs VALUES(?,?,?)", (task_id, summary["completed_at"], json_text(summary)))
                db.commit()
                manifest = []
                for source, source_id, raw in db.execute("SELECT source, source_id, record_json FROM laws ORDER BY source, category, title"):
                    record = json.loads(raw)
                    suffix = hashlib.sha256(source_id.encode("utf-8")).hexdigest()[:16]
                    filename = safe_name(record["title"].removeprefix("中华人民共和国"))
                    filename += f"({record.get('published_at') or '日期未知'})-{suffix}.md"
                    path = Path("laws") / source / safe_name(record["category"]) / filename
                    atomic_write(stage / path, record["markdown"])
                    manifest.append({key: record.get(key) for key in ("source", "source_id", "title", "category", "published_at",
                                     "effective_at", "status_code", "source_url", "content_hash")})
                    manifest[-1]["path"] = path.as_posix()
                if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("SQLite 完整性检查失败")
            atomic_write(stage / "manifest.json", json_text(manifest))
            atomic_write(stage / "summary.json", json_text(summary))
            snapshot = output / "snapshots" / (safe_name(task_id) + "-" + uuid.uuid4().hex[:8])
            snapshot_root = (output / "snapshots").resolve()
            if not stage.resolve().is_relative_to(snapshot_root) or not snapshot.resolve().is_relative_to(snapshot_root):
                raise ValueError("快照路径超出输出目录")
            os.replace(stage, snapshot)
            atomic_write(output / "current.json", json_text({"snapshot": snapshot.relative_to(output).as_posix(),
                         "task_id": task_id, "completed_at": summary["completed_at"]}))
            return snapshot, summary
        finally:
            if stage.exists():
                if not stage.resolve().is_relative_to((output / "snapshots").resolve()):
                    raise ValueError("暂存目录超出输出目录，拒绝清理")
                shutil.rmtree(stage)


def persist(ctx):
    config = ctx.task.read("prepare", "config")
    bundle = ctx.task.read("diff", "changes")
    summary = {key: value for key, value in bundle.items() if key != "records"}
    summary["task_id"] = ctx.task_id
    summary["dry_run"] = config["dry_run"]
    if config["dry_run"]:
        summary["snapshot"] = None
        ctx.log("试运行完成，未发布数据快照")
    else:
        snapshot, summary = write_snapshot(config, bundle["records"], summary, ctx.task_id)
        summary["snapshot"] = str(snapshot)
        ctx.task.save_file("database", snapshot / "db.sqlite3")
        ctx.task.save_file("manifest", snapshot / "manifest.json")
        ctx.log(f"已发布快照 {snapshot}")
    ctx.task.save_json("summary", summary)


def export_workflow_storage(ctx, snapshot, summary):
    """Save independent, previewable text copies and downloadable snapshot files."""
    snapshot = Path(snapshot).resolve()
    manifest = read_json(snapshot / "manifest.json")
    try:
        previous = ctx.workflow.read("laws_manifest")
    except KeyError:
        previous = []
    previous = {(entry["source"], entry["source_id"]): entry for entry in previous}
    validated = []
    for entry in manifest:
        path = (snapshot / entry["path"]).resolve()
        if not path.is_relative_to(snapshot) or path.suffix != ".md":
            raise ValueError("正文索引指向无效路径，拒绝发布")
        markdown = path.read_text(encoding="utf-8")
        if hashlib.sha256(markdown.encode("utf-8")).hexdigest() != entry["content_hash"]:
            raise ValueError(f"正文哈希不一致: {entry['title']}")
        suffix = hashlib.sha256(entry["source_id"].encode("utf-8")).hexdigest()[:16]
        name = f"laws/{entry['source']}/{safe_name(entry['category'])[:40]}/{safe_name(entry['title'])[:60]}-{suffix}.md"
        entry["artifact_name"] = name
        validated.append((entry, path, markdown))
    # Package before staging any shared artifacts, so invalid files never become visible.
    archive_path = Path(ctx.work_dir) / "法律法规文件.zip"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in ("db.sqlite3", "manifest.json", "summary.json"):
            archive.write(snapshot / name, name)
        for entry, path, markdown in validated:
            archive.write(path, entry["path"])
    saved = 0
    for index, (entry, path, markdown) in enumerate(validated, 1):
        old = previous.get((entry["source"], entry["source_id"]))
        if not old or old.get("content_hash") != entry["content_hash"] or old.get("artifact_name") != entry["artifact_name"]:
            ctx.workflow.save_text(entry["artifact_name"], markdown)
            saved += 1
        if index % 50 == 0 or index == len(validated):
            ctx.progress(index * 100 / max(len(validated), 1), f"共享正文 {index}/{len(validated)}，本轮写入 {saved} 份")
    artifact_ids = {
        "laws_database": ctx.workflow.save_file("laws_database", snapshot / "db.sqlite3"),
        "laws_archive": ctx.workflow.save_file("laws_archive", archive_path),
        "laws_manifest": ctx.workflow.save_json("laws_manifest", manifest),
        "laws_failures": ctx.workflow.save_json("laws_failures", summary.get("failures", [])),
    }
    ctx.task.save_file("laws_archive", archive_path)
    summary = dict(summary, workflow_storage=True, stored_documents=len(manifest), storage_texts_updated=saved,
                   shared_artifacts=artifact_ids)
    ctx.workflow.save_json("latest_sync", summary)
    return summary


def publish_storage(ctx):
    config = ctx.task.read("prepare", "config")
    summary = ctx.task.read("persist", "summary")
    if not summary["dry_run"] and config["publish_to_workflow"]:
        summary = export_workflow_storage(ctx, summary["snapshot"], summary)
        catalog = ctx.task.read("list_npc", "catalog")
        if catalog["records"]:
            ctx.workflow.save_json("laws_catalog", catalog)
        ctx.log(f"工作流存储空间已保存 {summary['stored_documents']} 份正文及数据库、索引、ZIP 包")
    else:
        summary = dict(summary, workflow_storage=False)
        ctx.log("本次未发布到工作流存储空间")
    ctx.task.save_json("summary", summary)
    ctx.progress(100, "存储发布完成")


def report(ctx):
    summary = ctx.task.read("publish_storage", "summary")
    counts = summary["counts"]
    lines = ["# 法律法规采集更新报告", "", f"任务：{summary['task_id']}",
             f"库内总量 {summary.get('total_stored', '试运行未入库')}；来源数量 {summary.get('source_counts', {})}",
             f"新增 {counts['added']}，更新 {counts['updated']}，未变 {counts['unchanged']}",
             f"官方文档下载 {summary['downloaded']}，缓存复用 {summary['skipped']}",
             f"完整扫描：{summary['complete']}；试运行：{summary['dry_run']}",
             "同名不同公布日期及原地修订保留历史；目录缺失不自动认定废止。",
             "效力状态使用官方原始代码，不从目录缺失或版本先后推断。",
             "GitHub 内容单独标注来源，需以官方文本核验。", ""]
    if summary.get("failures"):
        lines.extend([f"待补采 {len(summary['failures'])} 份；本次结果不完整，成功正文已缓存，重跑只补缺失项。",
                      "失败明细在共享产物 laws_failures。"])
    if summary.get("snapshot"):
        lines.append(f"快照：{summary['snapshot']}")
    if summary.get("workflow_storage"):
        lines.append(f"工作流存储空间：已保存 {summary['stored_documents']} 份正文，包含数据库、索引及 ZIP 包")
    for change in summary["changes"]:
        lines.append(f"- {change['kind']}：{change['title']}（{change['published_at'] or '日期未知'}，{change['source']}）")
    text = "\n".join(lines) + "\n"
    ctx.task.save_text("report", text)
    if summary.get("workflow_storage"):
        ctx.workflow.save_text("laws_report", text)
    ctx.task.save_json("summary", summary)
    ctx.progress(100, "采集更新完成")
