import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Psychosis Differential",
  description:
    "Bayesian-style symptom scoring tool for psychosis differential diagnosis. Educational use only — not FDA-cleared.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
