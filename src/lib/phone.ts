// Sudanese mobile numbers: +249 followed by 9 digits starting with 1 or 9
// (e.g. Zain 91x/96x, Sudani 12x/11x, MTN 92x/99x).
const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const i = ARABIC_INDIC.indexOf(ch);
    return String(i >= 0 ? i : EXTENDED_ARABIC_INDIC.indexOf(ch));
  });
}

/** Normalises user input to E.164 (+2499XXXXXXXX) or returns null. */
export function normalizeSudanPhone(input: string): string | null {
  let d = toLatinDigits(input).replace(/[\s\-().‎‏]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("249")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  return /^[19]\d{8}$/.test(d) ? `+249${d}` : null;
}

/** GoTrue stores phones without the leading "+". */
export function toAuthPhone(e164: string): string {
  return e164.replace(/^\+/, "");
}

/** Display form: +249 91 234 5678 */
export function formatPhone(e164: string): string {
  const m = /^\+249(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+249 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
