import { describe, expect, it } from "vitest";

import {
  type FieldDefinition,
  fieldDefinitionsSchema,
  validateFulfillment,
} from "@/lib/fulfillment";

const defs: FieldDefinition[] = [
  {
    key: "player_id",
    type: "digits",
    label_en: "Player ID",
    required: true,
    min_length: 5,
    max_length: 12,
  },
  {
    key: "server",
    type: "select",
    label_en: "Server",
    required: true,
    options: [
      { value: "mena", label_en: "MENA" },
      { value: "eu", label_en: "EU" },
    ],
  },
  { key: "target_phone", type: "phone", label_ar: "الرقم", required: false },
  { key: "email", type: "email", label_en: "Email", required: false },
  {
    key: "note",
    type: "text",
    label_en: "Note",
    required: false,
    max_length: 20,
  },
];

const valid = { player_id: "123456", server: "mena" };

describe("validateFulfillment (server-side)", () => {
  it("accepts a valid submission and normalises it", () => {
    expect(
      validateFulfillment(defs, {
        player_id: " ١٢٣٤٥٦ ", // Arabic-Indic digits, spaces
        server: "eu",
        target_phone: "0912345678",
        email: " a@b.co ",
        note: "",
      }),
    ).toEqual({
      ok: true,
      data: {
        player_id: "123456",
        server: "eu",
        target_phone: "+249912345678",
        email: "a@b.co",
      },
    });
  });

  it("rejects MISSING required fields", () => {
    expect(validateFulfillment(defs, {})).toEqual({
      ok: false,
      errors: { player_id: "missing", server: "missing" },
    });
    expect(
      validateFulfillment(defs, { player_id: "   ", server: "mena" }),
    ).toEqual({
      ok: false,
      errors: { player_id: "missing" },
    });
  });

  it("rejects EXTRA fields the variant does not declare", () => {
    expect(
      validateFulfillment(defs, { ...valid, evil: "x", __proto__x: "y" }),
    ).toEqual({
      ok: false,
      errors: { evil: "unknown", __proto__x: "unknown" },
    });
  });

  it.each([
    ["number", 123456],
    ["boolean", true],
    ["array", ["123456"]],
    ["object", { v: "123456" }],
    ["file", new Blob(["123456"])],
  ])("rejects WRONG-TYPED values (%s)", (_label, value) => {
    expect(validateFulfillment(defs, { ...valid, player_id: value })).toEqual({
      ok: false,
      errors: { player_id: "type" },
    });
  });

  it.each([
    ["player_id", "12a456", "format"],
    ["player_id", "1234", "length"],
    ["player_id", "1234567890123", "length"],
    ["server", "asia", "option"],
    ["target_phone", "12345", "format"],
    ["email", "not-an-email", "format"],
    ["note", "x".repeat(21), "length"],
    ["note", "line\u0000break", "format"],
  ])("rejects %s=%j (%s)", (key, value, code) => {
    expect(validateFulfillment(defs, { ...valid, [key]: value })).toEqual({
      ok: false,
      errors: { [key]: code },
    });
  });
});

describe("field definitions schema (admin input)", () => {
  it("accepts the seed-style definitions", () => {
    expect(fieldDefinitionsSchema.safeParse(defs).success).toBe(true);
  });

  it.each([
    [
      "regex type (ReDoS risk, not supported)",
      [{ key: "a", type: "regex", label_en: "A", required: true }],
    ],
    [
      "unknown property",
      [
        {
          key: "a",
          type: "text",
          label_en: "A",
          required: true,
          pattern: ".*",
        },
      ],
    ],
    ["no label", [{ key: "a", type: "text", required: true }]],
    ["bad key", [{ key: "A-b", type: "text", label_en: "A", required: true }]],
    [
      "duplicate keys",
      [
        { key: "a", type: "text", label_en: "A", required: true },
        { key: "a", type: "text", label_en: "B", required: false },
      ],
    ],
    [
      "select without options",
      [{ key: "a", type: "select", label_en: "A", required: true }],
    ],
    [
      "options on non-select",
      [
        {
          key: "a",
          type: "text",
          label_en: "A",
          required: true,
          options: [{ value: "x", label_en: "X" }],
        },
      ],
    ],
    [
      "length on email",
      [
        {
          key: "a",
          type: "email",
          label_en: "A",
          required: true,
          max_length: 10,
        },
      ],
    ],
    [
      "min > max",
      [
        {
          key: "a",
          type: "text",
          label_en: "A",
          required: true,
          min_length: 9,
          max_length: 3,
        },
      ],
    ],
    [
      "11 fields",
      Array.from({ length: 11 }, (_, i) => ({
        key: `f${i}`,
        type: "text",
        label_en: "F",
        required: false,
      })),
    ],
  ])("rejects %s", (_label, value) => {
    expect(fieldDefinitionsSchema.safeParse(value).success).toBe(false);
  });
});
