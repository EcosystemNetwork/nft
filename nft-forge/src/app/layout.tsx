import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NFT Forge",
  description: "Design, generate, validate and export generative NFT collections.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
