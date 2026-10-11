import { getCategory } from "./categories.ts";
import { hasCompanyForm } from "./industry.ts";
import { fold, namesUnknownMerchant } from "./merchant.ts";
import type { CategoryRule, CategorySource, RuleField } from "./types.ts";
import { CARD_ISSUER_WORDS, companyForms, DAYCARE_WORDS, ELECTRICITY_NETWORK_WORDS, ELECTRICITY_SELLER_WORDS, LANDLORD_WORDS, MOBILEPAY_WORDS, OTHER_TAX_WORDS, PENSION_PAYER_WORDS, REFUND_WORDS, RESIDUAL_TAX_WORDS } from "./wording.ts";

export interface CategorizeInput {
  merchant: string;
  counterparty: string | null;
  description: string | null;
  mcc: string | null;
  amountCents: number;
}

export interface CategorizeResult {
  category: string;
  source: Exclude<CategorySource, "user" | "transfer" | "merchant" | "industry" | "match">;
  /** True when one of the user's own rules decided, so later steps leave the category alone. */
  byUser?: boolean;
}

type Direction = "in" | "out";

interface BuiltinRule {
  category: string;
  re: RegExp;
  direction?: Direction;
  /** A further condition on the folded text or the row, e.g. who was paid. */
  when?: (text: string, input: CategorizeInput) => boolean;
}

/** Whole-word alternation that also works next to "+", "'" and "." */
function w(alternatives: string): RegExp {
  return new RegExp(String.raw`(?<![A-Z0-9])(?:${alternatives})(?![A-Z0-9])`);
}

/** Banks that lend mortgages. Nordea's finance company (Nordea Rahoitus) lends for cars and cards instead. */
const MORTGAGE_BANK = w(
  String.raw`NORDEA(?! RAHOITUS| FINANCE)|OP|[A-Z]*OSUUSPANKKI|DANSKE|S-PANKKI|AKTIA|[A-Z]*SAASTOPANKKI|POP PANKKI|HANDELSBANKEN|ALANDSBANKEN`,
);

/**
 * Built-in rules for Finnish merchants and payment texts. Matched against the
 * folded (upper-case, ä→a, ö→o) merchant + counterparty + description.
 * First match wins: purpose-of-payment rules (debt, card bills, savings)
 * come before merchant rules, and generic fallbacks (refunds, MobilePay) last.
 */
