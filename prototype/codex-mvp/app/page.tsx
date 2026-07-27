import FarmDecisionApp from "@/components/FarmDecisionApp";
// 설명 생성 제공자 등록. 첫 화면도 같은 경로를 쓴다.
import "@/lib/report/providers";
import { runAnalysis } from "@/lib/analysis/service";

export default async function Home() {
  const initialResult = await runAnalysis({
    lat: 37.675,
    lng: 128.718,
    cropId: "lettuce",
    horizonDays: 3,
  }, "mock");
  return <FarmDecisionApp initialResult={initialResult} />;
}
