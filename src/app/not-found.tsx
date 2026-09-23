"use client";

import NextError from "next/error";

// Requests that never reach a locale segment (outside the proxy matcher).
export default function GlobalNotFound() {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <NextError statusCode={404} />
      </body>
    </html>
  );
}
