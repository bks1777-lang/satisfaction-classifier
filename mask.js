/* 가림 — AI에 보내기 전에, 브라우저 안에서.
 * 이름 · 이름+직급 · 부서/팀 이름 · 전화번호를 [이름] [부서] [전화번호] 로 바꾼다.
 * 익명 설문이라 누가 썼는지, 누구 이야기인지 드러나면 안 된다.
 * 자동 가림은 완벽하지 않다. 무엇을 놓치는지 시험해서 안다.
 */
(function (root) {
  "use strict";

  const SURNAMES = "김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모";
  const TITLES = "팀장|과장|부장|차장|대리|주임|실장|센터장|본부장|이사|대표|선배|님|씨";

  const PATTERNS = [
    { type: "전화번호", re: /0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/g },
    // 성씨 + 두 글자 뒤에 직급 · 님 · 씨 가 올 때 (김하늘 과장 · 박민준 팀장님)
    { type: "이름", re: new RegExp(`(?<![가-힣])[${SURNAMES}][가-힣]{2}(?=\\s?(?:${TITLES}))`, "g") },
    // 성씨 하나 + 직급 (김 과장 · 이팀장)
    { type: "이름", re: new RegExp(`(?<![가-힣])[${SURNAMES}](?=\\s?(?:팀장|과장|부장|차장|대리|주임|실장|센터장|본부장))`, "g") },
    // ○○팀 · ○○본부 · ○○사업부 — 붙여 쓴 이름만 («다른 팀» 은 그대로, «팀장» 은 빼고)
    { type: "부서", re: /[가-힣A-Za-z0-9]{1,6}(?:팀(?!장)|본부(?!장)|사업부)/g },
  ];

  function mask(text) {
    let out = String(text || "");
    const found = [];
    for (const p of PATTERNS) {
      out = out.replace(p.re, m => { found.push({ type: p.type, value: m }); return `[${p.type}]`; });
    }
    return { masked: out, found };
  }

  root.Mask = { mask };
})(this);
