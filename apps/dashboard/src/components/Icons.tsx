interface IconProps {
  className?: string;
}

const base = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function CheckIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

export function CrossIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </svg>
  );
}

export function DashIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5.5 10h9" />
    </svg>
  );
}

/** A hypothesis: an open ring, deliberately not a check mark. */
export function RingIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10" cy="10" r="5.5" strokeDasharray="3 2.2" />
    </svg>
  );
}

export function ExternalIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={1.8}>
      <path d="M8 4.5H4.5v11h11V12M11 4.5h4.5V9M15.5 4.5L9 11" />
    </svg>
  );
}

export function ChevronIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7.5 5l5 5-5 5" />
    </svg>
  );
}

export function ArrowIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={1.8}>
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

/** Autonomy paused: two bars, the universal pause sign. */
export function PauseIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7.5 5v10M12.5 5v10" />
    </svg>
  );
}

export function TerminalIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={1.8}>
      <path d="M3.5 4.5h13v11h-13zM6.5 8.5l2.5 2-2.5 2M10.5 12.5h3" />
    </svg>
  );
}

export function MoonIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={1.8}>
      <path d="M15.5 12.5A6 6 0 0 1 7.5 4.5a6 6 0 1 0 8 8z" />
    </svg>
  );
}

export function SunIcon({ className = 'icon' }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={1.8}>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </svg>
  );
}
