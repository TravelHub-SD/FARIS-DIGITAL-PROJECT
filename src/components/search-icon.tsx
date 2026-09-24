// Inline SVG: lucide-react icons are client components, so even one icon in a
// Server Component adds its runtime to the page's JavaScript.
export function SearchIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={`${className} fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]`}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
