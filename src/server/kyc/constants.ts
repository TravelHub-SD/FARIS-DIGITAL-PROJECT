// Signed URLs for identity documents live for one minute: long enough to load
// the image in the review page, short enough that a copied link is useless.
export const KYC_SIGNED_URL_TTL_SECONDS = 60;
export const KYC_DOC_TYPES = [
  "national_id",
  "passport",
  "driving_license",
] as const;
export type KycDocType = (typeof KYC_DOC_TYPES)[number];
