/*
  본선 발표 슬라이드 생성기 v4 — 2026-08-05

  v3(build_deck.js, 10장)에서 갈라져 나왔다. 2차 멘토링 지적 둘을 반영한다.

  1) "앞에서 임팩트를 빡 줘야 한다" — v3에서 5번째 장에 있던
     「같은 농지인데 작물을 바꾸면 공식 등급 자체가 갈린다」를 1장으로 올렸다.
     표지와 훅을 한 장에 합쳤다. 무대에서 실물로 보일 수 있는 유일한 판정 논리 증거다.
  2) "검증·환각 처리 과정을 발표 자료에 넣어라" — 5장에 설명 생성 5단계를
     제품 화면 조각이 아니라 글로 세웠다. 모델 이름·버전은 쓰지 않는다.

  v3의 3번 장(「다섯 고리」 단독 장)을 없애 18초를 회수하고, 다섯 고리는 2장에 한 줄로 넣었다.
  합 266초 · 여유 34초.

  색과 글자 크기는 제품이 쓰는 토큰을 그대로 가져온다.
*/
const pptx = require("pptxgenjs");

const P = {
  deep: "10262E",       // 어두운 면 — 표지와 마무리
  deepLine: "2B4550",
  deepSoft: "A7C0C8",
  cy: "0E7490",         // 작은 글자를 받는 브랜드 색
  cyVivid: "0891B2",    // 큰 글자만 받는 선명한 쪽
  cyPale: "CFFAFE",
  cyInk: "0B5A72",
  ink: "14181A",
  inkSoft: "55636A",
  pg: "F7F9FA",
  sf: "FFFFFF",
  sunk: "F1F4F5",
  line: "DDE4E6",
  lineStrong: "B9C4C7",
  good: "1C6F37",
  goodBg: "DCECDF",
  watch: "8A5806",
  watchBg: "FBE7AB",
  bad: "B13327",
};

// 한글 발표용. 발표 노트북이 윈도우이므로 맑은 고딕이 실제로 뿌려지는 글꼴이다.
const F = "맑은 고딕";

const deck = new pptx();
deck.layout = "LAYOUT_WIDE"; // 13.3 × 7.5 인치. 슬라이드를 추가하기 전에 정한다.
deck.author = "김남궁택";
deck.title = "밭보다 — 공공데이터 기반 농지 환경 판정";

const W = 13.333;
const H = 7.5;
const M = 0.62; // 좌우 여백

/* ── 공통 조각 ───────────────────────────────────────────────────────────── */

const SHOTS = "D:/Projects/batboda/발표/캡처/";
const fsx = require("fs");

/*
  PNG 머리에서 원본 크기를 읽는다. IHDR은 항상 16바이트째부터 폭·높이 4바이트씩이다.
  pptxgenjs의 `sizing: { type: "contain" }`을 믿고 넘겼더니 듣지 않았다 — 산출물의
  `<a:ext>`가 틀 크기와 같고 `srcRect`가 0이어서 원본이 틀에 그대로 늘어났다.
  C06은 비율 1.37인데 2.35로 놓여 가로로 1.72배 벌어졌다(2026-08-05 XML 실측).
  그래서 비율을 여기서 직접 계산한다. 이 부분은 건드리지 않는다.
*/
function pngSize(file) {
  const b = Buffer.alloc(24);
  const fd = fsx.openSync(file, "r");
  fsx.readSync(fd, b, 0, 24, 0);
  fsx.closeSync(fd);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function captureFrame(s, { x, y, w, h, tag, spec, dark = false, shot }) {
  const file = shot ? SHOTS + shot + ".png" : null;
  if (file && fsx.existsSync(file)) {
    // 틀 안에 다 들어가는 배율을 골라 가운데 놓는다. 제품 화면을 늘리면 그 자체가 거짓이 된다.
    const px = pngSize(file);
    const k = Math.min(w / px.w, h / px.h);
    const iw = px.w * k;
    const ih = px.h * k;
    s.addImage({ path: file, x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih });
    return;
  }
  s.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.04,
    fill: { color: dark ? "17323C" : P.sunk },
    line: { color: dark ? P.deepLine : P.lineStrong, width: 1, dashType: "dash" },
  });
  s.addText(tag, {
    x: x + 0.16, y: y + 0.12, w: w - 0.32, h: 0.26,
    fontFace: F, fontSize: 11, bold: true, margin: 0,
    color: dark ? P.deepSoft : P.cy,
  });
  s.addText(spec, {
    x: x + 0.16, y: y + 0.42, w: w - 0.32, h: h - 0.58,
    fontFace: F, fontSize: 10.5, margin: 0, valign: "top", lineSpacingMultiple: 1.25,
    color: dark ? P.deepSoft : P.inkSoft,
  });
}

/** 어느 제품 화면이 이 주장의 근거인지 오른쪽 위에 붙인다. 모든 근거 장에 같은 자리. */
function evidenceTag(s, text, dark = false) {
  s.addText(text, {
    x: W - M - 3.6, y: 0.42, w: 3.6, h: 0.28,
    fontFace: F, fontSize: 11, bold: true, align: "right", margin: 0,
    color: dark ? P.deepSoft : P.cy,
  });
}

