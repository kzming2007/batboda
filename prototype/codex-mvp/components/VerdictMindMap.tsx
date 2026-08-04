"use client";

import { useEffect, useMemo, useState } from "react";
import { StateBadge, toneForState, type BadgeTone } from "@/components/StateBadge";
import type { AnalysisResult, AnalysisSource, FactorState } from "@/types/domain";

/**
 * 판정을 가운데 두고 판단 근거를 가지로 펼친다.
 *
 * 앞선 화면은 모든 근거를 한 번에 펼쳐 놓아 글자가 너무 많았다. 훑을 때 무엇이 걸리는지 보이지
 * 않고, 중장년층에게는 더 어렵다는 지적을 받았다. 여기서는 **가지마다 이름과 값 한 줄만** 두고,
 * 자세한 것은 눌렀을 때만 연다. 화면에 늘 떠 있어야 하는 정보와 필요할 때 꺼내 보는 정보를 나눈다.
 *
 * 가지에 붙은 확인칸은 **PDF에 담을 항목**을 고르는 자리다. 판정을 바꾸는 스위치가 아니다.
 * 무엇을 골라도 판정과 값은 그대로다.
 */

type MapNode = {
  id: string;
  label: string;
  value: string;
  state: FactorState;
  target: string | null;
  impact: string | null;
  sourceId: AnalysisSource["id"];
  /** 눌렀을 때만 보여줄 줄. 가지에는 올리지 않는다. */
  extra: string[];
};

/** 어떤 자료에서 온 값인지 가지마다 못박는다. 팝업이 출처를 지어내지 않게 한다. */
const factorSource: Record<string, AnalysisSource["id"]> = {
  ph: "soil",
  "upland-suitability": "soil",
  drainage: "soil",
  "electrical-conductivity": "soil",
  "organic-matter": "soil",
  temperature: "forecast",
  risk: "forecast",
};

function buildNodes(result: AnalysisResult): MapNode[] {
  const nodes: MapNode[] = result.factors.map((factor) => ({
    id: factor.id,
    label: factor.label,
    value: factor.value,
    // 값이 없는 것과 기준을 벗어난 것은 다르다. 없는 값을 주의색으로 칠하면 흙에 문제가 있어 보인다.
    state: factor.value.trim() === "자료 없음" ? "unknown" : factor.state,
    target: factor.target || null,
    impact: factor.impact || null,
    sourceId: factorSource[factor.id] ?? "soil",
    extra: [],
  }));

  nodes.push({
    id: "risk",
    label: `가까운 ${result.selection.horizonDays}일 위험`,
    value: result.riskLabel,
    state: result.riskLevel === "low" ? "good" : result.riskLevel === "high" ? "risk" : "watch",
    target: null,
    impact: null,
    sourceId: "forecast",
    extra: result.weather.days.map(
      (day) =>
        `${day.label} ${day.minTemp ?? "–"}~${day.maxTemp ?? "–"}℃ · 비 ${day.rainProbability ?? "–"}%`,
    ),
  });

  return nodes;
}

function stageTone(label: string): BadgeTone {
  if (label === "적합") return "good";
  if (label === "조건부 적합") return "watch";
  return "bad";
}

