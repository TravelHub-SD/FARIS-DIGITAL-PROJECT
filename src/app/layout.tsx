// The real root layout is app/[locale]/layout.tsx (it owns <html lang dir>).
// This pass-through exists only because app/not-found.tsx needs a parent layout.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