function slideNo(s, n, dark = false) {
  s.addText(String(n).padStart(2, "0"), {
    x: W - M - 0.7, y: H - 0.62, w: 0.7, h: 0.3,
    fontFace: F, fontSize: 11, bold: true, align: "right", margin: 0,
    color: dark ? P.deepLine : P.lineStrong,
  });
}

/** 밝은 장의 제목. 한 장 한 주장이므로 제목이 그 장의 전부다. */
function claim(s, text, { y = 1.0, w = W - M * 2, size = 27 } = {}) {
  s.addText(text, {
    x: M, y, w, h: 1.35,
    fontFace: F, fontSize: size, bold: true, margin: 0, valign: "top",
    color: P.ink, lineSpacingMultiple: 1.18,
  });
}

function lightSlide() {
  const s = deck.addSlide();
  s.background = { color: P.pg };
  return s;
}

function darkSlide() {
  const s = deck.addSlide();
  s.background = { color: P.deep };
  return s;
}

/* ── S1 · 25초 · 표지 겸 훅: 작물이 바뀌면 등급이 바뀐다 ──────────────────── */
{
  const s = darkSlide();
  s.addText("2026 지역산업 문제기반 AI 해커톤 본선 · 기업 문제 1", {
    x: M, y: 0.44, w: 7.6, h: 0.3,
    fontFace: F, fontSize: 12.5, bold: true, margin: 0, color: P.deepSoft, charSpacing: 1,
  });
  // 서비스명과 팀명은 작게. 이 장의 주인공은 두 캡처다.
  s.addText("밭보다 · 김남궁택", {
    x: W - M - 4.0, y: 0.44, w: 4.0, h: 0.3,
    fontFace: F, fontSize: 12.5, bold: true, align: "right", margin: 0, color: P.deepSoft,
  });
  // 줄바꿈을 직접 넣는다. 한글은 자동 줄바꿈이 낱말 가운데를 끊는다(`근거입 / 니다`).
  s.addText("같은 농지입니다. 작물을 바꾸면\n판정에 쓰는 공식 등급 자체가 갈립니다", {
    x: M, y: 0.9, w: W - M * 2, h: 1.66,
    fontFace: F, fontSize: 31, bold: true, margin: 0, valign: "top",
    color: P.sf, lineSpacingMultiple: 1.18,
  });
  s.addShape("roundRect", {
    x: M, y: 2.32, w: 6.4, h: 0.5, rectRadius: 0.06,
    fill: { color: "17323C" }, line: { color: P.deepLine, width: 1 },
  });
  s.addText("같은 농지 · 경기 이천시 유방동 870답", {
    x: M + 0.2, y: 2.32, w: 6.0, h: 0.5,
    fontFace: F, fontSize: 15.5, bold: true, valign: "middle", margin: 0, color: P.cyPale,
  });

  const cases = [
    ["사과 · 과수 4급지", "20260805_C05_유방동870답_사과_과수등급", "C5 · 02 토양 적성 카드"],
    ["상추 · 밭 3급지", "20260805_C06_유방동870답_상추_밭등급", "C6 · 02 토양 적성 카드"],
  ];
  const capW = 5.1;
  const capH = 3.72;
  const gap = 0.38;
  const x0 = (W - (capW * 2 + gap)) / 2;
  cases.forEach(([label, shotName, tag], i) => {
    const x = x0 + i * (capW + gap);
    s.addText(label, {
      x, y: 2.98, w: capW, h: 0.34,
      fontFace: F, fontSize: 17, bold: true, align: "center", margin: 0, color: P.cyPale,
    });
    captureFrame(s, {
      x, y: 3.36, w: capW, h: capH, dark: true, shot: shotName, tag,
      spec: "이천 유방동 870답. 작물만 바꿔 연속으로.\n두 조각 같은 배율·같은 잘라내기.",
    });
  });
  slideNo(s, 1, true);
  s.addNotes(
    "[25초]\n" +
    "같은 논 농지입니다. 사과를 고르면 과수 4급지, 상추를 고르면 밭 3급지를 씁니다. " +
    "작물을 바꾸면 판정에 쓰는 공식 등급 자체가 갈립니다. " +
    "저희는 밭보다, 팀 김남궁택입니다. 심사위원께서 다른 작물을 고르셔도 같은 방식으로 동작합니다.\n\n" +
    "이 장이 무대에서 실물로 보일 수 있는 가장 강한 판정 논리 증거다. 여기서 시선을 잡는다.\n" +
    "팀 소개는 한 문장으로 끝낸다.\n" +
    "금지 — 팀 소개 길게, 귀농 인구·실패율 통계, 필드 코드명, 등급 전수 표, " +
    "이 항목을 한계로 언급, 다른 서비스는 밭 등급만 쓴다는 추정."
  );
}

