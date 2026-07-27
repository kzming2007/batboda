import type { Metadata } from "next";
import { IBM_Plex_Sans_KR, Noto_Serif_KR } from "next/font/google";
import "./globals.css";

// 판정·제목은 세리프, 본문·조작은 산세리프로 나눈다. 시안 A의 판정서 문법을 따른다.
const serif = Noto_Serif_KR({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--serif",
  display: "swap",
});

const sans = IBM_Plex_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--sans-kr",
  display: "swap",
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
    <html lang="ko" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
