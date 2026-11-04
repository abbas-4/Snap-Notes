function parts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
  };
}

/** A stopwatch reading: "0:05", "12:34", or "1:02:03" past an hour. */
export function formatElapsed(ms: number): string {
  const { hours, minutes, seconds } = parts(ms);
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/** The same duration in words, for screen readers: "1 minute 5 seconds". */
export function spokenDuration(ms: number): string {
  const { hours, minutes, seconds } = parts(ms);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const words = [
    hours > 0 && unit(hours, 'hour'),
    minutes > 0 && unit(minutes, 'minute'),
    (seconds > 0 || (hours === 0 && minutes === 0)) && unit(seconds, 'second'),
  ];
  return words.filter(Boolean).join(' ');
}