/* ── S2 · 22초 · 다섯 고리 한 줄 + 농지 경계 ──────────────────────────────── */
{
  const s = lightSlide();
  evidenceTag(s, "화면 근거 · 01-B 농지 경계");
  claim(s, "밭보다는 이 농지의 근거를\n처음부터 끝까지 되짚습니다", { y: 0.86, size: 28 });
  s.addShape("roundRect", {
    x: M, y: 2.24, w: W - M * 2, h: 0.56, rectRadius: 0.06,
    fill: { color: P.sunk }, line: { color: P.line, width: 1 },
  });
  s.addText("경계 확인 → 같은 필지번호 토양 → 작물별 공식 등급 → 좌표 예보 → 근거 추적", {
    x: M + 0.22, y: 2.24, w: W - M * 2 - 0.44, h: 0.56,
    fontFace: F, fontSize: 16, bold: true, valign: "middle", margin: 0, color: P.cyInk,
  });
  captureFrame(s, {
    x: M, y: 3.0, w: W - M * 2, h: 3.86, shot: "20260805_C01_대관령85-61전_경계",
    tag: "C1 · 01-B 실제 농지 확인",
    spec: "대관령면 85-61전 선택 직후.\n농지 경계 폴리곤 + 지번 + PNU. 주소창 포함.",
  });
  slideNo(s, 2);
  s.addNotes(
    "[22초]\n" +
    "내 땅에 이 작물을 심어도 될까. 밭보다는 좌표가 아니라 농지 경계를 먼저 확인합니다. " +
    "그 필지번호의 토양과 그 좌표의 예보를 작물별 공식 기준에 대조하고, 근거의 출처까지 남깁니다. " +
    "이 다섯 고리가 밭보다입니다.\n\n" +
    "이 장이 비교 기준을 남기는 장이다. 발표 순서 1번이므로 심사위원이 뒤의 다섯 팀을 볼 때 쓸 낱말을 여기서 심는다.\n" +
    "금지 — API 개수·아키텍처 도해, 「필지 단위 서비스는 밭보다뿐」, 기능 목록 나열."
  );
}

/* ── S3 · 22초 · 문제의 실제 형태 ─────────────────────────────────────────── */
{
  const s = lightSlide();
  evidenceTag(s, "화면 근거 · 03 사용한 자료 · 01-B");
  claim(s, "자료가 없는 것이 아니라, 서로 다른 기관·단위에 있어\n내 농지로 이어지지 않습니다", { y: 0.9 });
  s.addText("같은 농지에 대는 자료 넷이 4년 가까이 벌어져 있습니다", {
    x: M, y: 2.18, w: W - M * 2, h: 0.32,
    fontFace: F, fontSize: 16, bold: true, margin: 0, color: P.cyInk,
  });
  /*
    표 캡처는 원본 비율 1.35라 높이가 배율을 정한다. 전폭으로 놓아도 폭 5.8인치까지밖에
    커지지 않아 네 줄의 글자가 프로젝터에서 읽히지 않았다(2026-08-05 렌더 실측).
    그래서 2×2 큰 칸 넷을 주역으로 세우고 표는 오른쪽에 작게 증거로 둔다.

    칸에 기관 이름만 넣지 않는다. 이 장의 주장은 「공공데이터 네 개를 쓴다」가 아니라
    「기준시각이 넷 다 달라 내 농지로 이어지지 않는다」다. 그래서 기준시각을 굵게 둔다.
    날짜 넷은 2026-08-05 09:05 배포본 캡처에서 읽은 실측값이다. 반올림하지 않는다.
    기관은 `농촌진흥청`으로 적는다 — 우리 문장으로 다른 기관명을 옮겨 적지 않는다.
  */
  const sources = [
    ["농지 경계", "농림축산식품부 팜맵 · ", "2022-12-30"],
    ["토양 특성·화학성", "농촌진흥청 · ", "2025-05-02"],
    ["단기예보", "기상청 · ", "2026-08-05 08:00"],
    ["최근 7일 관측", "농촌진흥청 · ", "2026-07-29~08-04"],
  ];
  /*
    가운데를 비운 2×2다. 빈 가운데에 필지를 둔다. 2×2만 있으면 「공공데이터 네 개가 있다」
    까지고, 가운데에 필지가 있으면 「서로 다른 넷이 이 한 칸으로 모인다」가 된다.
    화살표나 연결선은 긋지 않는다 — 그으면 아키텍처 다이어그램이 되고 그건 금지다.
  */
  const cellW = 4.2;
  const cellH = 1.78;
  const cellGapY = 0.3;
  const colX = [M, W - M - 4.2];
  sources.forEach(([kind, org, asOf], i) => {
    const x = colX[i % 2];
    const y = 2.78 + Math.floor(i / 2) * (cellH + cellGapY);
    s.addShape("roundRect", {
      x, y, w: cellW, h: cellH, rectRadius: 0.06,
      fill: { color: P.sf }, line: { color: P.line, width: 1 },
    });
    s.addText(kind, {
      x: x + 0.28, y: y + 0.34, w: cellW - 0.56, h: 0.5,
      fontFace: F, fontSize: 21, bold: true, margin: 0, valign: "top", color: P.ink,
    });
    s.addText(
      [
        { text: org, options: { color: P.inkSoft } },
        { text: asOf, options: { bold: true, color: P.cyInk } },
      ],
      {
        x: x + 0.28, y: y + 1.0, w: cellW - 0.56, h: 0.44,
        fontFace: F, fontSize: 14, margin: 0, valign: "top", lineSpacingMultiple: 1.2,
      }
    );
  });
  /*
    가운데의 한 칸. 지금 배포본에서 새로 잡을 수 없어 지도 타일 위에 정보 카드까지 얹힌
    C01을 그대로 쓴다. 폴리곤만 떼낸 그림이 있으면 더 깔끔하다.
  */
  captureFrame(s, {
    x: 5.17, y: 3.86, w: 3.0, h: 1.72, shot: "20260805_C01_대관령85-61전_경계",
    tag: "C1 · 01-B 농지 경계", spec: "폴리곤이 보이는 크기면 충분하다.",
  });
  s.addText("대관령면 85-61전", {
    x: 5.17, y: 5.66, w: 3.0, h: 0.32,
    fontFace: F, fontSize: 15, bold: true, align: "center", margin: 0, color: P.ink,
  });
  slideNo(s, 3);
  s.addNotes(
    "[22초]\n" +
    "농지, 토양, 예보는 서로 다른 기관이 서로 다른 단위와 시각으로 냅니다. " +
    "초보자는 이 네 화면을 각각 찾아 자기 농지 값을 골라내고 작물 기준과 직접 대조해야 합니다.\n\n" +
    "표를 읽지 않는다. 네 칸을 가리키며 “넷이 서로 다른 기관, 서로 다른 시각입니다”까지만 말한다. " +
    "기관 넷을 일일이 읊으면 22초를 넘긴다.\n" +
    "금지 — 「대부분의 서비스는 시·군 평균만 제공한다」, 기존 서비스 비교표, 다른 팀·기관 이름."
  );
}

