# -*- coding: utf-8 -*-
"""Gemini 분류 — Vercel 서버 함수. 열쇠를 숨기려고 여기에 있다.

  받는 것   {"texts": ["가린 문장", ... 최대 10개], "criteria": {...criteria.json...}}
  주는 것   {"results": [{"category", "sentiment", "reason"} 또는 null, ...], "model": "..."}
            열쇠가 없거나 실패하면 {"results": null, "reason": "..."} — 화면은 규칙으로 계속 돈다.

문장은 브라우저에서 이미 가린 채로 온다(mask.js). 열쇠는 환경 변수 GEMINI_API_KEY 에서만 읽는다.
파이썬 표준 라이브러리만 쓴다.
"""
import json
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

MODEL = os.environ.get("GEMINI_MODEL", "").strip() or "gemini-3.5-flash-lite"
# 바쁠 때(503·429) 차례로 물어볼 모델 — 답한 모델 이름은 결과에 그대로 적힌다
MODELS = list(dict.fromkeys([MODEL, "gemini-3.8-flash", "gemini-3.5-flash-lite"]))
BUSY = (429, 500, 503)
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT = 45    # 모델 하나를 기다리는 시간 — 넘으면 다음 모델로
MAX_TEXTS = 10   # 한 번에 받는 문장 수 — 주소가 퍼졌을 때 한도가 새는 것을 줄인다
MAX_LEN = 500    # 문장당 글자 수

SENTS = ["만족", "보통", "불만"]


def build_prompt(texts, crit):
    cats = "\n".join(f"  - {c['name']}: {c['definition']}" for c in crit.get("categories", []))
    order = " > ".join(crit.get("priority", []))
    lines = "\n".join(f"{i}: {t}" for i, t in enumerate(texts))
    return f"""너는 회사 근무 만족도 설문의 주관식 답을 분류하는 담당자다. 아래 기준을 그대로 따른다. 기준에 없는 판단을 더하지 않는다.

[칸 — 하나만 고른다]
{cats}
  여러 칸에 걸치면 이 순서로 먼저 고른다: {order}
  이유: {crit.get('priority_reason', '')}

[만족도 — 만족 · 보통 · 불만]
  {crit.get('sentiment', {}).get('guide', '')}

[] 안의 말(예: [이름], [부서], [전화번호])은 가린 개인정보다. 누구인지 추측하지 않는다.

문장마다 아래 모양의 JSON 배열 하나로만 답한다. 설명을 덧붙이지 않는다.
[{{"i": 0, "category": "...", "sentiment": "...", "reason": "왜 그렇게 골랐는지 한 문장"}}]

[문장]
{lines}
"""


def call_one(key, model, body):
    req = urllib.request.Request(
        ENDPOINT.format(model=model), data=body, method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    return json.loads(data["candidates"][0]["content"]["parts"][0]["text"])


def call_gemini(key, prompt):
    """(답, 답한 모델) 을 돌려준다. 바쁘면 2초 쉬고 한 번 더, 그래도 바쁘면 다음 모델."""
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }).encode("utf-8")
    last = None
    for model in MODELS:
        for attempt in range(2):
            try:
                return call_one(key, model, body), model
            except urllib.error.HTTPError as e:
                last = e
                if e.code not in BUSY:
                    raise
                if attempt == 0:
                    time.sleep(2)
            except (TimeoutError, OSError) as e:  # 답이 안 오면 기다리지 않고 다음 모델로
                last = e
                break
    raise last


def clean(items, n, cats):
    """기준 안의 값만 받는다. 기준 밖의 값이나 빠진 문장은 null 로 둔다."""
    out = [None] * n
    for it in items if isinstance(items, list) else []:
        try:
            i = int(it.get("i"))
        except (TypeError, ValueError, AttributeError):
            continue
        if 0 <= i < n and it.get("category") in cats and it.get("sentiment") in SENTS:
            out[i] = {"category": it["category"], "sentiment": it["sentiment"],
                      "reason": str(it.get("reason", ""))[:200]}
    return out


class handler(BaseHTTPRequestHandler):
    def _send(self, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not key:
            return self._send({"results": None, "reason": "열쇠가 없습니다 — Vercel 환경 변수 GEMINI_API_KEY"})
        if not key.isascii() or not MODEL.isascii():
            return self._send({"results": None, "reason": "열쇠나 모델 이름에 한글·빈칸 같은 엉뚱한 글자가 있습니다 — 값을 다시 붙여넣기"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(min(n, 60000)).decode("utf-8"))
            texts = [str(t)[:MAX_LEN] for t in req.get("texts", [])][:MAX_TEXTS]
            crit = req.get("criteria") or {}
            cats = [c.get("name") for c in crit.get("categories", []) if isinstance(c, dict)]
            if not texts or not cats:
                return self._send({"results": None, "reason": "보낸 문장이나 기준이 없습니다"})
            items, used = call_gemini(key, build_prompt(texts, crit))
            return self._send({"results": clean(items, len(texts), cats), "model": used})
        except urllib.error.HTTPError as e:
            why = {404: "모델 이름이 없습니다", 400: "열쇠나 요청이 틀렸습니다", 403: "열쇠가 막혔습니다",
                   429: "무료 한도를 넘었습니다 — 잠시 뒤", 503: "Google이 바쁩니다 — 1~2분 뒤 다시"}.get(e.code, "모델 이름 · 한도를 확인")
            return self._send({"results": None, "reason": f"AI 호출 실패 ({e.code}) — {why} · 시도한 모델 {', '.join(MODELS)}"})
        except (TimeoutError, OSError) as e:
            return self._send({"results": None, "reason": f"AI가 {TIMEOUT}초 안에 답하지 않았습니다 ({type(e).__name__}) · 시도한 모델 {', '.join(MODELS)}"})
        except Exception as e:  # noqa: BLE001
            return self._send({"results": None, "reason": f"AI 호출 실패 — {type(e).__name__} · 시도한 모델 {', '.join(MODELS)}"})
