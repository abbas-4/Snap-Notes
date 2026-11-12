import type { ReactNode } from 'react';

const TONES = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-green-200 bg-green-50 text-green-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-indigo-200 bg-indigo-50 text-indigo-900',
} as const;

interface NoticeProps {
  tone: keyof typeof TONES;
  children: ReactNode;
  /** `alert` interrupts (errors); `status` waits its turn. Omit for text that is not news. */
  role?: 'alert' | 'status';
  id?: string;
  className?: string;
}

/** The boxed messages used across the app, in one place for the account screens. */
export default function Notice({ tone, children, role, id, className = '' }: NoticeProps) {
  return (
    <div
      id={id}
      role={role}
      className={`rounded-lg border px-3 py-2 text-sm ${TONES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