/* ── S4 · 70초 · 라이브 시연 ──────────────────────────────────────────────── */
{
  const s = lightSlide();
  evidenceTag(s, "라이브 · 배포본");
  claim(s, "이 다섯 고리는 지금 배포된 서비스에서 실제로 이어집니다", { y: 0.9, size: 28 });
  /* 주소를 전폭으로 놓았다. 무대에서 심사위원이 직접 열 수 있는 유일한 낱말이다. */
  s.addShape("roundRect", {
    x: M, y: 2.2, w: W - M * 2, h: 1.0, rectRadius: 0.08,
    fill: { color: P.cyPale }, line: { color: P.cy, width: 1 },
  });
  s.addText("batboda.vercel.app", {
    x: M, y: 2.2, w: W - M * 2, h: 1.0,
    fontFace: F, fontSize: 34, bold: true, align: "center", valign: "middle", margin: 0, color: P.cyInk,
  });
  s.addText("대관령면 85-61전 · 상추 · 3일", {
    x: M, y: 3.4, w: 6.1, h: 0.32,
    fontFace: F, fontSize: 15, bold: true, margin: 0, color: P.ink,
  });
  /*
    진행 지시문은 관객 면에서 뺐다. 「5초 안에 안 나오면」과 「고정 전환 문장」을 화면에
    인쇄해 두면 심사위원이 우리가 실패를 예상한다는 것을 먼저 읽는다. 발표자 노트로 옮겼다.
    남은 다섯 조각은 실패 대비가 아니라 **지금부터 보실 순서**다.
  */
  s.addText("지금부터 보실 순서", {
    x: M, y: 3.4, w: W - M * 2, h: 0.32,
    fontFace: F, fontSize: 15, bold: true, align: "right", margin: 0, color: P.cyInk,
  });
  const backups = [
    ["01", "농지 경계", "20260805_C01_대관령85-61전_경계"],
    ["02", "판정과 상태", "20260805_C02_판정서_상단"],
    ["03", "기준 대조", "20260805_C03_산도_기온_눈금"],
    ["04", "출처 추적", "20260805_C04_사용한자료_표"],
    ["05", "쉬운 말", "20260805_C07_04_상단_결론과근거"],
  ];
  const bw = (W - M * 2 - 0.18 * 4) / 5;
  backups.forEach(([tag, label, shotName], i) => {
    const x = M + i * (bw + 0.18);
    captureFrame(s, { x, y: 3.86, w: bw, h: 2.46, tag, spec: label, shot: shotName });
    s.addText(label, {
      x, y: 6.42, w: bw, h: 0.3,
      fontFace: F, fontSize: 12.5, bold: true, align: "center", margin: 0, color: P.cyInk,
    });
  });
  slideNo(s, 4);
  s.addNotes(
    "[70초 · 라이브]\n" +
    "0~8초  지번과 경계를 사람이 확인합니다.\n" +
    "8~15초  토양은 이 필지번호로, 예보는 이 좌표로 가져옵니다.\n" +
    "15~28초  판정과 함께 어떤 근거가 좋음·주의인지, 네 갈래 공공데이터가 응답했는지 같이 공개합니다.\n" +
    "28~42초  평균기온이 상추 공식 기준 15~20℃를 얼마나 벗어났는지 눈금으로, 기관과 기준시각까지 확인합니다.\n" +
    "42~62초  04에서는 판정은 규칙이 정했다고 밝히고, AI가 근거와 먼저 할 일을 쉬운 말로 옮깁니다.\n\n" +
    "금지 — 분석 소요 시간 수치, 후보 건수, 「어느 농지나 5초 안에」, 위험 라벨을 대사에 고정, " +
    "등급과 저해요인을 한 원인처럼 합쳐 말하기, 실패 원인 설명(전환 문장으로 바로 넘어간다).\n" +
    "수치는 화면에 보이는 값을 읽는다. 외운 값을 말하지 않는다.\n\n" +
    "■ 5초 규칙 — 한 동작을 누르고 5초 안에 다음 화면이 안 나오면 기다리지 않는다.\n" +
    "■ 고정 전환 문장(그대로 말한다) — “지금은 저장된 검증 장면으로 이어가며, " +
    "서비스에서는 실시간과 검증 스냅샷, 시연 자료를 구분해 표시합니다.”\n" +
    "■ 실패 원인을 설명하지 않는다. 위 문장을 말하고 이 장의 다섯 조각을 순서대로 넘긴다."
  );
}