const PURPOSE_RULES: readonly BuiltinRule[] = [
  // ── income ──
  {
    category: "salary",
    direction: "in",
    re: w(String.raw`PALKKA|PALKAN|PALKKAERA|LOMARAHA|LOMAPALKKA|LOMAKORVAUS|PALKKIO|KOKOUSPALKKIO|TYOKORVAUS|SALARY|LONEUTBETALNING|PAYROLL`),
  },
  { category: "investment_income", direction: "in", re: w(String.raw`OSINKO|OSINGOT|OSINGONMAKSU|DIVIDEND|DIVIDENDI|KORKOTULO|TALLETUSKORKO|HYVITYSKORKO|KORKO|KORKOHYVITYS`) },
  {
    category: "benefits",
    direction: "in",
    re: w(
      String.raw`KELA|FPA|VEROHALLINTO|VEROPALAUTUS|VERONPALAUTUS|[A-Z]*ELAKE[A-Z]*|ELAKKEET|${PENSION_PAYER_WORDS}|TYOTTOMYYSKASSA|ERILLISKASSA|YTK|ASUMISTUKI|LAPSILISA|OPINTOTUKI|KOTIHOIDONTUKI|VANHEMPAINRAHA|[A-Z]*PAIVARAHA|TYOMARKKINATUKI|TOIMEENTULOTUKI|ELATUSTUKI|ELATUSAPU|VAMMAISTUKI|HOITOTUKI|KUNTOUTUSRAHA`,
    ),
  },
  { category: "sales", direction: "in", re: w(String.raw`TORI\.FI|TORI|VINTED|HUUTO\.NET|HUUTONET|RECOMMERCE|EBAY`) },
  // rent received: the user lets out a flat or a room
  { category: "income", direction: "in", re: w(String.raw`VUOKRA(?:T|TULO[A-Z]*|TILITYS|NMAKSU)?`) },

  // ── credit cards: the bill is a transfer when the card account is connected (transfers.ts) ──
  // Bank Norwegian also lends: its texts that mention LAINA are loan payments (loans, below)
  {
    category: "card_bill",
    direction: "out",
    re: w(
      String.raw`LUOTTOKORT[A-Z]*|KORTTILASKU|KORTIN LASKU|NORDEA GOLD|NORDEA PLATINUM|(?:GOLD|PLATINUM)-?KORTTI|NORDEA CREDIT|NORDEA (?:MASTERCARD|VISA)|OP[- ]?KORTTI(?:YHTIO)?|KORTTIYHTIO|AKTIA (?:VISA|MASTERCARD|KORTTI)|NORDEA RAHOITUS[A-Z ]*(?:KORTTI|GOLD|PLATINUM|MASTERCARD|CREDIT)[A-Z]*|(?:MASTERCARD|VISA|AMEX)[A-Z ]*LASKU|AMERICAN EXPRESS|CREDIT CARD (?:PAYMENT|BILL)|OP[- ]?(?:VISA|MASTERCARD)|S-?ETUKORTTI VISA|BANK NORWEGIAN(?!.*LAINA)|ENTERCARD|RE:?MEMBER|KOMPLETT BANK`,
    ),
  },
  // money in from a credit line (a card's "luoton siirto omalle tilille", financing payouts, a card issuer)
  {
    category: "credit_draw",
    direction: "in",
    re: w(
      String.raw`LUOTON ?NOSTO|LUOTONNOSTO|LUOTON SIIRTO|NOSTO LUOTOLTA|LUOTTOTILI|${CARD_ISSUER_WORDS}|NORDEA GOLD|NORDEA PLATINUM|NORDEA CREDIT`,
    ),
  },

  // ── debt service (money in from a lender becomes credit_draw, see categorize()) ──
  { category: "mortgage", re: w(String.raw`ASUNTOLAINA[A-Z]*|ASUNTOLUOTTO|ASP-LAINA[A-Z]*`) },
  { category: "student_loan", re: w(String.raw`OPINTOLAINA[A-Z]*`) },
  // a loan payment to a bank is the mortgage; other lenders' loans are consumer credit (loans, below)
  { category: "mortgage", re: w(String.raw`LAINANMAKSU|LAINAN ?LYHENNYS|LAINANLYHENNYS|LAINANHOITO`), when: (text) => MORTGAGE_BANK.test(text) },
  {
    category: "collection",
    re: w(String.raw`INTRUM|LOWELL|ALEKTUM|PERINTA[A-Z]*|PERINTATOIMISTO|SVEA PERINTA|VISMA COLLECTORS|RESCOMP|SERGEL|LINDORFF|GOTHIA|PRA GROUP|CREDIGO|MEDIATOR`),
  },
  // money in from enforcement is a refund or a share of a debt collected for the user, not a loan
  { category: "collection", direction: "out", re: w(String.raw`ULOSOTTO[A-Z]*`) },
  { category: "interest", re: w(String.raw`KORKO|KORKOKULU|LUOTONKORKO|LUOTTOKORKO|VIIVASTYSKORKO|LUOTTOKULU[A-Z]*|LUOTTOKUSTANNUS|NOSTOPALKKIO`) },
  {
    category: "loans",
    re: w(
      String.raw`NORDEA RAHOITUS[A-Z ]*|NORDEA FINANCE[A-Z ]*|OSAMAKSU[A-Z]*|RAHOITUSSOPIMUS|KULUTUSLUOTTO|LAINA[A-Z]*|LYHENNYS|LAINANHOITO|LUOTTO|RESURS|SANTANDER|BANK NORWEGIAN|SVEA BANK|SVEA EKONOMI|COLLECTOR BANK|INSTABANK|TF BANK|IKANO|NORDAX|NOBA|AVIDA|NORTHMILL|FERRATUM|MONEYGO|EUROLOAN|AXO FINANS|SAMBLA|LENDO|ZMARTA`,
    ),
  },

  // ── savings & investments (both directions: money back from them reduces savings) ──
  { category: "pension", re: w(String.raw`ELAKEVAKUUTUS|ELAKESAASTO[A-Z]*|PS-TILI|PITKAAIKAISSAASTO[A-Z]*|VAPAAEHTOINEN ELAKE`) },
  {
    category: "investments",
    re: w(
      String.raw`NORDNET|RAHASTO[A-Z]*|NORDEA RAHASTO[A-Z]*|SAASTOSOPIMUS|KUUKAUSISAASTO[A-Z]*|OSAKESAASTOTILI|OST|ARVOPAPERI[A-Z]*|SIJOITUS[A-Z]*|SELIGSON|EVLI|EQ|SAXO|DEGIRO|INTERACTIVE BROKERS|LYNX|TRADE REPUBLIC|LIGHTYEAR|MONTHIO|TITAN|ESTATEGURU|FELLOW FINANCE|INVESDOR|COINBASE|BITSTAMP|KRAKEN|BINANCE|NORTHCRYPTO|COINMOTION|TAVEX|SIJOITUSKULTA|KULTAHARKKO|HOPEAHARKKO|JALOMETALLI[A-Z]*|GOLD BULLION`,
    ),
  },
  {
    category: "savings",
    re: w(
      String.raw`SAASTOTILI[A-Z]*|SAASTO|SAASTOON|TAVOITESAASTO[A-Z]*|MAARAAIKAISTALLETUS|MAARAAIKAISTILI|SAASTOTALLETUS|KASVUTILI|SAVINGS|OMA SIIRTO|OMAN TILIN|OMALLE TILILLE|OMALTA TILILTA|SIIRTO OMALLE|OWN TRANSFER|TRANSFER BETWEEN OWN`,
    ),
  },

  // ── fees, cash, public payments ──
  {
    category: "fees",
    direction: "out",
    re: w(
      String.raw`PALVELUMAKSU|PALVELUPAKETTI|KUUKAUSIMAKSU NORDEA|TILINHOITOMAKSU|KORTTIMAKSU|KORTIN VUOSIMAKSU|KORTTIVUOSIMAKSU|PANKKIMAKSU|SERVICE FEE|VALUUTANVAIHTO[A-Z]*|VALUUTTAMUUNNOS[A-Z]*|ULKOMAANMAKSU|NOSTOMAKSU|MUISTUTUSMAKSU`,
    ),
  },
  { category: "cash", direction: "out", re: w(String.raw`KATEISNOSTO|OTTO|ATM|AUTOMAATTI|CASH WITHDRAWAL`) },
  {
    category: "taxes",
    direction: "out",
    re: w(
      String.raw`VEROHALLINTO|${RESIDUAL_TAX_WORDS}|${OTHER_TAX_WORDS}|TRAFICOM|YLEISRADIO|POLIISI[A-Z]*|OIKEUSREKISTERIKESKUS|RIKESAKKO|SAKKO|PYSAKOINTIVIRHE[A-Z]*|PYSAKOINNINVALVONTA|VALVONTAMAKSU|TARKASTUSMAKSU|PARKKIPATE|TULLI|DIGI- JA VAESTOTIETOVIRASTO|DVV|MAANMITTAUSLAITOS|PATENTTI- JA REKISTERIHALLITUS|MAAHANMUUTTOVIRASTO|MIGRI`,
    ),
  },
];

