"""OpenAI-compatible model client used by the nebuwork specflow runner.

This intentionally keeps no provider SDK dependency: the runtime ships only
pydantic, and the model gateway is an internal OpenAI-compatible endpoint.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from .prepare import write_json


class AccountBlocked(RuntimeError):
    pass


class DeadlineExceeded(RuntimeError):
    """Cooperative task deadline, distinct from provider or schema failure."""
    pass


def _strip_json(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*\n?(.*?)\n?```$", r"\1", text, flags=re.S).strip()
    return text


def _json_text(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class DirectClient:
    """Bounded JSON repair loop; mirrors the frozen workflow client contract."""

    def __init__(self, base_url, api_key, model, *, review_model=None, timeout=300,
                 max_tokens=None, on_call=None, work_dir=None,
                 temperature=0.0, extra_headers=None, thinking=True, deadline=None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.review_model = review_model or model
        self.timeout = timeout
        self.max_tokens = max_tokens or {}
        self.on_call = on_call
        self.work_dir = Path(work_dir) if work_dir else None
        self.temperature = temperature
        self.extra_headers = extra_headers or {}
        self.thinking = thinking
        self.deadline = deadline
        self.calls = 0
        self.total_seconds = 0.0
        self.total_tokens = 0

    def _max_tokens(self, stage):
        if stage.startswith("scope"):
            return int(self.max_tokens.get("scope", 4000))
        if stage.startswith("clause_inventory"):
            return int(self.max_tokens.get("inventory", 6000))
        if stage.startswith("clause_audit") or stage.startswith("audit"):
            return int(self.max_tokens.get("review", 8000))
        return int(self.max_tokens.get("extract", 8000))

    def _check_deadline(self):
        if self.deadline is not None and time.monotonic() >= self.deadline:
            raise DeadlineExceeded('deadline_exceeded')

    def _request(self, system, user, stage, thinking=None, max_tokens=None, output_schema=None, allow_compatibility_retry=True):
        self._check_deadline()
        model = self.review_model if stage.startswith(("scope_audit", "clause_audit", "audit")) else self.model
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
            "temperature": self.temperature,
            "max_tokens": max_tokens or self._max_tokens(stage),
        }
        if output_schema is not None:
            body['response_format'] = {'type': 'json_schema', 'json_schema': {
                'name': 'specflow_output', 'strict': True, 'schema': output_schema}}
        # False is reserved for retrying gateways which reject extra fields.
        # The actual desired setting comes from the runner configuration.
        if thinking is not False:
            body["thinking"] = {"type": "enabled" if self.thinking else "disabled"}
            body["chat_template_kwargs"] = {"enable_thinking": self.thinking}
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.base_url + "/chat/completions", data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer " + self.api_key)
        for key, value in self.extra_headers.items():
            req.add_header(key, value)
        started = time.time()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                raw = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:500]
            if exc.code in (401, 402, 403):
                raise AccountBlocked(f"provider_access_required (HTTP {exc.code})") from None
            if exc.code == 404 and ("model_not_found" in detail or "Model not exist" in detail):
                raise AccountBlocked("model_unavailable (HTTP 404)") from None
            if exc.code in (429, 500, 502, 503, 504):
                raise RuntimeError(f"transient_http_{exc.code}") from None
            if exc.code == 400 and thinking is not False and allow_compatibility_retry:
                # Preserve an increased output budget on compatibility retry.
                return self._request(system, user, stage, thinking=False, max_tokens=max_tokens, output_schema=output_schema)
            raise RuntimeError(f"model_api_http_{exc.code}: {detail}") from None
        text = ""
        try:
            choice = raw["choices"][0]
            text = choice.get("message", {}).get("content") or ""
            finish = choice.get("finish_reason")
        except (KeyError, IndexError, TypeError):
            raise RuntimeError("model_api_invalid_response") from None
        meta = {
            "response_id": raw.get("id"),
            "requested_model": model,
            "returned_model": raw.get("model"),
            "usage": raw.get("usage", {}),
            "seconds": round(time.time() - started, 3),
            "finish_reason": finish,
            "raw_text": text,
            "stage": stage,
            "prompt_sha256": hashlib.sha256(_json_text(body['messages']).encode('utf-8')).hexdigest(),
            "prompt_chars": len(system) + len(user),
            "request_max_tokens": body['max_tokens'],
            "response_format": body['response_format']['type'],
            "thinking_options_present": 'thinking' in body,
            "requested_thinking": self.thinking if 'thinking' in body else None,
            "compatibility_fallback": thinking is False,
        }
        if self.work_dir:
            trace_id = hashlib.sha256((stage + str(time.time_ns())).encode()).hexdigest()[:24]
            write_json(self.work_dir / 'model-responses' / (trace_id + '.json'), {**meta, 'stage': stage})
        return meta

    def call(self, instruction, payload, schema, stage, *, system_prompt=None, prompt_version=None):
        system = system_prompt or ""
        system += "\n输出必须满足JSON Schema:\n" + _json_text(schema.model_json_schema())
        user = instruction + "\n" + _json_text(payload)
        # Keep the response envelope close to the source for local models; an
        # empty record set still requires per-unit accounting, never bare {}.
        if stage.startswith("clause_audit"):
            required = schema.model_json_schema().get('required', [])
            user += "\n仅返回符合上述Schema的完整JSON对象，顶层必须包含" + "、".join(required) + "；逐主单元填写coverage和checks，若Schema要求则逐清单事项填写inventory_checks、逐最终记录填写applicability_checks。没有对应条目时相应数组为[]。"
        elif stage.startswith("clause_extract"):
            user += "\n仅返回符合上述Schema的完整JSON对象，包含records、coverage、issues；没有条款时records为[]，仍须逐主单元填写coverage及issues。"
        last_error = "unknown"
        last_text = ""
        last_parsed = None
        attempts = 0
        started = time.time()
        budget = {}
        for attempts in range(1, 4):
            try:
                meta = self._request(system, user, stage, output_schema=schema.model_json_schema(), **budget)
                if meta.get("finish_reason") == "length":
                    if 'max_tokens' in budget:
                        # Already grew once; a second truncation means the
                        # block is too dense — let the engine split it.
                        raise ValueError("incomplete_response_length")
                    budget['max_tokens'] = max(self._max_tokens(stage) + 4000,
                                               int(self._max_tokens(stage) * 1.5))
                    raise ValueError("incomplete_response_length_grow")
                last_text = meta["raw_text"]
                if meta.get("finish_reason") not in (None, "stop"):
                    raise ValueError("incomplete_response_" + str(meta.get("finish_reason")))
                # strict=False tolerates literal control characters inside
                # strings: OCR/LaTeX source text (form feeds, \t in formulas)
                # is quoted verbatim by the model, and rejecting the whole
                # response would deterministically fail the block on retry.
                parsed = json.loads(_strip_json(last_text), strict=False)
                if not isinstance(parsed, dict):
                    raise ValueError("json_object_required")
                last_parsed = parsed
                valid = schema.model_validate(parsed)
                self.calls += 1
                self.total_seconds += time.time() - started
                tokens = meta.get("usage", {}).get("total_tokens")
                if isinstance(tokens, int):
                    self.total_tokens += tokens
                result_meta = {
                    "cache_id": hashlib.sha256(
                        _json_text({"stage": stage, "system": system, "user": user}).encode("utf-8")
                    ).hexdigest(),
                    "response_id": meta.get("response_id"),
                    "requested_model": meta.get("requested_model") or self.model,
                    "returned_model": meta.get("returned_model"),
                    "usage": meta.get("usage", {}),
                    "seconds": meta["seconds"],
                    "stage": stage,
                    "prompt_version": prompt_version or "unknown",
                    "attempts": attempts,
                    "recovered": False,
                }
                if self.on_call:
                    self.on_call({**result_meta, "status": "ok"})
                return valid, result_meta
            except (AccountBlocked, DeadlineExceeded):
                raise
            except (ValueError, KeyError, TypeError) as exc:
                last_error = str(exc)[:2000]
                if last_error == "incomplete_response_length_grow":
                    # Output budget exhausted; retry with a bigger budget
                    # instead of a futile repair prompt.
                    if self.on_call:
                        self.on_call({"stage": stage, "status": "retry", "attempt": attempts,
                                      "error": "incomplete_response_length"})
                    if attempts >= 3:
                        last_error = "incomplete_response_length"
                        break
                    continue
                if self.on_call:
                    self.on_call({"stage": stage, "status": "repair", "attempt": attempts, "error": last_error})
                # A truncated response cannot be repaired by re-asking; the
                # engine splits the block instead. Fail fast to save ~10min.
                if last_error.startswith("incomplete_response_"):
                    break
                if attempts >= 3:
                    break
                repair = (
                    "上一回复未通过程序校验。只修正有问题的条目，保留其余条目并重新完整输出；"
                    "不要为通过校验删除真实事项。引用按所给原文定位，数字、单位、符号不得改写。"
                    "错误：" + last_error
                )
                user = (
                    instruction + "\n" + _json_text(payload)
                    + "\n\n上一回复：\n" + last_text
                    + "\n\n" + repair
                )
            except (RuntimeError, OSError) as exc:
                # RuntimeError: HTTP/API failures. OSError: transient transport
                # failures (DNS, reset connections, timeouts). Both are worth
                # a bounded backoff retry before the block is declared failed.
                last_error = str(exc)[:2000]
                if self.on_call:
                    self.on_call({"stage": stage, "status": "retry", "attempt": attempts, "error": last_error})
                if attempts >= 3:
                    break
                time.sleep(min(30, 2 ** (attempts - 1) * 4))
        if hasattr(schema, "recover"):
            valid = schema.recover(last_parsed, last_error, raw_text=last_text)
            self.calls += 1
            meta = {
                "cache_id": hashlib.sha256(_json_text({"stage": stage, "system": system, "user": user}).encode("utf-8")).hexdigest() + "-recovered",
                "requested_model": self.model,
                "usage": {},
                "seconds": round(time.time() - started, 3),
                "stage": stage,
                "prompt_version": prompt_version or "unknown",
                "attempts": attempts,
                "recovered": True,
            }
            if self.on_call:
                self.on_call({**meta, "status": "recovered", "error": last_error})
            return valid, meta
        raise RuntimeError(last_error)