/* ── S5 · 35초 · 규칙과 AI의 경계 + 검증 5단계 ────────────────────────────── */
{
  const s = lightSlide();
  evidenceTag(s, "화면 근거 · 04 쉬운 말 보고서");
  claim(s, "판정은 규칙이 확정하고, AI는 그 근거를 옮겨 씁니다.\n틀리면 규칙 문장으로 되돌립니다", { y: 0.82, size: 26 });
  captureFrame(s, {
    x: M, y: 2.36, w: 3.8, h: 3.05, shot: "20260805_C07_04_상단_결론과근거",
    tag: "C7 · 04 쉬운 말 보고서 상단",
    spec: "결론 한 줄 + 「판정 …은 공식 기준으로 규칙이 확정했습니다」 병기 문장\n+ 「이렇게 판단한 근거」 3줄까지.",
  });
  /*
    모델 대체는 5단계 목록의 3단계(설명 생성)에 딸린 이야기다. 캡처 아래에 홀로 두면
    어디에 붙는 문장인지 알 수 없어 떠 보였다. 목록 아래로 옮겨 5단계에 붙인다.
  */
  s.addText("생성을 맡은 모델이 과부하일 때는 더 가벼운 모델로 자동 대체합니다.", {
    x: 4.28, y: 5.52, w: 8.44, h: 0.3,
    fontFace: F, fontSize: 12.5, margin: 0, color: P.inkSoft,
  });

  /*
    멘토가 「검증·환각 처리 과정을 발표 자료에 넣어라」고 했다. 제품 화면 조각(C08)이
    아니라 글로 세운다. 문구는 제품 화면에서 그대로 가져왔다.
    모델 이름과 버전은 쓰지 않는다 — 화면 배지가 실제 쓴 모델을 표시한다.
  */
  s.addText("설명 문장을 만들 때 거치는 검증", {
    x: 4.66, y: 2.06, w: 8.07, h: 0.3,
    fontFace: F, fontSize: 14, bold: true, margin: 0, color: P.cyInk,
  });
  /*
    긴 설명은 `\n`으로 직접 줄을 나눈다. PowerPoint는 한글 자동 줄바꿈을 낱말 가운데서
    끊어 `규 / 칙 문장으로`처럼 만든다(2026-08-05 렌더 실측). 줄당 36자 안으로 끊었다.
  */
  const steps = [
    ["판정 결과 정리", "규칙이 확정한 판정과 근거만 모읍니다", 1],
    ["설명 규칙 적용", "AI가 새 수치나 판정을 만들지 못하게 하고,\n확률·처방 표현을 금지합니다", 2],
    ["설명 생성", "정리된 근거만 받아 설명을 씁니다", 1],
    ["문장 검사", "판정·위험 등급 그대로 인용했는지,\n금지 표현·근거에 없는 숫자가 없는지,\n필수 구성과 길이를 모두 검사합니다", 3],
    ["화면 전달", "검사를 통과한 설명만 내보냅니다. 통과하지\n못하면 같은 근거의 규칙 문장으로 되돌립니다", 2],
  ];
  const lineH = 0.245;
  let sy = 2.46;
  steps.forEach(([title, desc, lines], i) => {
    s.addText(String(i + 1), {
      x: 4.66, y: sy, w: 0.3, h: 0.3,
      fontFace: F, fontSize: 13.5, bold: true, margin: 0, color: P.cy,
    });
    s.addText(title, {
      x: 5.02, y: sy, w: 1.96, h: 0.3,
      fontFace: F, fontSize: 13, bold: true, margin: 0, valign: "top", color: P.ink,
    });
    s.addText(desc, {
      x: 7.02, y: sy, w: 5.71, h: lines * lineH + 0.08,
      fontFace: F, fontSize: 12.5, margin: 0, valign: "top",
      color: P.inkSoft, lineSpacingMultiple: 1.16,
    });
    sy += Math.max(lines * lineH, 0.3) + 0.17;
  });

  s.addShape("roundRect", {
    x: M, y: 5.98, w: W - M * 2, h: 0.86, rectRadius: 0.06,
    fill: { color: P.sf }, line: { color: P.line, width: 1 },
  });
  // `±20%`를 빼면 560이라는 숫자가 무엇을 흔든 결과인지 알 수 없어 자랑이 된다.
  s.addText("13파일 115건 회귀 테스트 통과 · 감점 폭을 ±20% 흔든 560개 시나리오에서 주 판정 단계 변동 0/0", {
    x: M + 0.2, y: 6.06, w: W - M * 2 - 0.4, h: 0.3,
    fontFace: F, fontSize: 14, bold: true, margin: 0, color: P.ink,
  });
  s.addText("코드 회귀와 산식 민감도 근거이며, 현장 정확도 검증이 아닙니다", {
    x: M + 0.2, y: 6.4, w: W - M * 2 - 0.4, h: 0.3,
    fontFace: F, fontSize: 12, margin: 0, color: P.inkSoft,
  });
  slideNo(s, 5);
  s.addNotes(
    "[35초]\n" +
    "결론 문장은 AI가 썼지만, 판정을 정한 것은 규칙입니다. " +
    "AI에는 확정된 근거만 넘기고, 새 수치나 판정을 만들지 못하게 막습니다. " +
    "나온 문장은 판정과 위험 등급을 그대로 인용했는지, 근거에 없는 숫자나 금지 표현이 없는지 검사합니다. " +
    "통과하지 못하면 같은 근거의 규칙 문장으로 되돌립니다.\n\n" +
    "회귀 테스트 수치는 당일 아침 재실행 결과로 말한다.\n" +
    "금지 — 「AI가 모든 숫자 오류를 차단한다」, 프롬프트 전문 낭독, 모델 이름·버전 고정(화면 배지가 실제 모델을 표시한다), " +
    "560 시나리오를 정확도로 제시. 위험 라벨 변동(완화 60% · 보수 10%)은 질의응답에서만."
  );
}