/** Consumption: specific brands before broad categories. */
const MERCHANT_RULES: readonly BuiltinRule[] = [
  { category: "food_delivery", re: w(String.raw`WOLT|FOODORA|UBER\s*\*?\s*EATS|UBEREATS|DELIVEROO|JUST EAT|LIEFERANDO`) },
  {
    category: "travel",
    re: w(
      String.raw`SOKOS HOTELS?|SCANDIC|HILTON|RADISSON|CLARION|NOVOTEL|IBIS|BEST WESTERN|OMENA HOTELS?|LAPLAND HOTELS?|CUMULUS|HOLIDAY CLUB|AIRBNB|BOOKING\.COM|HOTELS\.COM|EXPEDIA|TRIVAGO|HOSTELWORLD|LOMARENGAS|NETTIMOKKI|FINNAIR|NORWEGIAN AIR[A-Z ]*|NORWEGIAN\.COM|RYANAIR|LUFTHANSA|SAS AIRLINES|AIRBALTIC|AIR BALTIC|WIZZ ?AIR|EASYJET|KLM|AIR FRANCE|BRITISH AIRWAYS|ICELANDAIR|TURKISH AIRLINES|EMIRATES|QATAR AIRWAYS|TALLINK|SILJA|VIKING LINE|ECKERO|FINNLINES|WASALINE|ESKELINEN|LEVI SKI|RUKA|TUI|AURINKOMATKAT|APOLLO|DETUR|KILROY|MOMONDO|FINAVIA|LENTOASEMA|HERTZ|AVIS|EUROPCAR|SIXT|BUDGET RENT[A-Z ]*|GETYOURGUIDE|VIATOR|TRAINLINE|OMIO|SJ|DB BAHN`,
    ),
  },
  {
    category: "education",
    re: w(
      String.raw`OPINTOMAKSU|LUKUKAUSIMAKSU|[A-Z]*(?<!URHEILU)OPISTO|AMMATTIKORKEAKOULU|KORKEAKOULU|YLIOPPILASKUNTA|YLIOPPILASTUTKINTO[A-Z]*|AUTOKOULU|TANSSIKOULU|KIELIKOULU|MUSIIKKIKOULU|SOITTOKOULU|BALETTI[A-Z]*|SIRKUSKOULU|TAIDEKOULU|UDEMY|COURSERA|DUOLINGO|LINKEDIN LEARNING|MASTERCLASS|KURSSI[A-Z]*`,
    ),
  },
  {
    category: "subscriptions",
    re: w(
      String.raw`SPOTIFY|NETFLIX|DISNEY\s*(?:PLUS|\+)|DISNEYPLUS|HBO|HBOMAX|MAX\.COM|VIAPLAY|RUUTU|MTV KATSOMO|KATSOMO|C MORE|CMORE|SKYSHOWTIME|PARAMOUNT|APPLE TV|CRUNCHYROLL|TWITCH|ELISA VIIHDE|APPLE\.COM|ITUNES|YOUTUBE|GOOGLE\s*\*?\s*(?:PLAY|YOUTUBE|STORAGE|ONE|WORKSPACE)|GOOGLE ONE|GOOGLE STORAGE|AMAZON PRIME|PRIME VIDEO|AUDIBLE|STORYTEL|BOOKBEAT|NEXTORY|ELISA KIRJA|PODIMO|READLY|ZINIO|TIDAL|DEEZER|SOUNDCLOUD|OPENAI|CHATGPT|ANTHROPIC|CLAUDE\.AI|MICROSOFT|ADOBE|CANVA|NOTION|DROPBOX|ICLOUD|PATREON|HELSINGIN SANOMAT|ILTA-SANOMAT|SANOMA|ALMA MEDIA|ILTALEHTI|KAUPPALEHTI|AAMULEHTI|TURUN SANOMAT|SAVON SANOMAT|KESKISUOMALAINEN|HUFVUDSTADSBLADET|OTAVAMEDIA|A-LEHDET|SUOMEN KUVALEHTI|PLAYSTATION PLUS|XBOX GAME PASS|NINTENDO ONLINE|GITHUB|1PASSWORD|NORDVPN|EXPRESSVPN|SURFSHARK|F-SECURE|NORTON|MCAFEE|BITDEFENDER|ZONER|HETZNER|DIGITALOCEAN|CLOUDFLARE|NAMECHEAP|GODADDY`,
    ),
  },
  { category: "telecom", re: w(String.raw`ELISA|DNA|TELIA|MOI MOBIILI|SAUNALAHTI|LOUNEA|KAISANET|NETPLAZA|VALOO|SUOMICOM|LYCAMOBILE|LEBARA`) },
  // before utilities: water or heating billed by the housing company is part of living there
  {
    category: "housing",
    re: w(
      String.raw`VUOKRA[A-Z]*|TAKUUVUOKRA|[A-Z]*VASTIKE|AS OY|AS\. OY|ASUNTO OY|ASUNTO-OSAKEYHTIO|KIINTEISTO OY|ISANNOINTI[A-Z]*|ASUMISOIKEUS[A-Z]*|${LANDLORD_WORDS}|SAUNAVUORO|AUTOPAIKKA|AUTOTALLI|AUTOKATOS|PIENVARASTO|SHURGARD|CITY SELF-STORAGE|24STORAGE|PELICAN SELF STORAGE`,
    ),
  },
  {
    category: "utilities",
    re: w(
      String.raw`${ELECTRICITY_SELLER_WORDS}|ALVA(?: OY|-YHTIOT)|SAVON VOIMA|${ELECTRICITY_NETWORK_WORDS}|PKS|SAHKO(?!ASENN|ASENT|TYO|URAKOINTI|LIIKE|PALVELU)[A-Z]*|[A-Z]*ENERGIA|KAUKOLAMPO|TAMPEREEN SAHKOLAITOS|GASUM|VESIHUOLTO|VESILAITOS|VESIOSUUSKUNTA|VESIMAKSU|[A-Z]+N VESI|HSY|JATEHUOLTO[A-Z]*|JATEMAKSU|LASSILA & TIKANOJA|L&T|REMEO|URBASER|KIERTOKAPULA|ROSK'?N ?ROLL|KIERTOKAARI|JATEKUKKO|PUHAS|NUOHOUS[A-Z]*`,
    ),
  },
  // Finnish compounds (KOTIVAKUUTUS, VAHINKOVAKUUTUS) need a plain substring match
  // premiums only: money in from an insurer is a claim payout (reimbursements, below)
  { category: "insurance", direction: "out", re: /VAKUUTUS|LAHITAPIOLA|FENNIA|\bIF P&C\b|\bTURVA\b|POHJOLA VAKUUTUS|\bMANDATUM\b|\bPOHJANTAHTI\b|\bFOLKSAM\b|\bALANDIA\b|\bEUROP ASSISTANCE\b/ },
  // before memberships: a donation to an association is not a membership fee
  { category: "gifts_donations", re: w(String.raw`LAHJOITUS|KERAYS|KOLEHTI`) },
  // union and unemployment fund fees, associations (charity unions are donations, below)
  {
    category: "memberships",
    direction: "out",
    re: w(
      String.raw`JASENMAKSU[A-Z]*|AY-JASENMAKSU|AMMATTILIITTO[A-Z]*|(?!LASTENSUOJELULIITTO|LUONNONSUOJELULIITTO|LUONTOLIITTO|ELAINSUOJELULIITTO)[A-Z]*LIITTO RY|TYOTTOMYYSKASSA|ERILLISKASSA|YTK|IAET-KASSA|TEHY|JHL|OAJ|AKAVA|TALENTIA|JYTY|TEKNIIKAN AKATEEMISET|AUTOLIITTO|MARTAT|PARTIOLIPPUKUNTA|PARTIOLAISET|SUOMEN PARTIOLAISET|LIPPUKUNTA`,
    ),
  },
  {
    category: "pets",
    re: w(
      String.raw`MUSTI JA MIRRI|MUSTI|PETENKOTI|PET CITY|ELAINLAAKARI[A-Z]*|ELAINSAIRAALA|ELAINKLINIKKA|EVIDENSIA|ANICURA|ZOOPLUS|FAUNATAR|LEMMIKKI[A-Z]*|KENNEL[A-Z]*|KOIRAHOITOLA|ELAINHOITOLA|KOIRAKOULU|[A-Z]*TRIMMAAMO|AGRIA`,
    ),
  },
  {
    category: "kids",
    re: w(
      String.raw`${DAYCARE_WORDS}|ESIOPETUS|TOUHULA|PILKE|NORLANDIA|BR-?LELUT|LELUKAUPPA|LEGO|SMYTHS|TOYS R US|REIMA|POLARN O\. PYRET|LASTENTARVIKE[A-Z]*|LASTENVAATE[A-Z]*|JOLLYROOM|LEKMER|BABYSHOP|HOPLOP|SUPERPARK|ILTAPAIVAKERHO|ILTAPAIVATOIMINTA|KOULULAISKERHO|LEIKKIKERHO|LEIKKIKOULU|LEIKKIPUISTO|UINTIKOULU|LELU[A-Z]*|KERHOMAKSU|LEIRIMAKSU|RIPPIKOULU|RIPPILEIRI`,
    ),
  },
  {
    category: "health",
    re: w(
      String.raw`[A-Z]*APTEEKKI|TERVEYSTALO|MEHILAINEN|PIHLAJALINNA|DIACOR|DEXTRA|PLUSTERVEYS|CORONARIA|ATTENDO|ESPERI|OMA LAAKARI|HAMMAS[A-Z]*|DENTAL|DENTO|HAMPAAT|HAMPAAN[A-Z]*|SUUHYGIENISTI|LAAKARIASEMA|FYSIO[A-Z]*|NAKOKESKUS|LUONTAISTUOTE[A-Z]*|TERVEYSKESKUS|TERVEYSASEMA|[A-Z-]*HYVINVOINTIALUE[A-Z]*|HUS|SAIRAALA|POLIKLINIKKA|TYOTERVEYS[A-Z]*|SYNLAB|HUSLAB|LABORATORIO|[A-Z]*TERAPIA|PSYKOLOGI[A-Z]*|KIROPRAKTIKKO|OSTEOPAATTI|NAPRAPAATTI|JALKAHOITO[A-Z]*|[A-Z]*HIERONTA|INSTRUMENTARIUM|SPECSAVERS|SYNSAM|NEWSEC OPTIKKO|OPTIKKO|[A-Z]*OPTIIKKA|SILMAASEMA|SILMALAAKARI|LAAKARIKESKUS`,
    ),
  },
  {
    category: "fitness",
    re: w(
      String.raw`ELIXIA|FORUS|CUBO|FITNESS[A-Z0-9]*|SATS|EASYFIT|FRESSI|LIIKKU|LADY ?LINE|GET IN SHAPE|GYM|LIIKUNTA[A-Z]*|UIMAHALLI|KUNTOSALI|CROSSFIT|JOOGA[A-Z]*|YOGA|PILATES|TANSSISTUDIO|TANSSITUNTI|TANSSIKURSSI|KIIPEILY[A-Z]*|BOULDER[A-Z]*|PADEL|TENNIS|SQUASH|SULKAPALLO|JAAHALLI|GOLF[A-Z]*|HISSILIPPU|SKIPASS|URHEILUSEURA|SEURAMAKSU|VOIMISTELU[A-Z]*|VOIMISTELIJAT|SALIBANDY[A-Z]*|FLOORBALL|JALKAPALLO[A-Z]*|JAAKIEKKO[A-Z]*|KORISPALLO[A-Z]*|LENTOPALLO[A-Z]*|PESAPALLO[A-Z]*|SPORTTIPASSI|SPORTSHUB`,
    ),
  },
  {
    category: "personal_care",
    re: w(
      String.raw`KAMPAAMO|HIUSSALONKI|[A-Z]*SALONKI|HAIR SALON|PARTURI[A-Z-]*|BARBER[A-Z]*|HIUS[A-Z]*|TUKKA[A-Z]*|KAUNEUS[A-Z]*|KOSMETOLOGI|KYNSI[A-Z]*|MANIKYYRI|PEDIKYYRI|SOLARIUM|LYKO|KICKS|SOKOS EMOTION|EMOTION|SKINCITY|SEPHORA|THE BODY SHOP|SPA`,
    ),
  },
  {
    category: "gambling",
    re: w(String.raw`VEIKKAUS|PAF|UNIBET|BETSSON|NORDICBET|LEOVEGAS|COOLBET|MR ?GREEN|BETSAFE|CASUMO|VIDEOSLOTS|SPEEDYBET|CASINO|KASINO|POKERSTARS|EUROJACKPOT|LOTTO|TOTO|KENO`),
  },
  {
    category: "gifts_donations",
    re: w(
      String.raw`LAHJOITUS|KERAYS|KOLEHTI|HYVANTEKEVAISYYS|PUNAINEN RISTI|SPR|UNICEF|PELASTAKAA LAPSET|LAAKARIT ILMAN RAJOJA|GREENPEACE|WWF|AMNESTY|PLAN INTERNATIONAL|KIRKON ULKOMAANAPU|FIDA|SOS-LAPSIKYLA|SYOPASAATIO|SYOPAJARJESTOT|MANNERHEIMIN LASTENSUOJELULIITTO|MLL|YHTEISVASTUU|NALKAPAIVA|HOPE RY|LUONTOLIITTO|LUONNONSUOJELULIITTO|ELAINSUOJELU[A-Z]*|HESY|SEY|WIKIMEDIA`,
    ),
  },
  {
    category: "transport",
    re: w(
      String.raw`HSL|HELSINGIN SEUDUN LIIKENNE|VR|VR-YHTYMA|NYSSE|FOLI|WALTTI|[A-Z]*JOUKKOLIIKENNE|MATKAHUOLTO|ONNIBUS|FLIXBUS|SAVONLINJA|PAUNU|KOIVISTON AUTO|POHJOLAN LIIKENNE|TAKSI[A-Z]*|TAXI|LAHITAKSI|KAJON|VALOPILKKU|MENEVA|UBER|BOLT|TIER|VOI|LIME|DOTT|HOOP|RYDE|KAUPUNKIPYORA[A-Z]*|PYORAHUOLTO|PYORAKORJAAMO|CITYBIKE[A-Z]*`,
    ),
  },
  {
    category: "car",
    re: w(
      String.raw`NESTE|ST1|ABC|SHELL|TEBOIL|SEO|GULF|EASYPARK|APCOA|SCANDINAVIAN PARKING|PARKMAN|MOOVY|AIMO PARK|EUROPARK|Q-PARK|P-HUB|PYSAKOINTI|PARKKI[A-Z]*|[A-Z-]*KATSASTUS|AVAINASEMA|RENGAS[A-Z]*|RENKAAT|AUTOPESU[A-Z]*|AUTOHUOLTO|AUTOPALVELU|AUTOKORJAAMO|KORJAAMO|AUTOMAALAAMO|MEKONOMEN|EUROMASTER|VIANOR|KAMUX|VEHO|BILIA|DELTA AUTO|LAAKKONEN OY|AUTOTALO LAAKKONEN|VAIHTOAUTOTALO LAAKKONEN|K-AUTO|AUTOTALO|K-LATAUS|VIRTA|PLUGIT|RECHARGE|IONITY|SUPERCHARGER|TESLA`,
    ),
  },
  { category: "alcohol", re: w(String.raw`ALKO|SUPERALKO|SYSTEMBOLAGET|VINMONOPOLET`) },
  {
    category: "groceries",
    re: w(
      String.raw`ICA|COOP|HEMKOP|WILLYS|PRESSBYRAN|REMA 1000|RIMI|MAXIMA|SELVER|[A-Z]*KIOSKI|KALATUKKU|[A-Z]*KALAKAUPPA|[A-Z]*LIHAKAUPPA|K-?MARKET|K-?SUPERMARKET|K-?CITYMARKET|K-?RUOKA|S-?MARKET|S-KAUPAT|PRISMA|ALEPA|SALE|LIDL|SIWA|VALINTATALO|M-MARKET|MINIMANI|HERKKU|FOODIE|FIKSURUOKA|RUOHONJUURI|[A-Z]*KAUPPAHALLI|LAHIKAUPPA|OSUUSKAUPPA|KESPRO|METRO TUKKU|R-?KIOSKI|TOKMANNI RUOKA|HALAL|MARKET|LUOMU[A-Z]*|MAATILA[A-Z]*|TESCO|SAINSBURY'?S|ALDI|CARREFOUR|EDEKA|REWE|BILLA|NETTO|FAKTA|MERCADONA|AUCHAN|LECLERC|CONAD|COSTCO`,
    ),
  },
  {
    category: "restaurants",
    re: w(
      String.raw`[A-Z]*RAVINTOLA|RESTAURANT|RAFLAAMO|CAFE|[A-Z]*KAHVILA|KUPPILA|COFFEE|ESPRESSO HOUSE|STARBUCKS|ROBERT'?S COFFEE|FAZER CAFE|FAZER FOOD|MCDONALD'?S?|[A-Z]*BURGER[A-Z]*|SOCIAL BURGERJOINT|FRIENDS & BRGRS|SUBWAY|KOTIPIZZA|PIZZERIA|PIZZA[A-Z]*|THAI|KEITTIO|[A-Z]*JAATELO|PIZZA HUT|DOMINO'?S|SUSHI|RAX|PICNIC|ROLLS|FAFA'?S|ROSSO|AMARILLO|CHICO'?S|O'?LEARYS|PANCHO VILLA|AMICA|SODEXO|COMPASS|UNICAFE|JUVENES|LOUNAS|LOUNASRAVINTOLA|LOUNASKAHVILA|[A-Z]*BAARI|BAR|PUB|BISTRO|GRILL|KEBAB|TACO|VAPIANO|FRANKIES|ARNOLDS|PANDA|LEIPOMO|KONDITORIA|PULLAPUOTI|PULLAKAHVILA|[A-Z]*PANIMO|OLUTRAVINTOLA|KROGI|TRATTORIA|OSTERIA|BRASSERIE|STEAKHOUSE|RAMEN|NOODLE[A-Z]*|NUUDELI[A-Z]*|FALAFEL|GYROS|BURRITO|TANDOORI|CURRY|NEPAL[A-Z]*|INTIALAINEN|INDIAN`,
    ),
  },
  // the paint maker; Tikkurila is also a district of Vantaa (FYSIOPISTE TIKKURILA OY)
  { category: "home", re: w("TIKKURILA OYJ?"), when: (_text, input) => /^TIKKURILA OYJ?(?![A-Z0-9])/.test(fold((input.counterparty || input.description || "").trim())) },
  {
    category: "home",
    re: w(
      String.raw`IKEA|JYSK|BAUHAUS|K-?RAUTA|RAUTA|RAUTAKAUPPA|RAUTIA|RAUTAKESKO|EURONICS|MEDIA ?MARKT|ELKJOP|ELGIGANTEN|FOTOKEMA|STARK|OBI|BILTEMA|MOTONET|PUUILO|GIGANTTI|VERKKOKAUPPA\.?COM|POWER|JIMMS|PROSHOP|DUSTIN|DATATRONIC|MULTITRONIC|APPLE STORE|ASKO|SOTKA|MASKU OY|MASKUN KALUSTETALO|VEPSALAINEN OY|VEPSALAINEN\.COM|ISKU|INDISKA|BEDSHOP|UNIKULMA|HOBBY HALL|CLAS OHLSON|PLANTAGEN|HAKAMAKI|HONG KONG|SINOOPPI|KUKKA[A-Z]*|FLORISTI[A-Z]*|[A-Z]*PUUTARHA[A-Z]*|[A-Z]*PESULA|LUKKOLIIKE|HUOLTOMIES|SIIVOUS[A-Z]*|KOTISIIVOUS|IKKUNANPESU|REMONTTI[A-Z]*|SAHKO(?:ASENN|ASENT|PALVELU|TYO|URAKOINTI)[A-Z]*|LVI|PUTKI(?!NEN)[A-Z]*|LUKKOSEPPA|SUUTARI|OMMELU|KELLOSEPPA|VAATEKORJAAMO|BETONI|MAANRAKENNUS|PIHAKIVI|PIHA|KATTOREMONTTI|MAALARI|MAALAUS[A-Z]*|SIIVOUSPALVELU[A-Z]*|SIIVOUSLIIKE|MUUTTO[A-Z]*|PIHATYO[A-Z]*|LUMITYO[A-Z]*|KOTITALKKARI`,
    ),
  },
  {
    category: "shopping",
    re: w(
      String.raw`ZALANDO|H&M|HM|LINDEX|KAPPAHL|ZARA|GINA TRICOT|BIK BOK|CUBUS|MANGO|PEPCO|NEW YORKER|RESERVED|STADIUM|XXL|NIKE|ADIDAS|PUMA|SPORTS ?DIRECT|DECATHLON|HALENS|ANTTILA|INTERSPORT|DRESSMANN|CARLINGS|KOOKENKA|FOOTWAY|NILSON SHOES|DIN SKO|STOCKMANN|SOKOS|TOKMANNI|J\. ?KARKKAINEN|KARKKAINEN OY|AMAZON|AMZN|ALIEXPRESS|TEMU|SHEIN|ETSY|EBAY|NORMAL|FLYING TIGER|SOSTRENE GRENE|HALPA-HALLI|TOKYO|IITTALA|MARIMEKKO|FINLAYSON|PENTIK|KLARNA|WALLEY|RIVERTY|AFTERPAY|BOOZT|ELLOS|VERO MODA|JACK & JONES|NAKKI|BRANDOS|ADLIBRIS|AKATEEMINEN|SUOMALAINEN KIRJAKAUPPA|KIRJAKAUPPA|ANTIKVARIAATTI|KIRPPUTORI|KIERRATYSKESKUS|UFF|FIDA LAHETYSTORI`,
    ),
  },
  {
    category: "entertainment",
    re: w(
      String.raw`FINNKINO|KINO[A-Z]*|BIO REX|LIPPUPISTE|TICKETMASTER|TIKETTI|LIPPU\.FI|EVENTIM|STEAM|EPIC GAMES|GOG\.COM|BATTLE\.NET|BLIZZARD|ROBLOX|NINTENDO|PLAYSTATION|KEILAHALLI|BOWLING[A-Z]*|HUVIPUISTO|SEIKKAILUPUISTO|FLOWPARK|MUUMIMAAILMA|GRONA LUND|SKANSEN|TIVOLI|BILJARDI|KARAOKE|PAKOHUONE|MUSEO|LINNANMAKI|SARKANNIEMI|POWERPARK|TYKKIMAKI|HEUREKA|KORKEASAARI|ZOO|ELAINTARHA|VESIPUISTO|TEATTERI|OOPPERA|KONSERTTI|FESTIVAALI|KIRJASTO`,
    ),
  },

  // after restaurants and entertainment: a hotel's restaurant, bar or spa is not lodging
  { category: "travel", re: w(String.raw`HOTEL|HOTELLI|HOSTEL|MOTELLI|[A-Z]*KYLPYLA`) },
];

