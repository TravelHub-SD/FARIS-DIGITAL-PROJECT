import type messages from "../../messages/en.json";

// Keys for translations chosen at runtime (error codes, enum values).
export type AuthErrorKey = keyof (typeof messages)["Auth"]["errors"];
export type KycErrorKey = keyof (typeof messages)["Kyc"]["errors"];
export type KycDocTypeKey = keyof (typeof messages)["Kyc"]["docTypes"];