/* ── S6 · 30초 · 안 될 때 ─────────────────────────────────────────────────── */
{
  const s = lightSlide();
  evidenceTag(s, "화면 근거 · 03 상태·기준시각");
  /*
    제목을 캡처가 증명하는 것으로 낮췄다. 오늘 화면은 네 소스가 모두 `실시간`이라
    「세 가지를 구분한다」를 그림으로 보일 수 없다. 장애를 꾸며 캡처하는 것은 금지다.
  */
  claim(s, "외부 API가 죽어도 판단은 이어지고,\n소스마다 상태와 기준시각을 따로 남깁니다", { y: 0.9, size: 28 });
  s.addText("화면에 쓰는 세 가지 표시", {
    x: M, y: 2.12, w: 4.5, h: 0.28,
    fontFace: F, fontSize: 13, bold: true, margin: 0, color: P.cyInk,
  });
  const states = [
    ["실시간 연결", "지금 호출해 받은 값", P.good, P.goodBg],
    ["검증 스냅샷", "저장해 둔 실호출 응답", P.cyInk, P.cyPale],
    ["시연용 자료", "실데이터가 아님을 표시", P.watch, P.watchBg],
  ];
  states.forEach(([name, desc, fg, bg], i) => {
    const y = 2.5 + i * 0.96;
    s.addShape("roundRect", {
      x: M, y, w: 4.5, h: 0.78, rectRadius: 0.06,
      fill: { color: bg }, line: { color: fg, width: 1 },
    });
    s.addText(name, {
      x: M + 0.22, y: y + 0.08, w: 4.1, h: 0.3,
      fontFace: F, fontSize: 15, bold: true, margin: 0, color: fg,
    });
    s.addText(desc, {
      x: M + 0.22, y: y + 0.4, w: 4.1, h: 0.28,
      fontFace: F, fontSize: 12, margin: 0, color: fg,
    });
  });
  /*
    세로로 긴 캡처(1158×1586)를 넓고 낮은 틀에 넣으면 높이가 배율을 정해 줄고
    글자가 뭉개진다. 틀을 원본 비율에 맞춰 세로로 세운다.
  */
  captureFrame(s, {
    x: 5.36, y: 2.12, w: 3.3, h: 4.56, shot: "20260805_C04b_상태_기준시각",
    tag: "C4-b · 03 「상태 · 기준시각」 열 확대",
    spec: "소스마다 상태가 따로 붙는다는 것이 보이게 확대해 자른다.",
  });
  s.addShape("roundRect", {
    x: 8.86, y: 2.12, w: 3.86, h: 2.34, rectRadius: 0.06,
    fill: { color: P.sf }, line: { color: P.line, width: 1 },
  });
  /* 세 줄로 접히면서 아래 산문에 붙었다. 줄을 직접 나누고 아래를 내렸다. */
  s.addText("2026-08-03\n공공데이터 인증이 실제로 막혔습니다\n(HTTP 401)", {
    x: 9.06, y: 2.26, w: 3.46, h: 1.0,
    fontFace: F, fontSize: 13.5, bold: true, margin: 0, valign: "top",
    color: P.ink, lineSpacingMultiple: 1.2,
  });
  s.addText(
    "실패한 소스만 대체하고 이유를\n남기는 경로로 판정까지 이어지는\n것을 그때 확인했습니다.\n가정이 아니라 겪은 일입니다.", {
    x: 9.06, y: 3.3, w: 3.46, h: 1.06,
    fontFace: F, fontSize: 12, margin: 0, valign: "top", color: P.inkSoft, lineSpacingMultiple: 1.22,
  });
  /* 실패한 소스만 갈아 끼운다는 것을 낱말로 한 번 더 적는다. 캡처가 못 보이는 부분이다. */
  s.addText("실패한 소스만 대체하고, 나머지는 실시간을 그대로 씁니다.", {
    x: 8.86, y: 4.66, w: 3.86, h: 0.6,
    fontFace: F, fontSize: 13.5, bold: true, margin: 0, valign: "top",
    color: P.cyInk, lineSpacingMultiple: 1.25,
  });
  slideNo(s, 6);
  s.addNotes(
    "[30초]\n" +
    "운영에서 중요한 것은 잘 될 때가 아니라 안 될 때입니다. 실패한 소스만 대체하고 이유를 남깁니다. " +
    "8월 3일에 인증이 실제로 막혔을 때 이 경로로 판정까지 이어지는 것을 확인했습니다. 가정이 아니라 겪은 일입니다.\n\n" +
    "금지 — 운영비 0원·운영 인력 없음, 지역 확대 건수, 발표장에서 장애를 라이브로 재현, 401 화면을 조작해 만든 캡처."
  );
}