/** Generic fallbacks, after every merchant rule. */
const FALLBACK_RULES: readonly BuiltinRule[] = [
  // a city or municipality without a more specific purpose (daycare and health care are matched above)
  { category: "taxes", direction: "out", re: w(String.raw`[A-Z]+N KAUPUNKI|[A-Z]+N KUNTA|KAUPUNGINKANSLIA`) },
  { category: "reimbursements", direction: "in", re: w(String.raw`VAKUUTUSKORVAUS|KORVAUS|KULUKORVAUS|MATKALASKU|${REFUND_WORDS}`) },
  // a company paid or paying with MobilePay is not a person (TIKKURILAN TIIKERIT RY)
  { category: "p2p_in", direction: "in", re: w(`${MOBILEPAY_WORDS}|SIIRTO HENKILOLTA`), when: (_text, input) => !hasCompanyForm(input.counterparty ?? "") },
  { category: "p2p", direction: "out", re: w(`${MOBILEPAY_WORDS}|SIIRTO HENKILOLLE`), when: (_text, input) => !hasCompanyForm(input.counterparty ?? "") },
];

const BUILTIN_RULES: readonly BuiltinRule[] = [...PURPOSE_RULES, ...MERCHANT_RULES, ...FALLBACK_RULES];

/**
 * Merchant category codes (ISO 18245) → category, for card transactions.
 * Single codes come before the broad ranges they sit in.
 */
