import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * 본문·판정·제목을 한 얼굴로 쓴다.
 *
 * 세리프 제목(Noto Serif KR)은 명조 인상이 강해 초보 귀농인 대상에 무겁게 읽혔다.
 * 판정서 문법은 글꼴 대비가 아니라 크기·굵기·괘선으로 만든다.
 *
 * Pretendard는 Google Fonts에 없어 파일을 저장소에 두고 자체 호스팅한다. 같은 출처에서
 * 내려오므로 시연 중 외부 CDN이 막혀도 글꼴이 바뀌지 않는다.
 *
 * 가변 글꼴을 쓴다. 화면 곳곳이 `font-weight: 750`처럼 표준 굵기 사이 값을 쓰고 있어
 * 고정 굵기 파일로는 그 무게가 나오지 않는다. 세 굵기를 따로 받으면 용량도 더 크다.
 */
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  weight: "45 920",
  style: "normal",
  variable: "--pretendard",
  display: "swap",
  // 파일을 받는 동안 대체 글꼴로 먼저 그린다. 자리 크기를 맞춰 두면 글꼴이 바뀔 때 글이 밀리지 않는다.
  adjustFontFallback: "Arial",
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"],
});

export const metadata: Metadata = {
  title: "밭보다 | 농지 환경 판정서",
  description:
    "농지 위치와 작물, 기간을 바탕으로 재배 판단 단계와 가까운 기간의 위험을 공식 기준과 대조해 설명합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>{children}</body>
    </html>
  );
}
