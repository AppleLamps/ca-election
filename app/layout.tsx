import type { Metadata } from "next";
import "./global.css";

export const metadata: Metadata = {
  title: "California Governor 2026 Primary Live Tracker",
  description: "Live results and real-time second-place runoff battle analysis.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="film-grain" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