const MCC_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [742, 742, "pets"], // veterinary
  [780, 780, "home"], // landscaping
  [1520, 1799, "home"], // contractors: building, plumbing, electrical
  [4784, 4784, "car"], // tolls and bridge fees
  [4829, 4829, "p2p"], // money transfer
  [5047, 5047, "health"], // medical and optical equipment
  [5122, 5122, "health"], // drugs
  [5641, 5641, "kids"], // children's wear
  [5921, 5921, "alcohol"],
  [5945, 5945, "kids"], // toys & games
  [5975, 5976, "health"], // hearing aids, orthopaedic goods
  [5992, 5992, "home"], // florists
  [5995, 5995, "pets"], // pet shops
  [6051, 6051, "investments"], // quasi-cash, crypto
  [6211, 6211, "investments"], // securities brokers
  [6513, 6513, "housing"], // real estate agents and rentals
  [7210, 7211, "home"], // laundry
  [7230, 7230, "personal_care"], // beauty & barber
  [7298, 7298, "personal_care"], // health & beauty spas
  [7342, 7342, "home"], // pest control
  [7349, 7349, "home"], // cleaning
  [7911, 7911, "fitness"], // dance studios
  [7941, 7941, "fitness"], // sports clubs
  [7992, 7992, "fitness"], // golf courses
  [7995, 7995, "gambling"],
  [7997, 7997, "fitness"], // clubs, gyms
  [8211, 8299, "education"],
  [8351, 8351, "kids"], // child care
  [8398, 8398, "gifts_donations"], // charities
  [8641, 8641, "memberships"], // civic and social associations
  [8661, 8661, "gifts_donations"], // religious organisations
  [8675, 8675, "memberships"], // automobile associations
  [8699, 8699, "memberships"], // membership organisations, unions
  [3000, 3350, "travel"], // airlines
  [3351, 3500, "travel"], // car rental
  [3501, 3999, "travel"], // hotels
  [4011, 4131, "transport"],
  [4411, 4411, "travel"],
  [4511, 4582, "travel"],
  [4722, 4722, "travel"],
  [4784, 4789, "transport"],
  [4812, 4816, "telecom"],
  [4899, 4899, "subscriptions"],
  [4900, 4900, "utilities"],
  [5045, 5065, "home"],
  [5172, 5172, "car"],
  [5200, 5261, "home"],
  [5300, 5399, "shopping"],
  [5411, 5499, "groceries"],
  [5511, 5599, "car"],
  [5600, 5699, "shopping"],
  [5712, 5735, "home"],
  [5811, 5814, "restaurants"],
  [5815, 5818, "subscriptions"],
  [5912, 5912, "health"],
  [5940, 5999, "shopping"],
  [6010, 6011, "cash"],
  [6300, 6399, "insurance"],
  [7011, 7011, "travel"],
  [7512, 7512, "travel"],
  [7523, 7549, "car"],
  [7800, 7999, "entertainment"],
  [8011, 8099, "health"],
  [9211, 9399, "taxes"],
];

