/*
  C5·C6 — 이천 유방동 870답에서 작물만 바꿔 토양 적성 카드를 두 번 잡는다.

  1차 실행에서 고정 대기 11초가 모자라 판정이 안 그려진 채로 넘어갔다.
  여기서는 `.sheet-verdict`가 실제로 나타날 때까지 기다린다.
*/
let puppeteer;
const fs = require("fs");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SITE = "https://batboda.vercel.app";
const OUT = "D:/Projects/batboda/발표/캡처";
const log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function unionRect(page, selectors, pad = 14) {
  return page.evaluate((sels, pad) => {
    const els = sels.flatMap((s) => [...document.querySelectorAll(s)]);
    if (!els.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      x1 = Math.min(x1, r.left + scrollX); y1 = Math.min(y1, r.top + scrollY);
      x2 = Math.max(x2, r.right + scrollX); y2 = Math.max(y2, r.bottom + scrollY);
    }
    if (x1 === Infinity) return null;
    return { x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad), width: x2 - x1 + pad * 2, height: y2 - y1 + pad * 2 };
  }, selectors, pad);
}

(async () => {
  puppeteer = (await import("puppeteer-core")).default;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--window-size=1500,1000", "--hide-scrollbars"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);

  await page.goto(SITE, { waitUntil: "networkidle2" });
  await sleep(2500);

  // 경기 이천 평야 농지로 핀을 옮기고 870으로 걸러 확정한다.
  await page.evaluate(() => document.querySelectorAll(".place-shortcuts button")[2].click());
  await sleep(3000);
  await page.evaluate(() => document.querySelector(".parcel-finder-heading > button").click());
  await page.waitForFunction(() => document.querySelectorAll(".parcel-candidate-row").length > 0, { timeout: 60000 });
  await page.evaluate(() => {
    const inp = document.querySelector(".candidate-search-row input");
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    d.set.call(inp, "870");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(1500);
  const confirmed = await page.evaluate(() => {
    const b = document.querySelector(".parcel-candidate-row button:not(.candidate-favorite)");
    if (!b) return null;
    const t = (b.textContent || "").trim(); b.click(); return t;
  });
  await page.waitForFunction(() => !document.querySelector(".analyze-button").disabled, { timeout: 60000 });
  log.push(`확정: ${confirmed}`);

  for (const [crop, name] of [["사과", "C05_유방동870답_사과_과수등급"], ["상추", "C06_유방동870답_상추_밭등급"]]) {
    await page.evaluate((c) => {
      const b = [...document.querySelectorAll(".crop-option")].find((e) => (e.textContent || "").includes(c));
      b.click();
    }, crop);
    await sleep(1000);

    // 판정서가 실제로 그려질 때까지 기다린다. 고정 대기로는 모자랐다.
    await page.evaluate(() => document.querySelector(".analyze-button").click());
    await page.waitForFunction(
      () => { const v = document.querySelector(".sheet-verdict"); return v && v.textContent.trim().length > 0; },
      { timeout: 90000 },
    );
    await sleep(1200);

    // 02로 이동해 첫 칸(토양 적성)과 농지 주소 한 줄을 같은 잘라내기로 잡는다.
    await page.evaluate(() => document.querySelectorAll(".phase-nav button")[1].click());
    await sleep(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    const info = await page.evaluate(() => {
      document.querySelectorAll('[data-shot="grade"]').forEach((e) => e.removeAttribute("data-shot"));
      const card = document.querySelector(".sheet-columns > *:first-child");
      if (card) card.setAttribute("data-shot", "grade");
      return {
        card: card ? (card.textContent || "").trim().slice(0, 34) : null,
        subject: (document.querySelector(".sheet-subject") || {}).textContent,
        verdict: (document.querySelector(".sheet-verdict") || {}).textContent,
      };
    });

    /*
      카드만 잡는다. 주소 한 줄까지 함께 감싸면 사이의 판정 블록까지 들어와
      높이가 800px을 넘고, 반쪽 슬라이드에서 글자가 안 읽힌다.
      「같은 농지」라는 사실은 슬라이드가 주소 줄로 따로 말한다.
    */
    const rect = await unionRect(page, ['[data-shot="grade"]']);
    if (!rect) { log.push(`SKIP ${name}`); continue; }
    await page.screenshot({ path: path.join(OUT, "20260805_" + name + ".png"), clip: rect });
    log.push(`OK   ${name}  ${Math.round(rect.width)}x${Math.round(rect.height)}  판정 ${info.verdict} · ${info.card}`);

    await page.evaluate(() => document.querySelectorAll(".phase-nav button")[0].click());
    await sleep(900);
  }

  await browser.close();
  fs.appendFileSync(path.join(OUT, "_캡처기록.txt"), log.join("\n") + "\n", "utf8");
  console.log(log.join("\n"));
})().catch((e) => { console.error("실패: " + e.message); console.log(log.join("\n")); process.exit(1); });
