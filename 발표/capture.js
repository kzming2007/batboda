/*
  본선 발표 캡처 13건 — 배포본에서 잡는다.

  근거: docs/20260805_발표자료_내용설계_v1.md 3절 「캡처 목록」
  대상: https://batboda.vercel.app (로컬 서버 화면은 쓰지 않는다)
  배율: deviceScaleFactor 2 — 프로젝터에서 글자가 읽혀야 한다.

  선택자는 2026-08-05 배포본에서 직접 확인했다. 화면 구조가 바뀌면 여기가 먼저 깨진다.
*/
// puppeteer-core는 ESM이라 require로 못 불러온다. 실행부에서 동적 import 한다.
let puppeteer;
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SITE = "https://batboda.vercel.app";
const OUT = process.argv[2] || "D:/Projects/batboda/발표/캡처";

const log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 여러 선택자에 걸린 요소를 모두 감싸는 사각형. 없으면 null. */
async function unionRect(page, selectors, pad = 10) {
  return page.evaluate(
    (sels, pad) => {
      const els = sels.flatMap((s) => [...document.querySelectorAll(s)]).filter((e) => e.offsetParent !== null || e.getClientRects().length);
      if (!els.length) return null;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const e of els) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        x1 = Math.min(x1, r.left + scrollX); y1 = Math.min(y1, r.top + scrollY);
        x2 = Math.max(x2, r.right + scrollX); y2 = Math.max(y2, r.bottom + scrollY);
      }
      if (x1 === Infinity) return null;
      return {
        x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad),
        width: Math.min(document.documentElement.scrollWidth, x2 - x1 + pad * 2),
        height: y2 - y1 + pad * 2,
      };
    },
    selectors, pad,
  );
}

/** 제목 글자로 절을 찾아 그 절 전체의 선택자 경로를 돌려준다. */
async function markByHeading(page, needle, marker) {
  return page.evaluate(
    (needle, marker) => {
      const nodes = [...document.querySelectorAll("main *")];
      const hit = nodes.find((e) => {
        const t = (e.textContent || "").trim();
        return t.startsWith(needle) && t.length < needle.length + 400 && e.children.length > 0;
      });
      if (!hit) return false;
      // 제목을 담은 가장 가까운 절 단위로 올라간다.
      let box = hit;
      for (let i = 0; i < 4 && box.parentElement; i++) {
        if (/section|group|docket|calculation|showcase|evidence/.test(String(box.className))) break;
        box = box.parentElement;
      }
      box.setAttribute("data-shot", marker);
      return true;
    },
    needle, marker,
  );
}

async function shot(page, name, selectors, { pad = 10, note = "" } = {}) {
  const rect = await unionRect(page, selectors, pad);
  if (!rect) { log.push(`SKIP ${name} — 선택자를 찾지 못했다: ${selectors.join(", ")}`); return false; }
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, clip: rect });
  log.push(`OK   ${name}  ${Math.round(rect.width)}x${Math.round(rect.height)}  ${note}`);
  return true;
}