export function categoryForMcc(mcc: string | null): string | null {
  const code = mcc ? Number.parseInt(mcc, 10) : Number.NaN;
  if (!Number.isFinite(code)) return null;
  for (const [lo, hi, category] of MCC_RANGES) {
    if (code >= lo && code <= hi) return category;
  }
  return null;
}

const P2P_MARKER = w(`${MOBILEPAY_WORDS}|SIIRTO HENKILO(?:LLE|LTA)`);
const COMPANY_MARKER = w([...companyForms("person")].join("|"));

/**
 * Whether a merchant rule recognises the name as a business: a trade word
 * that the rules also find inside a compound (KESÄKAHVILA, LÄHIAPTEEKKI), or
 * a brand of several words. A brand of one word is not enough: first names
 * and surnames are often brand words too (Elisa, Helen, Silja, Asko, Virta).
 */
function namedLikeBusiness(name: string): boolean {
  return MERCHANT_RULES.some((r) => {
    // "Q" + word matches only through a "[A-Z]*" prefix, which the rules give trade words
    if (name.split(" ").some((word) => r.re.test(`Q${word}`))) return true;
    return r.re.exec(name)?.[0].includes(" ") ?? false;
  });
}

/**
 * MobilePay to or from a person. Checked before the merchant rules, because
 * first names and surnames are often merchant words too. A person is 2–4
 * words of letters, none of them a company form or a trade word, and no
 * chain-style prefix like "K-" or "S-".
 */
