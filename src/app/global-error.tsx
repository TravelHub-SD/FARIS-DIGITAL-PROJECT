"use client";

// Last-resort boundary when the locale layout itself fails. It can't rely on
// next-intl or the theme, so it is plain bilingual HTML.
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100dvh",
          margin: 0,
          textAlign: "center",
        }}
      >
        <main>
          <h1>الخدمة غير متاحة مؤقتاً</h1>
          <p lang="en" dir="ltr">
            Temporarily unavailable
          </p>
          <button type="button" onClick={() => retry()}>
            إعادة المحاولة / Try again
          </button>
        </main>
      </body>
    </html>
  );
}
