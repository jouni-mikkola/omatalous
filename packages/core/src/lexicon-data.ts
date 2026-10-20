/**
 * The rows of the Finnish payee lexicon (lexicon.ts reads them): company rows by trade, then stems. A name is folded
 * (A to Z, digits, ".", "-" and a space); how it is matched is told in lexicon.ts.
 */
import { PAYMENT_SERVICES } from "./payment-services.ts";

/** What the rows of a company form: a purchase, a bill, a contract with a monthly cost, a card's bill, a payment service, or (stem) a trade word. */
type LexiconKind = "purchase" | "bill" | "contract" | "card_bill" | "intermediary" | "stem";

export interface LexiconEntry {
  category: string;
  kind: LexiconKind;
  /** The folded names. */
  names: readonly string[];
  /** The entry does not hold where one of these words (a regex fragment) stands in the row: a namesake of another trade. */
  not?: string;
  /** Looked for in the payee fields only, never in a purchase's text (a first name, a word of a greeting). */
  payeeOnly?: true;
  /** A stem that holds as a whole word only (WOK, not WOKKI). */
  whole?: true;
}

const company = (category: string, kind: Exclude<LexiconKind, "stem">, ...names: string[]): LexiconEntry => ({ category, kind, names });
const stem = (category: string, ...names: string[]): LexiconEntry => ({ category, kind: "stem", names });
const stemWord = (category: string, ...names: string[]): LexiconEntry => ({ category, kind: "stem", names, whole: true });

