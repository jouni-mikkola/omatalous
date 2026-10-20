/**
 * A bank's logo on a white plate. The plate holds the bank's name until the picture has loaded, and keeps it when
 * there is no picture or the picture fails: a logo the server fetches from Enable Banking may be slow or missing.
 */
import { useLayoutEffect, useRef, useState } from "react";
import "../styles/banks.css";
import { logoForInstitution } from "../banks.ts";
import type { BankOption } from "../types.ts";
import { MerchantAvatar } from "./MerchantAvatar.tsx";

/**
 * What the plate shows for the picture at `src`: the name alone without a picture and after a failure, the name while
 * the picture loads, the picture once it is there. `loaded` and `failed` are the addresses the browser has answered for.
 */
export function plateShows(src: string | null, loaded: string | null, failed: string | null): "name" | "waiting" | "picture" {
  if (!src || failed === src) return "name";
  return loaded === src ? "picture" : "waiting";
}

export function BankLogo({ src, name, size = "md", decorative = false }: { src: string | null; name: string; size?: "sm" | "md" | "tile"; decorative?: boolean }) {
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
      <img ref={img} src={src} alt={decorative ? "" : name} hidden={shows === "waiting"} onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />
    </span>
  );
}

/** A name that says it is a bank's own ("ESIMERKKIPANKKI Luottokortti"): its logo is not the connection's. */
const NAMES_A_BANK = /pankki|bank/i;

/**
 * The logo of the bank an account is at: the bank its own name says when that is one with a logo, else the connection's
 * bank, unless the name says another bank that has none (a card of another bank on this connection).
 */
function bankLogoOf(name: string, institution: string | null, banks: readonly BankOption[]): { bank: string; src: string } | null {
  const own = logoForInstitution(name, banks);
  if (own) return { bank: name, src: own };
  if (!institution || NAMES_A_BANK.test(name)) return null;
  const src = logoForInstitution(institution, banks);
  return src ? { bank: institution, src } : null;
}

/**
 * The bank a card's face shows, by the rule of the account marks (`bankLogoOf`): its logo when there is one, else the
 * connection's bank in words, unless the card's name says another bank (a card of another bank on this connection).
 */
export function cardBankOf(name: string, institution: string | null, banks: readonly BankOption[]): { bank: string; src: string | null } | null {
  const logo = bankLogoOf(name, institution, banks);
  if (logo) return logo;
  return institution && !NAMES_A_BANK.test(name) ? { bank: institution, src: null } : null;
}

/**
 * The mark at the head of an account line: the bank's logo, else the account's initials, on one plate of one size so the
 * names below it start at one place. Decorative: the account's name stands beside it, and a bank's name in front of
 * it would change the name of the row.
 */
export function AccountMark({ name, institution, banks }: { name: string; institution: string | null; banks: readonly BankOption[] }) {
  const logo = bankLogoOf(name, institution, banks);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="acc-mark" aria-hidden="true">
      {!logo || failed === logo.src ? (
        <MerchantAvatar name={name} person={NAMES_A_BANK.test(name) ? false : undefined} wide />
      ) : (
        <span className="mk-plate mk-m mk-wide">
          <img className="mk-logo" src={logo.src} alt="" onError={() => setFailed(logo.src)} />
        </span>
      )}
    </span>
  );
}
