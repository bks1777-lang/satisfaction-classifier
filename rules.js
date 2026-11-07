/* 규칙 분류기 — AI 없이 낱말만으로 가른다. AI와 견줄 기준선이다.
 *   칸: criteria.json 의 priority 순서대로, keywords.json 의 낱말이 처음 걸리는 칸. 없으면 «기타».
 *   만족도: 불만 낱말이 먼저. 없고 만족 낱말이 있으면 만족. 둘 다 없으면 보통.
 */
(function (root) {
  "use strict";

  function hit(text, words) {
    for (const w of words || []) if (text.includes(w)) return w;
    return null;
  }

  function classify(text, criteria, keywords) {
    let category = "기타", whyCat = "어느 칸의 낱말도 없어서 «기타»";
    for (const name of criteria.priority) {
      const w = hit(text, keywords.categories[name]);
      if (w) { category = name; whyCat = `«${w}» 가 있어서 «${name}»`; break; }
    }
    let sentiment = "보통", whySen = "불만 · 만족 낱말이 없어서 «보통»";
    const bad = hit(text, keywords.sentiment["불만"]);
    const good = bad ? null : hit(text, keywords.sentiment["만족"]);
    if (bad) { sentiment = "불만"; whySen = `«${bad}» 가 있어서 «불만»`; }
    else if (good) { sentiment = "만족"; whySen = `«${good}» 가 있어서 «만족»`; }
    return { category, sentiment, reason: `${whyCat} · ${whySen}` };
  }

  // 정답 rows 와 판정 함수로 점수를 낸다. worst = 놓치면 안 되는 칸 이름
  function score(rows, judge, worst) {
    let cat = 0, sen = 0, both = 0, worstTotal = 0, worstMissed = 0;
    const wrong = [];
    rows.forEach((r, i) => {
      const got = judge(r, i);
      const okC = got.category === r.category, okS = got.sentiment === r.sentiment;
      cat += okC; sen += okS; both += okC && okS;
      if (r.category === worst) { worstTotal++; if (!okC) worstMissed++; }
      if (!okC || !okS) wrong.push({ r, got });
    });
    return { n: rows.length, cat, sen, both, worstTotal, worstMissed, wrong };
  }

  root.Rules = { classify, score };
})(this);
