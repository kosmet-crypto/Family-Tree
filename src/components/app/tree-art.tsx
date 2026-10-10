/** Friendly decorative tree (roots, trunk, branches, leaves) in the theme colours. */
export function TreeArt({ className, size = 160 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 200 220" width={size} height={size * 1.1} className={className} aria-hidden="true" fill="none">
      <path d="M100 205c-4-18-2-34 0-52m0 52c4-18 2-34 0-52M100 205c-18 2-30 8-40 14M100 205c18 2 30 8 40 14" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" opacity=".55" />
      <path d="M92 205c2-30 3-60 2-92 0-8 4-12 6-12s6 4 6 12c-1 32 0 62 2 92z" fill="var(--accent)" opacity=".85" />
      <path d="M99 130c-14-6-26-14-34-30M101 118c14-6 26-16 32-32M100 150c-10-2-20-8-26-16M101 146c10-2 20-8 26-16" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" opacity=".85" />
      <g fill="var(--primary)">
        <circle cx="100" cy="52" r="30" opacity=".95" />
        <circle cx="64" cy="78" r="24" opacity=".85" />
        <circle cx="136" cy="76" r="25" opacity=".85" />
        <circle cx="78" cy="48" r="20" opacity=".7" />
        <circle cx="124" cy="46" r="20" opacity=".7" />
      </g>
      <g fill="var(--surface)" opacity=".55">
        <circle cx="90" cy="40" r="5" /><circle cx="118" cy="62" r="4" /><circle cx="60" cy="72" r="4" /><circle cx="140" cy="68" r="5" />
      </g>
      <g fill="var(--accent)">
        <circle cx="104" cy="70" r="5" /><circle cx="76" cy="86" r="4" /><circle cx="130" cy="90" r="4.5" /><circle cx="92" cy="30" r="3.5" />
      </g>
    </svg>
  );
}
