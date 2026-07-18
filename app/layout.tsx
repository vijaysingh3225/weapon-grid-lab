import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weapon Grid Lab",
  description: "Local weapon-grid growth and artifact structure simulator.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

