interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
}

/** A native progress bar, so assistive technology reports it as one. */
export default function ProgressBar({ value, max, label }: ProgressBarProps) {
  return (
    <progress
      value={value}
      max={Math.max(max, 1)}
      aria-label={label}
      className="h-2 w-full appearance-none overflow-hidden rounded-full bg-gray-200 [&::-moz-progress-bar]:bg-indigo-600 [&::-webkit-progress-bar]:bg-gray-200 [&::-webkit-progress-value]:bg-indigo-600 [&::-webkit-progress-value]:transition-all"
    />
  );
}
