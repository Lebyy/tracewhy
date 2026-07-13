import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraceWhy — Local comparison report",
  description: "Deterministic evidence explaining why a command works in one environment and fails in another.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