export const LEXICON: readonly LexiconEntry[] = [
  // the payment services of payment-services.ts: their name is taken out of the text and the rest is read
  ...PAYMENT_SERVICES.map((service) => company("other", "intermediary", ...service.names)),
  // ── companies: the brands the trade register confirmed, by trade ──
  // Not here: the payees of payees.ts (leasing, district heat, electricity, water and waste companies, among them Ayvens,
  // ALD, Oulun Energia, Lahti Energia, Vantaan Energia, Tampereen Vesi), which decide first; and Posti and PostNord,
  // whose category is the item posted, so the trade register or the user answers.
  company("groceries", "purchase", "PICK N PAY", "HALPAHALLI", "HALPA-HALLI", "FOOD MARKET HERKKU"),
  company("home", "purchase", "RUSTA", "JULA", "ONNINEN", "LAPUAN KANKURIT", "ARTEK", "FISKARS", "BYGGMAX"),
  company("shopping", "purchase",
    "SAITURINPORSSI", "TARJOUSTALO", "ROBINHOODIT", "HALTI", "RUKKA", "FINNISH DESIGN SHOP", "KALEVALA KORU", "LUHTA", "LAPPONIA"
  ),
  company("restaurants", "purchase", "JUUSTOPORTTI"),
  company("car", "purchase",
    "AUTOKEIDAS", "RITOIL", "TOK EXPRESS", "YSI5", "NESTE EXPRESS", "M PLUS", "A-KATSASTUS", "K1 KATSASTUS", "K1-KATSASTAJAT",
    "AUTOKATSASTUS", "NOKIAN TYRES", "NOKIAN RENKAAT", "HYUNDAI", "FORD", "OPEL", "MICHELIN", "VOLVO", "BMW", "NISSAN", "SUZUKI", "POLESTAR"
  ),
  // a first name as well: never read in the text of a purchase
  { category: "car", kind: "purchase", names: ["JARI-PEKKA"], payeeOnly: true },
  company("transport", "purchase", "KOSKILINJAT"),
  company("travel", "purchase", "SOKOS HOTEL", "HOLIDAY INN", "FORENOM", "VUOKATTI", "YLLAS", "FINNMATKAT"),
  company("utilities", "bill",
    "JYVASKYLAN ENERGIA", "KOTKAN ENERGIA", "VAASAN SAHKO", "ESPOON SAHKO"
  ),
  company("personal_care", "purchase", "LUMENE"),
  company("entertainment", "purchase", "AMOS REX", "FINLANDIA-TALO", "SUPERCELL", "PUUHAMAA", "MUSIIKKITALO", "TAVASTIA"),
  company("subscriptions", "contract", "LAPIN KANSA", "ETELA-SUOMEN SANOMAT", "HAMEEN SANOMAT", "TALOUSSANOMAT"),
  company("telecom", "contract", "SONERA", "KOLUMBUS", "WELHO", "ANVIA"),
  company("insurance", "bill",
    "POHJANTAHTI", "SUOMEN VAHINKOVAKUUTUS", "NORDEA HENKIVAKUUTUS", "POP VAKUUTUS", "IF VAKUUTUS", "LOCALTAPIOLA"
  ),
  company("memberships", "bill",
    "PALVELUALOJEN AMMATTILIITTO", "PAM", "JULKISTEN JA HYVINVOINTIALOJEN LIITTO", "AUTO- JA KULJETUSALAN TYONTEKIJALIITTO", "AKT",
    "ILMAILUALAN UNIONI", "POSTI- JA LOGISTIIKKA-ALAN UNIONI", "RAUTATIEALAN UNIONI", "SUOMEN ELINTARVIKETYOLAISTEN LIITTO",
    "SUOMEN HUIPPU-URHEILIJOIDEN UNIONI", "SUOMEN LIIKENNELENTAJALIITTO", "TEATTERI- JA MEDIATYONTEKIJOIDEN LIITTO", "TEOLLISUUSLIITTO",
    "RAKENNUSLIITTO", "SAHKOALOJEN AMMATTILIITTO", "PAPERILIITTO", "MERIMIES-UNIONI", "ALIUPSEERILIITTO", "MUUSIKKOJEN LIITTO", "TULLILIITTO",
    "VANKILAVIRKAILIJAIN LIITTO", "YLEINEN LEHTIMIESLIITTO", "RAJATURVALLISUUSUNIONI", "AMMATTILIITTO JYTY", "AMMATTILIITTO PRO", "KIRKON ALAT",
    "MEIJERIALAN AMMATTILAISET", "METO", "RAKENNUSINSINOORIT JA -ARKKITEHDIT", "SUOMEN KONEPAALLYSTOLIITTO", "SUOMEN LAHI- JA PERUSHOITAJALIITTO",
    "SUOMEN LAIVANPAALLYSTOLIITTO", "TOIMIHENKILOLIITTO ERTO", "AMMATTILIITTO KELAN TOIMIHENKILOT", "YLEINEN TYOTTOMYYSKASSA",
    "KORKEASTI KOULUTETTUJEN TYOTTOMYYSKASSA", "AVOIN TYOTTOMYYSKASSA", "TERVEYDENHUOLTOALAN TYOTTOMYYSKASSA", "KIRJALTAJALIITON TYOTTOMYYSKASSA",
    "SUPER TYOTTOMYYSKASSA", "RESERVILAISLIITTO"
  ),
  company("gambling", "purchase", "FINTOTO"),
  company("loans", "intermediary", "AVARDA"),
  company("card_bill", "card_bill", "EUROCARD"),
  company("other", "intermediary", "EPASSI", "EPASSI PAYMENTS", "SMARTUM", "EDENRED", "HUUTO.NET", "NEXI", "BAMBORA", "WORLDLINE", "PAYSAFECARD"),
  company("health", "purchase", "MEDICOVER", "TAYS"),
  company("loans", "contract", "CREDITSTAR"),
  // a housing loan's guarantee fee
  company("loans", "bill", "GARANTIA"),
  // the newspaper only as the whole payee ("=") or with a legal form or MEDIA: Kaleva is a district of Tampere, and a mutual insurer
  { category: "subscriptions", kind: "contract", names: ["=KALEVA", "KALEVA OY", "KALEVA OYJ", "KALEVA MEDIA"], not: String.raw`KESKINAINEN|[A-Z]*VAKUUTUS[A-Z]*` },

  // ── stems: the start of a trade word, at the start of a word of the payee, weaker than every company ──
  // Not here: too common or a place (PULLA, LAUTTA for the ferry and Lauttasaari, SUOMENLINNA, HOITOLA, SEURAKUNTAYHTYMA ...); see the brief of the lexicon.
  stem("groceries", "LIVSMEDEL", "MATBUTIK", "DELIKATESS", "KYLAKAUPPA", "VIHANNES", "ASIAN MARKET"),
  stem("restaurants",
    "PIZZ", "TAPAS", "GRILLIKIOSKI", "TAPROOM", "PANIMORAVINTOLA", "GASTROPUB", "KAHVIO", "KAFFE", "KAFFEBAR", "KONDITORI", "KONDIITTORI",
    "LEIPURI", "BAGERI", "BAKERY", "GELATERIA", "RESTAURANG", "TAKEAWAY", "CATERING", "RUOKAPALVELU"
  ),
  stemWord("restaurants", "WOK"),
  stem("food_delivery", "RUOKAKASSI"),
  stem("alcohol", "VIINIKAUPPA"),
  stem("car",
    "HUOLTOASEMA", "AUTOASEMA", "BENSIINI", "KATSASTUSASEMA", "RENGASLIIKE", "RENGASHOTELLI", "TYRES", "BILVERKSTAD", "DACK", "BESIKTNING",
    "PELTISEPPA", "AUTOPESULA", "KAYTETTY AUTO"
  ),
  stem("transport", "LINJA-AUTO", "TAKSI HELSINKI", "TAXI HELSINKI", "MATKAKORTTI"),
  stem("travel", "CAMPING", "LEIRINTAALUE", "LOMAKYLA", "MATKATOIMISTO"),
  stem("utilities", "SAHKOYHTIO", "LAMMITYSOLJY"),
  stem("housing", "KIINTEISTOHUOLTO", "ISANNOITSIJA", "ISANNOINTITOIMISTO", "TALOYHTIO", "KIINTEISTOYHTIO", "PUTKIREMONTTI"),
  stem("home", "SISUSTUS", "KALUSTE", "VALAISTUS", "TIETOKONE", "PUUTARHAKAUPPA", "KODINKONE"),
  stem("health",
    "HAMMASLAAKARIASEMA", "HAMMASHOITOLA", "ORTODONTIA", "SILMALASI", "OPTICIAN", "OPTIKER", "LAKARSTATION", "TANDLAKARE", "TANDVARD", "APOTEK",
    "PHARMACY", "VERKKOAPTEEKKI", "PUHETERAPIA", "PSYKOTERAPIA", "PSYKIATRI", "MIELENTERVEYS", "NEUVOLA", "KUVANTAMINEN", "RONTGEN", "KOTIHOITO",
    "KOTIPALVELU", "AKUPUNKTIO", "FYSIOTERAPIA", "FYSIOTERAPEUTTI", "KUNTOUTUS", "POTILASMAKSU", "ASIAKASMAKSU"
  ),
  stem("fitness", "UIMAKOULU", "LIIKUNTASETELI", "KUNTOKESKUS", "HIIHTOKESKUS", "LASKETTELU", "RATSASTUS", "BADMINTON"),
  stem("personal_care",
    "KAMPAAJA", "FRISOR", "FRISORSALONG", "BARBERSHOP", "KYNSISTUDIO", "RIPSI", "KAUNEUSSALONKI", "HIEROJA", "JALKAHOITOLA"
  ),
  stemWord("personal_care", "NAILS"),
  stem("shopping", "VAATE", "KENKAKAUPPA", "URHEILUKAUPPA", "KORUKAUPPA", "KULTASEPPA", "KIRPPIS", "PYORAKAUPPA"),
  stem("entertainment", "LASERTAG", "ESCAPE ROOM", "MUSEOKORTTI", "ELOKUVATEATTERI", "PELIKAUPPA", "LAUTAPELI"),
  stem("subscriptions", "LEHTITILAUS", "KESTOTILAUS"),
  stem("telecom", "PUHELINLASKU", "NETTIYHTEYS"),
  stem("insurance",
    "HENKIVAKUUTUS", "MATKAVAKUUTUS", "ELAINVAKUUTUS", "OMAISUUSVAKUUTUS", "TAPATURMAVAKUUTUS", "SAIRAUSKULUVAKUUTUS", "VASTUUVAKUUTUS",
    "KOIRAVAKUUTUS", "VAKUUTUSMAKSU", "FORSAKRING", "FORSAKRINGSBOLAG"
  ),
  stem("memberships", "TYONTEKIJALIITTO", "A-KASSA", "JASENYYS"),
  stem("taxes", "KIRKOLLISVERO"),
  stem("education",
    "TYOVAENOPISTO", "KANSALAISOPISTO", "KANSANOPISTO", "KESAYLIOPISTO", "AVOIN YLIOPISTO", "YLIOPISTO", "KOULUTUSKESKUS", "KURSSIMAKSU"
  ),
  stem("gifts_donations", "LAHJOITA", "KUUKAUSILAHJOITUS", "KUMMILAPSI"),
  stem("gambling", "ARPAJAISET", "VEDONLYONTI", "RAHAPELI", "BETTING", "POKER", "BINGO", "JACKPOT"),
  stem("loans", "PIKALAINA"),
  stem("cash", "BANKOMAT", "BANKOMATEN", "KATEINEN", "NOSTOAUTOMAATTI"),
  stem("fees", "LASKUTUSLISA", "PAPERILASKULISA", "PANKKIHOLVI", "TILINYLITYSKORKO"),
  stem("travel", "AUTOVUOKRAUS"),
];
