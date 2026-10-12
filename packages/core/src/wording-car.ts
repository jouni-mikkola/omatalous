/**
 * A car dealer told by the payee's name: the part of the bank dialect (ADR 0008) behind the category Auton osto. The
 * name has a word of the trade, a chain's name or one of the plain words a dealer is named with (Esimerkin Auto,
 * Esimerkki Bilar). The same words sit in the names of other trades, so two lists set those apart: a driving school, a
 * bus company, a rental, a financier and an association are no part of the car trade, and a garage, a parts shop and a
 * car wash are of the trade but sell no car. The other car words (fuel, parking, a financier's name) are in wording.ts.
 */
import { isCarServiceText, isInspectionText, isLeaseText, isParkingText, words } from "./wording.ts";

/** The trade's own words, in Finnish and Swedish: a payee named with one sells cars. */
const TRADE = String.raw`[A-Z]*AUTOLIIKE|AUTOKAUPPA|AUTOKAUPPIAS|[A-Z]*AUTOTALO|AUTOKESKUS|AUTOMYYMALA|AUTOMYYNTI|VAIHTOAUTO[A-Z]*|BILHANDEL|BILFIRMA|BILCENTER|BILFORSALJNING`;
/** Chains with showrooms across the country. A family name is here with its company form only: a person bears it too. */
const CHAINS = String.raw`KAMUX|VEHO|BILIA|K-AUTO|K-CAARA|HEDIN AUTOMOTIVE|LAAKKONEN OY|RINTA-JOUPPI OY`;
/** Where a name ends: at the end of the text or before the company form, which a branch's place may follow. */
const NAME_END = String.raw`(?= (?:OY|OYJ|AB|KY)(?![A-Z0-9])|$)`;
/**
 * The plain words, with the Swedish and English ones. AUTO is a word of its own (Esimerkin Auto) or the ending of the
 * name (Esimerkkiauto Oy). A word that ends in it with a name after it (Kala-auto Meikäläinen) is no dealer: such a
 * name is a van that sells from its side as often as a dealer.
 */
const PLAIN = String.raw`(?<!-)AUTO|[A-Z][A-Z-]*AUTO${NAME_END}|BILAR|BIL|MOTORS|CARS`;
const DEALER_WORDS = words(`${TRADE}|${CHAINS}|${PLAIN}`);

/** Vehicles no dealer is named after: a bus, a van, a lorry, a taxi, an ambulance, a shop or a library on wheels, a toy. */
const OTHER_VEHICLES = String.raw`(?:LINJA|TILAUS|PAKETTI|KUORMA|TAKSI|INVA|SAIRAS|PALO|KAUPPA|MYYMALA|JAATELO|KIRJASTO|LEIKKI|PIENOIS|VUOKRA)-?AUTO[A-Z]*`;
/** Other trades with a car in the name: a driving school, transport, a rental, a financier, an association. */
const OTHER_TRADE_WORDS = words(
  String.raw`${OTHER_VEHICLES}|[A-Z]*KOULU[A-Z]*|[A-Z]*LIIKENNE|[A-Z]*LINJA[A-Z]*|[A-Z]*TAKSI[A-Z]*|TAXI|[A-Z]*KULJETUS[A-Z]*|TILAUSAJO[A-Z]*|BUSSI[A-Z]*|[A-Z]*VUOKRA[A-Z]*|RENT|RENTAL|[A-Z]*RAHOITUS|OSAMAKSU[A-Z]*|FINANCE|FINANS|[A-Z]*LIITTO|[A-Z]*YHDISTYS|[A-Z]*KERHO|RY`,
);
/** What a car's upkeep is bought from, beside the garages and tyre shops of `isCarServiceText`. */
const UPKEEP_WORDS = words(String.raw`[A-Z]*HUOLTO[A-Z]*|[A-Z]*PESU[A-Z]*|[A-Z]*VARAOSA[A-Z]*|OSAT?|[A-Z]*TARVIKE[A-Z]*|[A-Z]*PURKAAMO|[A-Z]*HINAUS[A-Z]*|AUTOLASI[A-Z]*|TUULILASI[A-Z]*|AUTOSAHKO[A-Z]*|SERVICE|VERKSTAD|PARTS`);

/** A folded payee name of the car trade: it has a dealer's word and names no other trade. A lease is its own cost. */
export const isCarTradeName = (folded: string) => DEALER_WORDS.test(folded) && !OTHER_TRADE_WORDS.test(folded) && !isLeaseText(folded);

/** A folded payee name of a car dealer: of the car trade, and no garage, parts shop, car wash, inspection or car park. */
export const isCarDealerName = (folded: string) =>
  isCarTradeName(folded) && !UPKEEP_WORDS.test(folded) && !isCarServiceText(folded) && !isInspectionText(folded) && !isParkingText(folded);
