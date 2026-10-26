/** SKYPACT mark: three converging tracks (three airports) meeting in a single coordinated arc. */
export function Logo({ size = 24, mono = false }: { size?: number; mono?: boolean }) {
  const c1 = mono ? "currentColor" : "#1d3557";
  const c2 = mono ? "currentColor" : "#1d7566";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="SKYPACT">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill={mono ? "none" : "#ffffff"} stroke={mono ? "currentColor" : "#d3cfc5"} />
      <path d="M6 22 C 11 12, 21 12, 26 22" fill="none" stroke={c1} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M9 22 C 12.5 16, 19.5 16, 23 22" fill="none" stroke={c2} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="9.5" r="2.4" fill={c1} />
      <circle cx="6" cy="22" r="1.7" fill={c2} />
      <circle cx="26" cy="22" r="1.7" fill={c2} />
      <circle cx="16" cy="22" r="1.7" fill={c1} />
    </svg>
  );
}