function personViaMobilePay(input: CategorizeInput): boolean {
  const name = fold(input.counterparty ?? "").trim();
  if (!name || !P2P_MARKER.test(fold([input.counterparty, input.description].filter(Boolean).join(" ")))) return false;
  const words = name.split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    !COMPANY_MARKER.test(name) &&
    words.every((x) => /^[A-Z]{2,}(?:-[A-Z]{2,})?$/.test(x)) &&
    !namedLikeBusiness(words.join(" "))
  );
}

export interface CompiledRule {
  id?: number;
  /** The category is an income one; resolved once because every row is tested against every rule. */
  income: boolean;
  category: string;
  field: RuleField;
  direction?: Direction;
  /** One of the user's own rules. */
  byUser?: boolean;
  /** `input` is there for rules that look at a single field (see personViaMobilePay). */
  test: (text: string, input: CategorizeInput) => boolean;
}

/** "/…/" with optional flags: how older versions stored a regex rule. */
const USER_REGEX = /^\/(.+)\/([a-z]*)$/;

/**
 * The phrases of a "/regex/" rule saved by an older version, when the regex
 * is only words: "/^kahvila\s/" → ["KAHVILA"], "/wolt|foodora/" → ["WOLT",
 * "FOODORA"]. Anchors and \b are dropped (phrases match whole words anyway),
 * \s and \s+ become a space and escaped punctuation its own character. Null
 * when anything else is left (".", "+", "(", "[", "\d" …): such a rule never
 * matches, so no user pattern runs as a regex.
 */
function legacyPhrases(source: string): string[] | null {
  // null stands for ^, $ or \b, which may only sit at the ends of a phrase
  const alternatives: (string | null)[][] = [[]];
  for (let i = 0; i < source.length; i++) {
    const alt = alternatives[alternatives.length - 1]!;
    const c = source[i]!;
    if (c === "\\") {
      const next = source[++i];
      if (next === "s") {
        alt.push(" ");
        if (source[i + 1] === "+") i++;
      } else if (next === "b") alt.push(null);
      // \d, \w, \B, a backreference …
      else if (next === undefined || /[\p{L}\p{N}_]/u.test(next)) return null;
      else alt.push(next);
    } else if (c === "|") alternatives.push([]);
    else if (c === "^" || c === "$") alt.push(null);
    else if (".*+?{}()[]".includes(c)) return null;
    else alt.push(c);
  }
  const phrases: string[] = [];
  for (const alt of alternatives) {
    let lo = 0;
    let hi = alt.length;
    while (lo < hi && alt[lo] === null) lo++;
    while (hi > lo && alt[hi - 1] === null) hi--;
    const parts = alt.slice(lo, hi);
    if (parts.includes(null)) return null;
    // an empty alternative would match every text: leave it out
    const phrase = fold(parts.join("").trim());
    if (phrase) phrases.push(phrase);
  }
  return phrases.length ? phrases : null;
}

