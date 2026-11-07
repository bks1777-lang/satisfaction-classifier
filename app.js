/* 화면 — 문장 → 가림(mask.js, 브라우저 안) → AI(api/classify) → 실패하면 규칙(rules.js).
 * 기준 · 낱말 · 정답은 파일에서 읽는다. 코드에 적지 않는다. 넣은 문장은 저장하지 않는다. 설문 답은 익명이다.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const S = { criteria: null, keywords: null, answer: [], aiResults: null, aiModel: "" };
  const BATCH = 10;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function load() {
    const [c, k, a] = await Promise.all([
      fetch("criteria.json").then(r => r.json()),
      fetch("keywords.json").then(r => r.json()),
      fetch("data/answer.json").then(r => r.json()),
    ]);
    S.criteria = c; S.keywords = k; S.answer = a;
    $("#owner").textContent = c.owner;
    $("#worst-label").textContent = `${c.priority[0]} 놓침`;
  }

  // 탭
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    ["try", "score"].forEach(t => { $("#tab-" + t).hidden = t !== b.dataset.tab; });
  }));

  // AI 호출 — 가린 문장만 보낸다
  async function askAI(maskedTexts) {
    try {
      const r = await fetch("api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: maskedTexts, criteria: S.criteria }),
      });
      if (!r.ok) return { results: null, reason: `서버 함수가 없습니다 (HTTP ${r.status}) — 올린 주소에서만 됩니다` };
      return await r.json();
    } catch (e) {
      return { results: null, reason: "서버 함수에 닿지 못했습니다" };
    }
  }

  function chip(text) { return `<span class="chip">${esc(text)}</span>`; }

  // 분류
  $("#btn-classify").addEventListener("click", async () => {
    const text = $("#input").value.trim();
    if (!text || !S.criteria) return;
    const btn = $("#btn-classify");
    btn.disabled = true; btn.textContent = "분류 중…";

    const m = Mask.mask(text);
    $("#result").hidden = false;
    $("#masked").textContent = m.masked;
    $("#found").innerHTML = m.found.length
      ? m.found.map(f => `<span class="tag">${esc(f.type)} 가림</span>`).join(" ")
      : `<span class="muted">가린 것 없음</span>`;

    const ai = await askAI([m.masked]);
    const got = ai.results && ai.results[0];
    if (got) {
      $("#by").textContent = "AI · " + (ai.model || "");
      $("#chips").innerHTML = chip(got.category) + " " + chip(got.sentiment);
      $("#reason").textContent = got.reason || "";
    } else {
      const res = Rules.classify(m.masked, S.criteria, S.keywords);
      $("#by").textContent = `AI 없이 규칙으로 갈랐습니다 — ${ai.reason || "AI 답 없음"}`;
      $("#chips").innerHTML = chip(res.category) + " " + chip(res.sentiment);
      $("#reason").textContent = res.reason;
    }
    btn.disabled = false; btn.textContent = "분류하기";
  });

  // 채점
  function showScore(who, s, wrongTitle) {
    const pct = x => `${x} / ${s.n} (${Math.round(x / s.n * 100)}%)`;
    $("#score-table").hidden = false;
    $(`[data-k="${who}-cat"]`).textContent = pct(s.cat);
    $(`[data-k="${who}-urg"]`).textContent = pct(s.sen);
    $(`[data-k="${who}-both"]`).textContent = pct(s.both);
    $(`[data-k="${who}-worst"]`).textContent = `${s.worstMissed} / ${s.worstTotal}`;
    $("#wrong").hidden = false;
    $("#wrong-who").textContent = `${wrongTitle} · 정답 → 판정`;
    $("#wrong-list").innerHTML = s.wrong.map(({ r, got }) => {
      const diff = [];
      if (got.category !== r.category) diff.push(`${r.category}→${got.category}`);
      if (got.sentiment !== r.sentiment) diff.push(`${r.sentiment}→${got.sentiment}`);
      return `<li><span class="t">${esc(r.id)} ${esc(r.text)}</span><br><span class="d">${esc(diff.join(" · "))}${r.note ? " · " + esc(r.note) : ""}</span></li>`;
    }).join("");
  }

  $("#btn-score-rule").addEventListener("click", () => {
    if (!S.criteria) return;
    const s = Rules.score(S.answer, r => Rules.classify(Mask.mask(r.text).masked, S.criteria, S.keywords), S.criteria.priority[0]);
    showScore("rule", s, "규칙");
  });

  $("#btn-score-ai").addEventListener("click", async () => {
    if (!S.criteria) return;
    const btn = $("#btn-score-ai");
    btn.disabled = true;
    $("#score-msg").hidden = true;
    const masked = S.answer.map(r => Mask.mask(r.text).masked);
    const results = [];
    const used = [];  // 묶음마다 답한 모델 — 섞이면 다 적는다
    for (let i = 0; i < masked.length; i += BATCH) {
      btn.textContent = `AI 채점 중… ${i}/${masked.length}`;
      const r = await askAI(masked.slice(i, i + BATCH));
      if (!r.results) {
        $("#score-msg").hidden = false;
        $("#score-msg").textContent = `AI로 채점하지 못했습니다 — ${r.reason}`;
        btn.disabled = false; btn.textContent = "AI로 채점";
        return;
      }
      if (r.model && !used.includes(r.model)) used.push(r.model);
      for (let j = 0; j < Math.min(BATCH, masked.length - i); j++) results.push(r.results[j] || null);
    }
    // 답을 못 받은 문장은 오답으로 센다 — 빼고 세면 점수가 부풀려진다
    const miss = { category: "-", sentiment: "-" };
    S.aiModel = used.join(" + ") + (used.length > 1 ? " (섞임)" : "");
    S.aiResults = results;
    const s = Rules.score(S.answer, (r, i) => results[i] || miss, S.criteria.priority[0]);
    showScore("ai", s, `AI · ${S.aiModel}`);
    const blank = results.filter(x => !x).length;
    $("#score-msg").hidden = false;
    $("#score-msg").textContent = `모델 ${S.aiModel} · 기준 version ${S.criteria.version} · AI가 답하지 않은 문장 ${blank}건 (오답으로 셈)`;
    $("#btn-download").hidden = false;
    btn.disabled = false; btn.textContent = "AI로 채점";
  });

  $("#btn-download").addEventListener("click", () => {
    const rows = S.answer.map((r, i) => ({ id: r.id, text: r.text, 정답: { category: r.category, sentiment: r.sentiment }, AI: S.aiResults[i] }));
    const out = { model: S.aiModel, criteria_version: S.criteria.version, rows };
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ai_채점결과.json"; a.click();
  });

  load();
})();