export default function VerdictMindMap({ result }: { result: AnalysisResult }) {
  const nodes = useMemo(() => buildNodes(result), [result]);
  const sourceById = useMemo(
    () => new Map(result.sources.map((source) => [source.id, source])),
    [result.sources],
  );

  // 처음에는 모두 담는다. 빼는 편이 고르는 것보다 쉽다.
  //
  // 분석을 다시 돌리면 가지가 바뀌므로 고른 항목도 처음으로 돌아가야 한다. 효과 안에서 상태를
  // 되돌리면 한 번 그린 뒤 다시 그리게 된다. 부모가 `key`로 이 컴포넌트를 다시 마운트한다.
  const [picked, setPicked] = useState<string[]>(() => nodes.map((node) => node.id));
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!openId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [openId]);

  const open = openId ? nodes.find((node) => node.id === openId) ?? null : null;
  const openSource = open ? sourceById.get(open.sourceId) ?? null : null;

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  // 왼쪽·오른쪽으로 갈라 가운데 판정을 사이에 둔다.
  const half = Math.ceil(nodes.length / 2);
  const sides = [nodes.slice(0, half), nodes.slice(half)];
  const pickedNodes = nodes.filter((node) => picked.includes(node.id));
  const tone = stageTone(result.suitabilityLabel);

  return (
    <>
      <section className="mindmap" aria-labelledby="mindmap-title">
        <h3 id="mindmap-title" className="mindmap-title">
          판정과 그 근거
          <small>가지를 누르면 그 항목의 값과 출처만 따로 봅니다</small>
        </h3>

        <div className="mindmap-board">
          {sides.map((side, index) => (
            <div className={`mindmap-side ${index === 0 ? "left" : "right"}`} key={index}>
              {side.map((node) => (
                <div className={`mindmap-branch ${toneForState(node.state)}`} key={node.id}>
                  <button
                    type="button"
                    className="branch-open"
                    onClick={() => setOpenId(node.id)}
                    aria-haspopup="dialog"
                  >
                    <span className="branch-label">{node.label}</span>
                    <strong className="branch-value">{node.value}</strong>
                    <StateBadge state={node.state} />
                  </button>
                  <label className="branch-pick">
                    <input
                      type="checkbox"
                      checked={picked.includes(node.id)}
                      onChange={() => toggle(node.id)}
                    />
                    <span>보고서에 담기</span>
                  </label>
                </div>
              ))}
            </div>
          ))}

          <div className={`mindmap-core ${tone}`}>
            <span>최종 판정</span>
            <strong>{result.suitabilityLabel}</strong>
            <small>
              {result.cropName} · 가까운 {result.selection.horizonDays}일
            </small>
          </div>
        </div>
      </section>

      <section className="next-actions" aria-labelledby="next-actions-title">
        <h3 id="next-actions-title">바로 해야 할 것</h3>
        <ol>
          {result.actions.map((action) => {
            const index = result.actions.indexOf(action);
            const note = result.report?.actionNotes[index]?.note ?? action.detail;
            return (
              <li key={action.title}>
                <div>
                  <span className="action-no">{action.priority}</span>
                  <h4>{action.title}</h4>
                  <time>{action.timing}</time>
                </div>
                <p>{note}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="pdf-plan" aria-labelledby="pdf-plan-title">
        <div className="pdf-plan-head">
          <div>
            <h3 id="pdf-plan-title">보고서로 내보내기</h3>
            <p>
              위에서 고른 {pickedNodes.length}개 항목이 목차가 됩니다. 설명 문장은 검사를 통과한
              것만 들어갑니다.
            </p>
          </div>
          <button
            type="button"
            className="pdf-button"
            onClick={() => window.print()}
            disabled={pickedNodes.length === 0}
          >
            PDF로 저장
          </button>
        </div>
        <ol className="pdf-toc">
          {pickedNodes.map((node, index) => (
            <li key={node.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{node.label}</strong>
              <em>{node.value}</em>
            </li>
          ))}
          {result.showcaseReport?.blocks.map((block, index) => (
            <li key={block.id} className="from-ai">
              <span>{String(pickedNodes.length + index + 1).padStart(2, "0")}</span>
              <strong>{block.heading}</strong>
              <em>AI 설명</em>
            </li>
          ))}
        </ol>
        {pickedNodes.length === 0 && (
          <p className="pdf-empty">항목을 하나도 고르지 않아 내보낼 것이 없습니다.</p>
        )}
      </section>

      {open && (
        <div className="branch-dialog-backdrop" onClick={() => setOpenId(null)}>
          <div
            className={`branch-dialog ${toneForState(open.state)}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="branch-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="branch-dialog-head">
              <div>
                <span>{open.label}</span>
                <strong id="branch-dialog-title">{open.value}</strong>
              </div>
              <button type="button" onClick={() => setOpenId(null)} aria-label="닫기">
                ✕
              </button>
            </div>
            <StateBadge state={open.state} />

            <dl className="branch-dialog-facts">
              {open.target && (
                <div>
                  <dt>공식 기준</dt>
                  <dd>{open.target}</dd>
                </div>
              )}
              {open.impact && (
                <div>
                  <dt>판정에서 한 역할</dt>
                  <dd>{open.impact}</dd>
                </div>
              )}
              {open.extra.map((line) => (
                <div key={line}>
                  <dt>실측</dt>
                  <dd>{line}</dd>
                </div>
              ))}
            </dl>

            {/* 값만 보여주고 어디서 왔는지 안 적으면 확인할 길이 없다. 출처를 같은 창에 붙인다. */}
            {openSource ? (
              <div className="branch-dialog-source">
                <span>이 값이 온 곳</span>
                <strong>{openSource.name}</strong>
                <p>{openSource.provider}</p>
                <ul>
                  {openSource.usedFields.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
                {/* 기준시각이 없는 자료가 있다. 빈 값 앞에 가운뎃점만 남으면 글이 깨져 보인다. */}
                <p className="branch-dialog-age">
                  {[openSource.observedAtLabel, openSource.ageNote].filter(Boolean).join(" · ")}
                </p>
              </div>
            ) : (
              <p className="branch-dialog-source empty">출처를 확인하지 못했습니다.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