/* ── S7 · 25초 · 누가 다시 오는가 ─────────────────────────────────────────── */
{
  const s = lightSlide();
  evidenceTag(s, "화면 근거 · 01 내 농지");
  claim(s, "반복 사용은 매일이 아니라, 판단이 필요한 사건마다입니다", { y: 0.9, size: 28 });
  const moments = ["농지를 계약하기 전", "심을 작물을 바꿀 때", "파종 전 가까운 기간"];
  moments.forEach((t, i) => {
    const y = 2.42 + i * 0.86;
    s.addText(String(i + 1), {
      x: M, y, w: 0.36, h: 0.36,
      fontFace: F, fontSize: 16, bold: true, margin: 0, color: P.cy,
    });
    s.addText(t, {
      x: M + 0.42, y, w: 4.3, h: 0.4,
      fontFace: F, fontSize: 17, bold: true, margin: 0, color: P.ink,
    });
  });
  s.addText("농지는 즐겨찾기로 담아 두고, 브라우저에만 저장합니다. 서버로 보내지 않습니다.", {
    x: M, y: 5.06, w: 4.9, h: 0.66,
    fontFace: F, fontSize: 12.5, margin: 0, valign: "top", color: P.inkSoft, lineSpacingMultiple: 1.3,
  });
  captureFrame(s, {
    x: 5.66, y: 2.42, w: 7.06, h: 2.6, shot: "20260805_C09_내농지_즐겨찾기",
    tag: "C9 · 01 내 농지(즐겨찾기) 목록",
    spec: "농지 2건 이상 담긴 상태. 주소가 읽히게.",
  });
  s.addShape("roundRect", {
    x: 5.66, y: 5.2, w: 7.06, h: 1.62, rectRadius: 0.06,
    fill: { color: P.sf }, line: { color: P.line, width: 1 },
  });
  s.addShape("roundRect", {
    x: 5.88, y: 5.36, w: 1.28, h: 0.36, rectRadius: 0.18,
    fill: { color: P.watchBg }, line: { color: "E0C592", width: 1 },
  });
  s.addText("실증 제안", {
    x: 5.88, y: 5.36, w: 1.28, h: 0.36,
    fontFace: F, fontSize: 11.5, bold: true, align: "center", valign: "middle", margin: 0, color: P.watch,
  });
  s.addText(
    "귀농귀촌센터·농업기술센터·농협 상담 창구를 첫 실증 파트너로 제안하고, " +
    "반복 사용이 확인되면 기관용 연간 라이선스를 검토하겠습니다.", {
    x: 5.88, y: 5.8, w: 6.62, h: 0.86,
    fontFace: F, fontSize: 12.5, margin: 0, valign: "top", color: P.ink, lineSpacingMultiple: 1.3,
  });
  slideNo(s, 7);
  s.addNotes(
    "[25초]\n" +
    "농지 계약 전, 작물을 바꿀 때, 파종 전에 다시 옵니다. 재방문율은 아직 측정하지 않았습니다. " +
    "유료 고객과 확정 가격도 없습니다. 귀농귀촌센터·농업기술센터·농협 상담 창구를 첫 실증 파트너로 제안하고, " +
    "반복 사용이 확인되면 기관용 연간 라이선스를 검토하겠습니다.\n\n" +
    "「제안」과 「검토」를 반드시 말로도 붙인다. 금지 — 「센터가 매일 쓴다」, 기관 도입 확정, 시장 규모 수치, 라이선스 금액."
  );
}

