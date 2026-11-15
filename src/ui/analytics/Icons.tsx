import type { ReactNode } from 'react';

/** Small line icons, drawn inline so the app needs no icon library. Decorative only. */

function Icon({ children, className = 'h-5 w-5' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const SessionsIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M8 2v4M16 2v4M3 10h18" />
  </Icon>
);

export const CardsIcon = () => (
  <Icon>
    <rect x="6" y="3" width="14" height="16" rx="2" />
    <path d="M4 7v12a2 2 0 0 0 2 2h10" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </Icon>
);

export const CrossIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </Icon>
);

export const TargetIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </Icon>
);

export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const BoltIcon = () => (
  <Icon>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Icon>
);

export const FlameIcon = () => (
  <Icon>
    <path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-5 5-5 8 0 4 3 7 7 7z" />
  </Icon>
);

export const TrophyIcon = () => (
  <Icon>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M17 6h3a3 3 0 0 1-3 4M7 6H4a3 3 0 0 0 3 4" />
  </Icon>
);

export const ArrowUpIcon = ({ className }: { className?: string }) => (
  <Icon className={className ?? 'h-4 w-4'}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const ArrowDownIcon = ({ className }: { className?: string }) => (
  <Icon className={className ?? 'h-4 w-4'}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const LightbulbIcon = () => (
  <Icon>
    <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z" />
  </Icon>
);
