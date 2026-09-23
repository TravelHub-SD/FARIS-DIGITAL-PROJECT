// Static brand/contact facts from docs/spec.md §10. Values the owner edits at
// runtime (bank accounts, banner, KYC threshold, …) live in the database, not here.
export const siteConfig = {
  timeZone: "Africa/Khartoum",
  socialHandle: "farishassanz",
  social: {
    facebook: "https://www.facebook.com/farishassanz",
    instagram: "https://www.instagram.com/farishassanz",
    x: "https://x.com/farishassanz",
    telegram: "https://t.me/farishassanz",
  },
} as const;
