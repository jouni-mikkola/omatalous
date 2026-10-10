/**
 * What a place rows come from gives core: an import parser turns a file's text into rows, and a dialect says
 * how that source words its own rows. Core never imports a concrete source from its domain code. The server
 * looks a parser up in sources/registry.ts.
 */
import type { RawTransaction } from "../types.ts";

export interface ImportResult {
  transactions: RawTransaction[];
  /** In Finnish, for the user. */
  errors: string[];
  /**
   * The exported account's own IBAN, when the file names it: the most
   * common payer on money out and payee on money in. Lets transfers to and
   * from another imported account pair up.
   */
  ownIban: string | null;
}

/**
 * How one source words its own rows. No source sets one yet: normalizeMerchant takes it as an argument when
 * the first one does, so the shared Finnish rules stay free of any one source.
 */
export interface SourceDialect {
  /** Cleans the texts this source puts in counterparty and description, before the shared normaliser. */
  prepare?(t: { counterparty: string | null; description: string | null }): { counterparty: string | null; description: string | null };
}

export interface ImportParser {
  /** Names the parser in the registry. Rows of a file import are stored with the source "csv", not this id. */
  readonly id: string;
  /** Shown in the UI. */
  readonly label: string;
  readonly accepts: { extensions: readonly string[]; mime: readonly string[] };
  /** 0 to 1 from the first 32 000 characters of the file. No side effects. */
  sniff(head: string): number;
  parse(text: string): ImportResult;
  readonly dialect?: SourceDialect;
}