/**
 * Folded phrases a user pattern looks for, or null when it can never match.
 * "Lidl|Prisma" is either word. A trailing "*" ("K-Market*") is kept on the
 * phrase and means the text only has to start with it.
 */
function userPhrases(pattern: string): string[] | null {
  const regex = USER_REGEX.exec(pattern.trim());
  if (regex) return legacyPhrases(regex[1]!);
  const phrases = pattern.split("|").flatMap((alt) => {
    const words = fold(alt.replace(/\*+\s*$/, "").trim());
    if (!words) return [];
    return [/\*\s*$/.test(alt) ? `${words}*` : words];
  });
  return phrases.length ? phrases : null;
}

/** Why a new user pattern cannot be saved, or null. Rules are plain words; regexes are no longer accepted. */
export function patternProblem(pattern: string): string | null {
  if (USER_REGEX.test(pattern.trim())) return "Kirjoita pelkkä sana tai kauppiaan nimi ilman vinoviivoja.";
  return userPhrases(pattern) ? null : "Kirjoita sana tai kauppiaan nimi.";
}

/** Whether a saved pattern can match anything: plain text, or an old regex rule that is only words. */
export function isUsablePattern(pattern: string): boolean {
  return userPhrases(pattern) !== null;
}

/** Escapes regex syntax only: with the `u` flag an escaped "-" or letter is an error. */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * A phrase as whole words. The boundary goes only on a side that ends in a
 * letter or digit, so "PAYPAL *" finds "PAYPAL *SPOTIFY" and "K-" finds
 * "K-MARKET". Letters of every script count: "JOS" is not a word in "JOSÉ".
 * A trailing "*" drops the boundary at the end: "K-MARKET*" finds "K-MARKETIT".
 */
function phraseRegex(phrase: string): RegExp {
  const prefix = phrase.endsWith("*");
  const text = prefix ? phrase.slice(0, -1).trimEnd() : phrase;
  const start = /^[\p{L}\p{N}]/u.test(text) ? String.raw`(?<![\p{L}\p{N}])` : "";
  const end = !prefix && /[\p{L}\p{N}]$/u.test(text) ? String.raw`(?![\p{L}\p{N}])` : "";
  return new RegExp(start + escapeRegex(text) + end, "u");
}

/**
 * User pattern: plain text that matches as whole words after fold(), so
 * case and the dots of ä, å, ö do not matter ("VR" finds "VR LÄHIJUNA" but
 * not "EVRY OY"). Every member's rules
 * run in the same server process, so a user pattern is never run as a regex.
 */
export function compilePattern(pattern: string): (text: string) => boolean {
  const phrases = userPhrases(pattern);
  if (!phrases) return () => false;
  const res = phrases.map(phraseRegex);
  return (text) => res.some((re) => re.test(text));
}

/** A merchant_exact pattern: the whole merchant name, compared after fold(). */
function exactPattern(pattern: string): (text: string) => boolean {
  const name = fold(pattern.trim()).replace(/\s+/g, " ");
  return (text) => name !== "" && text.trim().replace(/\s+/g, " ") === name;
}

const isIncome = (category: string) => getCategory(category).kind === "income";

/** User rules (low priority number) are placed before the built-in rules. */
export function compileRules(userRules: readonly CategoryRule[]): CompiledRule[] {
  const user = userRules
    .filter((r) => !namesUnknownMerchant(r))
    .sort((a, b) => a.priority - b.priority)
    .map<CompiledRule>((r) => ({
      id: r.id,
      income: isIncome(r.category),
      category: r.category,
      field: r.field,
      byUser: true,
      test: r.field === "merchant_exact" ? exactPattern(r.pattern) : compilePattern(r.pattern),
    }));
  const builtin = BUILTIN_RULES.map<CompiledRule>((r) => ({
    category: r.category,
    income: isIncome(r.category),
    field: "any",
    direction: r.direction,
    test: r.when ? (text, input) => r.re.test(text) && r.when!(text, input) : (text) => r.re.test(text),
  }));
  const people: CompiledRule[] = [
    { category: "p2p_in", income: false, field: "any", direction: "in", test: (_text, input) => personViaMobilePay(input) },
    { category: "p2p", income: false, field: "any", direction: "out", test: (_text, input) => personViaMobilePay(input) },
  ];
  return [...user, ...people, ...builtin];
}

function fieldText(input: CategorizeInput, field: RuleField): string {
  switch (field) {
    case "merchant":
    case "merchant_exact":
      return fold(input.merchant);
    case "counterparty":
      return fold(input.counterparty ?? "");
    case "description":
      return fold(input.description ?? "");
    case "any":
      return fold([input.merchant, input.counterparty, input.description].filter(Boolean).join(" | "));
  }
}

export function categorize(input: CategorizeInput, rules: readonly CompiledRule[]): CategorizeResult {
  const direction: Direction = input.amountCents >= 0 ? "in" : "out";
  const texts = new Map<RuleField, string>();
  for (const rule of rules) {
    if (rule.direction && rule.direction !== direction) continue;
    // an income category never applies to money going out
    if (direction === "out" && rule.income) continue;
    let text = texts.get(rule.field);
    if (text === undefined) texts.set(rule.field, (text = fieldText(input, rule.field)));
    if (rule.test(text, input)) {
      const byUser = rule.byUser ? { byUser: true } : {};
      // a lender sending money (loan payout) is borrowing, not repayment
      if (direction === "in" && getCategory(rule.category).kind === "debt") return { category: "credit_draw", source: "rule", ...byUser };
      return { category: rule.category, source: "rule", ...byUser };
    }
  }
  const byMcc = categoryForMcc(input.mcc);
  if (byMcc) return { category: byMcc, source: "mcc" };
  // money in that no rule recognises (refunds are caught above by merchant rules)
  return { category: direction === "in" ? "income" : "other", source: "default" };
}
