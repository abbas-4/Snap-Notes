/** Shared Tailwind class strings, so controls look and focus the same everywhere. */

const buttonBase =
  'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50';

export const primaryButton = `${buttonBase} bg-indigo-600 text-white shadow-sm hover:bg-indigo-700`;

export const secondaryButton = `${buttonBase} border border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-50`;

export const dangerButton = `${buttonBase} border border-red-200 bg-white text-red-700 shadow-sm hover:bg-red-50 focus-visible:outline-red-600`;

export const textField =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-2 focus:outline-indigo-500 aria-invalid:border-red-400';
