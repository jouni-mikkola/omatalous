/**
 * A bank's logo on a white plate. The plate holds the bank's name until the picture has loaded, and keeps it when
 * there is no picture or the picture fails: a logo the server fetches from Enable Banking may be slow or missing.
 */
import { useLayoutEffect, useRef, useState } from "react";
import "../styles/banks.css";

/**
 * What the plate shows for the picture at `src`: the name alone without a picture and after a failure, the name while
 * the picture loads, the picture once it is there. `loaded` and `failed` are the addresses the browser has answered for.
 */
export function plateShows(src: string | null, loaded: string | null, failed: string | null): "name" | "waiting" | "picture" {
  if (!src || failed === src) return "name";
  return loaded === src ? "picture" : "waiting";
}

export function BankLogo({ src, name, size = "md" }: { src: string | null; name: string; size?: "sm" | "md" | "tile" }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  // a picture the browser already holds is drawn at once, without the name first
  useLayoutEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setLoaded(src);
  }, [src]);

  const shows = plateShows(src, loaded, failed);
  // the small plate sits beside the bank's name in a list: it stays empty while the picture loads, and a picture that
  // fails leaves no plate, as for a bank without a logo
  const beside = size === "sm";
  if (!src) return <span className={`bank-logo bank-logo-${size} bank-logo-text`}>{name}</span>;
  if (shows === "name") return beside ? null : <span className={`bank-logo bank-logo-${size} bank-logo-text`}>{name}</span>;
  const named = shows === "waiting" && !beside;
  return (
    <span className={`bank-logo bank-logo-${size}${named ? " bank-logo-text" : ""}`}>
      {named && name}
      <img ref={img} src={src} alt={name} hidden={shows === "waiting"} onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />
    </span>
  );
}