/** 01에서 지번으로 후보를 걸러 확정한다. */
async function confirmParcel(page, placeIndex, jibun) {
  await page.evaluate((i) => document.querySelectorAll(".place-shortcuts button")[i].click(), placeIndex);
  await sleep(2500);
  await page.evaluate(() => document.querySelector(".parcel-finder-heading > button").click());
  await sleep(6000);
  await page.evaluate((j) => {
    const inp = document.querySelector(".candidate-search-row input");
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    d.set.call(inp, j);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, jibun);
  await sleep(1200);
  const found = await page.evaluate(() => {
    const row = document.querySelector(".parcel-candidate-row");
    if (!row) return null;
    const btn = row.querySelector("button:not(.candidate-favorite)");
    if (!btn) return null;
    const label = (btn.textContent || "").trim();
    btn.click();
    return label;
  });
  await sleep(4000);
  return found;
}

async function pick(page, sel, needle) {
  return page.evaluate((sel, needle) => {
    const b = [...document.querySelectorAll(sel)].find((e) => (e.textContent || "").includes(needle));
    if (!b) return false;
    b.click(); return true;
  }, sel, needle);
}

async function analyze(page) {
  await page.evaluate(() => document.querySelector(".analyze-button").click());
  await sleep(11000);
  return page.evaluate(() => (document.querySelector(".sheet-verdict") || {}).textContent || null);
}

const tab = async (page, n) => {
  await page.evaluate((n) => document.querySelectorAll(".phase-nav button")[n].click(), n);
  await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
};

(async () => {
  puppeteer = (await import("puppeteer-core")).default;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--window-size=1500,1000", "--hide-scrollbars"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  /* ── 조합 1 · 대관령면 85-61전 · 상추 · 3일 ─────────────────────────────── */
  await page.goto(SITE, { waitUntil: "networkidle2" });
  await sleep(2500);

  // 즐겨찾기 두 건을 먼저 담아 둔다(C9). 후보 목록이 열려 있을 때만 가능하다.
  await page.evaluate(() => document.querySelector(".parcel-finder-heading > button").click());
  await sleep(6000);
  const starred = await page.evaluate(() => {
    const stars = [...document.querySelectorAll(".candidate-favorite")].slice(0, 2);
    stars.forEach((s) => s.click());
    return stars.length;
  });
  await sleep(1800);
  const favCount = await page.evaluate(() =>
    document.querySelectorAll(".favorite-shortcuts .favorite-item, .favorite-shortcuts button").length
    + (document.querySelector(".favorite-empty") ? 0 : 0));
  log.push(`즐겨찾기 ${starred}건 눌렀고 목록에 ${favCount}건 보인다`);

  const p1 = await confirmParcel(page, 0, "85-61");
  log.push(`조합1 확정: ${p1}`);

  await pick(page, ".crop-option", "상추");
  await sleep(800);
  await pick(page, ".period-options button", "3일");
  await sleep(800);

  // C1 — 01-B 실제 농지 확인. 경계 폴리곤이 주역이므로 지도 틀 전체를 잡는다.
  await shot(page, "20260805_C01_대관령85-61전_경계", [".map-frame", ".map-parcel-card"], { pad: 0 });
  // C9 — 내 농지 즐겨찾기 목록
  await shot(page, "20260805_C09_내농지_즐겨찾기", [".favorite-shortcuts"], { pad: 12 });

  const verdict = await analyze(page);
  log.push(`조합1 판정: ${verdict}`);

  // C2 — 02 판정서 상단
  await tab(page, 1);
  await shot(page, "20260805_C02_판정서_상단", [".sheet-masthead", ".status-strip", ".sheet-columns"], { pad: 14 });

  // 03 — 아코디언을 모두 펼친다
  await tab(page, 2);
  await page.evaluate(() => { const b = document.querySelector(".evidence-expand"); if (b) b.click(); });
  await sleep(1400);

  // C3 — pH 줄과 기온 줄
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".factor-row")];
    rows.forEach((r) => {
      const t = (r.textContent || "");
      if (/산도|pH/.test(t) || /기온/.test(t)) r.setAttribute("data-shot", "c3");
    });
  });
  await shot(page, "20260805_C03_산도_기온_눈금", ['[data-shot="c3"]'], { pad: 12 });

  // C4 — 사용한 자료 표 전체
  await shot(page, "20260805_C04_사용한자료_표", [".source-table-section"], { pad: 12 });
  // C4-b — 상태·기준시각 열만
  await shot(page, "20260805_C04b_상태_기준시각", [".source-table-state", ".source-state-row"], { pad: 10 });
  // C10 — 최근 관측 기록
  await shot(page, "20260805_C10_최근관측_관측소거리", [".station-docket"], { pad: 12 });
  // C11 — 현재 판정 방식과 요구 상태 목록
  await shot(page, "20260805_C11_현재판정방식", [".requirement-coverage"], { pad: 12 });
  // C8 — 설명 문장을 만드는 과정 5단계
  await shot(page, "20260805_C08_설명생성_5단계", [".report-pipeline-block"], { pad: 12 });
  // 계산 근거 — 산식을 조각별로 칠한 자리. 질의응답 백업으로 잡아 둔다.
  await shot(page, "20260805_C14_계산근거_산식", [".calculation-section"], { pad: 12 });

  // 04
  await tab(page, 3);
  await shot(page, "20260805_C07_04_상단_결론과근거", [".report-head-row", ".showcase-headline", ".showcase-basis"], { pad: 14 });
  await shot(page, "20260805_C13_04_하단_먼저할일_현장확인", [".showcase-checklist"], { pad: 14 });

  /* ── 조합 2·3 · 이천 유방동 870답 · 사과 / 상추 ─────────────────────────── */
  await page.goto(SITE, { waitUntil: "networkidle2" });
  await sleep(2500);
  const p2 = await confirmParcel(page, 2, "870");
  log.push(`조합2 확정: ${p2}`);

  for (const [crop, name] of [["사과", "C05_유방동870답_사과_과수등급"], ["상추", "C06_유방동870답_상추_밭등급"]]) {
    await pick(page, ".crop-option", crop);
    await sleep(900);
    const v = await analyze(page);
    log.push(`${crop} 판정: ${v}`);
    await tab(page, 1);
    /*
      토양 적성 카드 + 위에 농지 주소 한 줄. 두 캡처가 같은 배율·같은 잘라내기여야
      「같은 농지」라는 주장이 선다. 02의 카드는 클래스가 없어 자리로 고른다 —
      첫 칸이 토양 적성이다.
    */
    const gradeText = await page.evaluate(() => {
      const card = document.querySelector(".sheet-columns > *:first-child");
      if (card) card.setAttribute("data-shot", "grade");
      return card ? (card.textContent || "").trim().slice(0, 30) : null;
    });
    await shot(page, "20260805_" + name, [".sheet-subject", '[data-shot="grade"]'], { pad: 14, note: gradeText || "" });
    await tab(page, 0);
    await sleep(600);
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "_캡처기록.txt"), log.join("\n") + "\n", "utf8");
  console.log(log.join("\n"));
})().catch((e) => { console.error("실패: " + e.message); console.log(log.join("\n")); process.exit(1); });