/* ── S8 · 25초 · 못 하는 것 ───────────────────────────────────────────────── */
{
  const s = lightSlide();
  evidenceTag(s, "화면 근거 · 03 관측·판정 방식");
  claim(s, "못 하는 것을 화면에 적어 두고, 다음 검증 순서를 정해 두었습니다", { y: 0.9, size: 28 });
  const limits = [
    ["토양 산도 조회율", "대관령 반경 1km · 258필지 중 18건 = 7.0%", "없는 값을 다른 농지에서 채우지 않습니다"],
    ["예보 기간", "3일 단기예보만 · 중기예보 미구현", "선택 기간을 넘는 위험은 말하지 않습니다"],
    ["가장 가까운 관측소", "6.45km · 강릉 안반덕이", "거리를 적고 점수에 넣지 않습니다"],
  ];
  limits.forEach(([label, fact, note], i) => {
    const y = 2.36 + i * 1.14;
    s.addShape("roundRect", {
      x: M, y, w: 7.3, h: 0.98, rectRadius: 0.06,
      fill: { color: P.sf }, line: { color: P.line, width: 1 },
    });
    s.addText(label, {
      x: M + 0.22, y: y + 0.09, w: 3.0, h: 0.3,
      fontFace: F, fontSize: 13, bold: true, margin: 0, color: P.inkSoft,
    });
    s.addText(fact, {
      x: M + 0.22, y: y + 0.38, w: 6.9, h: 0.3,
      fontFace: F, fontSize: 14.5, bold: true, margin: 0, color: P.ink,
    });
    s.addText(note, {
      x: M + 0.22, y: y + 0.66, w: 6.9, h: 0.28,
      fontFace: F, fontSize: 12, margin: 0, color: P.inkSoft,
    });
  });
  s.addText("현장 정확도는 아직 검증하지 않았습니다. 그래서 참고 판정으로 한정합니다.", {
    x: M, y: 5.86, w: 7.3, h: 0.34,
    fontFace: F, fontSize: 14.5, bold: true, margin: 0, color: P.bad,
  });
  captureFrame(s, {
    x: 8.16, y: 2.36, w: 4.56, h: 1.72, shot: "20260805_C10_최근관측_관측소거리",
    tag: "C10 · 03 최근 관측 기록",
    spec: "관측소 이름·거리 +\n「점수에 가산하지 않습니다」 문구까지",
  });
  captureFrame(s, {
    x: 8.16, y: 4.22, w: 4.56, h: 1.98, shot: "20260805_C11_현재판정방식",
    tag: "C11 · 03 현재 판정 방식",
    spec: "판정 방식 라벨 + 요구 상태 목록.",
  });
  slideNo(s, 8);
  s.addNotes(
    "[25초]\n" +
    "세 가지만 말씀드립니다. 대관령 표본의 토양 산도 조회는 258필지 중 18건, 7.0%였고 없는 값을 다른 농지에서 채우지 않습니다. " +
    "예보는 3일이고, 관측소는 6.45km 떨어져 점수에 넣지 않습니다. 현장 정확도는 아직 없습니다. " +
    "그래서 참고 판정으로 한정합니다.\n\n" +
    "7.0%는 반드시 분모와 함께 말한다. 금지 — 한계 네 개 이상 나열(나머지는 질의응답), 과수·논 등급 미반영, 중기예보 구현 주장."
  );
}

/* ── S9 · 12초 · 마무리 ───────────────────────────────────────────────────── */
{
  const s = darkSlide();
  s.addText("농지 경계부터 근거의 출처까지,\n내 땅 단위 참고 판정입니다", {
    x: M, y: 1.9, w: 6.9, h: 1.9,
    fontFace: F, fontSize: 31, bold: true, margin: 0, valign: "top",
    color: P.sf, lineSpacingMultiple: 1.16,
  });
  s.addShape("roundRect", {
    x: M, y: 4.22, w: 2.02, h: 0.46, rectRadius: 0.23,
    fill: { color: P.cyVivid }, line: { color: P.cyVivid, width: 1 },
  });
  s.addText("밭보다", {
    x: M, y: 4.22, w: 2.02, h: 0.46,
    fontFace: F, fontSize: 17, bold: true, align: "center", valign: "middle", margin: 0, color: P.sf,
  });
  s.addText("batboda.vercel.app", {
    x: M + 2.24, y: 4.22, w: 4.4, h: 0.46,
    fontFace: F, fontSize: 19, bold: true, margin: 0, valign: "middle", color: P.cyPale,
  });
  s.addText("지금 열어 보실 수 있습니다.", {
    x: M, y: 5.02, w: 6.9, h: 0.34,
    fontFace: F, fontSize: 15, margin: 0, color: P.deepSoft,
  });
  captureFrame(s, {
    x: 7.86, y: 1.62, w: 2.3, h: 2.3, dark: true, shot: "20260805_C12_QR", tag: "C12 · QR",
    spec: "batboda.vercel.app\nQR. 여백 포함.",
  });
  captureFrame(s, {
    x: 10.42, y: 1.62, w: 2.3, h: 2.3, dark: true, shot: "20260805_C01_대관령85-61전_경계", tag: "C1 · 경계",
    spec: "S2와 같은 조각.",
  });
  slideNo(s, 9, true);
  s.addNotes(
    "[12초]\n" +
    "내 농지를 경계로 확인하고, 같은 농지의 근거를 끝까지 되짚는 밭보다입니다. 지금 열어 보실 수 있습니다.\n\n" +
    "금지 — 새 기능·수치·로드맵, 감사 인사 전용 장, 팀 사진, 연락처.\n" +
    "여기서 멈추고 질의응답으로 넘어간다. 답변은 대본 v3 5절 28문."
  );
}

const out = process.argv[2];
deck.writeFile({ fileName: out }).then(() => console.log("wrote " + out));
