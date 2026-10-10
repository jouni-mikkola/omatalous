/** A bank's official logo on a white plate. */
export function BankLogo({ src, name, size = "md" }: { src: string | null; name: string; size?: "sm" | "md" }) {
  if (!src) return <span className={`bank-logo bank-logo-${size} bank-logo-text`}>{name}</span>;
  return (
    <span className={`bank-logo bank-logo-${size}`}>
      <img src={src} alt={name} />
    </span>
  );
}
