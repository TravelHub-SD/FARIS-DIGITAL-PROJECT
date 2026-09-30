// Inline SVG icons (no icon library: lucide's are client components and
// would ship JavaScript on every page; decisions.md, Phase 4). Decorative:
// the element next to them carries the accessible name.
type IconProps = { className?: string };

function Svg({
  className = "size-5",
  children,
  fill = false,
}: IconProps & { children: React.ReactNode; fill?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1Z" />
  </Svg>
);
export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <rect x="13" y="13" width="7" height="7" rx="2" />
  </Svg>
);
export const CartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2" />
    <circle cx="9.5" cy="19" r="1.4" />
    <circle cx="16.5" cy="19" r="1.4" />
  </Svg>
);
export const ReceiptIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
);
export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
);
export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8Z" />
    <path d="M9.5 9.5c0 2.5 2.5 5 5 5l1-1.5-2-1-1 .8a4 4 0 0 1-2.3-2.3l.8-1-1-2Z" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);
export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 5 6v6c0 4 3 7.5 7 9 4-1.5 7-5 7-9V6Z" />
  </Svg>
);
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </Svg>
);
