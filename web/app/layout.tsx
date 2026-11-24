import type { Metadata } from "next";
import "./globals.css";
import "./research-layout.css";

export const metadata: Metadata = {
  title: "인스타오토",
  description: "계정별 콘텐츠 운영 관리자",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
