import { dirOf, type LocalizedText } from "@/lib/localized";

/** Renders bilingual content; fallback text carries its own lang/dir. */
export function L10n({
  value,
  as: Tag = "span",
  className,
}: {
  value: LocalizedText | null;
  as?: "span" | "p" | "h1" | "h2" | "h3";
  className?: string;
}) {
  if (!value) return null;
  return value.fallback ? (
    <Tag
      lang={value.lang}
      dir={dirOf(value.lang)}
      className={className}
      data-fallback=""
    >
      {value.text}
    </Tag>
  ) : (
    <Tag className={className}>{value.text}</Tag>
  );
}
