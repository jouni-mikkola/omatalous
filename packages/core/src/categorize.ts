import { getCategory } from "./categories.ts";
import { bankRowRules } from "./categorize-bank-rows.ts";
import { categoryForMcc } from "./categorize-mcc.ts";
import { type Holders, holdersOf, noCard, peopleRules } from "./categorize-people.ts";
import { categoryForIndustry, type RegisterAnswer } from "./industry.ts";
import { fold, namesUnknownMerchant } from "./merchant.ts";
import { payeeRules } from "./payees.ts";
import { tradeWordCategory } from "./trade-words.ts";
import type { Account, CategoryRule, CategorySource, RuleField } from "./types.ts";
import { isCarDealerName, isCarTradeName } from "./wording-car.ts";
import { HOME_LOAN_WORDS, STUDENT_LOAN_WORDS } from "./wording-loan-pages.ts";
import { CARD_BRAND_WORDS, CARD_ISSUER_BANK_WORDS, CARD_ISSUER_WORDS, CONSUMER_LENDER_WORDS, CREDIT_WORDS, DAYCARE_WORDS, ELECTRICITY_NETWORK_WORDS, ELECTRICITY_SELLER_WORDS, FINANCE_LENDER_WORDS, hasPayeeForm, INSTALMENT_SERVICE_WORDS, INSURER_WORDS, isCashWithdrawalCode, isHousingCompanyName, isInstalmentPlanText, isNoCreditText, isOwnTransferCode, isRefundText, isReimbursementText, isSalaryCode, isSavingsAccountText, LANDLORD_WORDS, LOAN_WORDS, MOBILEPAY_WORDS, namesLoanOrCredit, NORDEA_CARD_WORDS, NORDEA_FINANCE_WORDS, OTHER_TAX_WORDS, PEER_LENDING_WORDS, PENSION_PAYER_WORDS, REIMBURSEMENT_WORDS, RESIDUAL_TAX_WORDS, RESURS_WORDS, words } from "./wording.ts";

export interface CategorizeInput {
  merchant: string;
  counterparty: string | null;
  description: string | null;
  mcc: string | null;
  bankTxnCode?: string | null;
  /** The payment's reference number. Absent: the row carries no such field and nothing is known; null or empty: the payment has none. */
  reference?: string | null;
  /** The payee's account. Absent or empty: the row has none, as a card purchase has not. */
  counterpartyIban?: string | null;
  /** The row's account pays this payee about the same sum in three or more months (`steadyParties`): a payee, not a single gift. Absent: not known, taken as no. */
  steadyPayee?: boolean;
  amountCents: number;
}

export interface CategorizeResult {
  category: string;
  source: Exclude<CategorySource, "user" | "transfer" | "merchant" | "industry" | "match" | "payer">;
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

/** Whole-word alternation: the one word boundary of the bank dialect (wording.ts). */
const w = words;

/** Banks that lend mortgages. Nordea's finance company (Nordea Rahoitus) lends for cars and cards instead. */
const MORTGAGE_BANK = w(String.raw`(?!${NORDEA_FINANCE_WORDS})NORDEA|OP|[A-Z]*OSUUSPANKKI|DANSKE|S-PANKKI|AKTIA|[A-Z]*SAASTOPANKKI|POP PANKKI|HANDELSBANKEN|ALANDSBANKEN`);

/**
 * Built-in rules for Finnish merchants and payment texts, matched against the folded (upper-case, ä→a, ö→o) merchant +
 * counterparty + description. First match wins: purpose-of-payment rules (debt, card bills, savings), the bank's own code
 * (CODE_RULES), lenders by name and the bank's own rows (categorize-bank-rows.ts), merchant rules, generic fallbacks last.
 */
const PURPOSE_RULES: readonly BuiltinRule[] = [
  // ── income ──
  {
    category: "salary",
    direction: "in",
    re: w(String.raw`PALKKA|PALKAN|PALKKAERA|LOMARAHA|LOMAPALKKA|LOMAKORVAUS|PALKKIO|KOKOUSPALKKIO|TYOKORVAUS|SALARY|LONEUTBETALNING|PAYROLL`),
  },
  // a peer-lending service pays back the loan given, interest and all: money that was saved comes home
  { category: "investments", direction: "in", re: w(PEER_LENDING_WORDS), when: (text) => !namesLoanOrCredit(text) },
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
  // The issuers that are banks also lend and take deposits: LAINA in the text is a loan payment (loans, below), SÄÄSTÖTILI is saving
  { category: "savings", re: w(CARD_ISSUER_BANK_WORDS), when: isSavingsAccountText },
  {
    category: "card_bill",
    direction: "out",
    re: w(
      String.raw`LUOTTOKORT[A-Z]*|KORTTILASKU|KORTIN LASKU|${NORDEA_CARD_WORDS}|(?:GOLD|PLATINUM)-?KORTTI|NORDEA (?:MASTERCARD|VISA)|OP[- ]?KORTTI(?:YHTIO)?|KORTTIYHTIO|AKTIA (?:VISA|MASTERCARD|KORTTI)|(?:${NORDEA_FINANCE_WORDS})[A-Z ]*(?:KORTTI|GOLD|PLATINUM|MASTERCARD|CREDIT)[A-Z]*|(?:MASTERCARD|VISA|AMEX)[A-Z ]*LASKU|AMERICAN EXPRESS|CREDIT CARD (?:PAYMENT|BILL)|OP[- ]?(?:VISA|MASTERCARD)|S-?ETUKORTTI VISA|(?:${CARD_ISSUER_BANK_WORDS})(?!.*LAINA)|${CARD_BRAND_WORDS}`,
    ),
  },
  // money in from a credit line (a card's "luoton siirto omalle tilille", financing payouts, a card issuer)
  {
    category: "credit_draw",
    direction: "in",
    re: w(String.raw`LUOTON ?NOSTO|LUOTONNOSTO|LUOTON SIIRTO|NOSTO LUOTOLTA|LUOTTOTILI|${CARD_ISSUER_WORDS}|${NORDEA_CARD_WORDS}`),
  },

  // ── debt service (money in from a lender becomes credit_draw, see categorize()) ──
  { category: "mortgage", re: w(HOME_LOAN_WORDS) },
  { category: "student_loan", re: w(STUDENT_LOAN_WORDS) },
  // a loan payment to a bank is the mortgage; other lenders' loans are consumer credit (loans, below)
  { category: "mortgage", re: w(String.raw`LAINANMAKSU|LAINAN ?LYHENNYS|LAINANLYHENNYS|LAINANHOITO`), when: (text) => MORTGAGE_BANK.test(text) },
  {
    category: "collection",
    re: w(String.raw`INTRUM|LOWELL|ALEKTUM|PERINTA[A-Z]*|PERINTATOIMISTO|SVEA PERINTA|VISMA COLLECTORS|RESCOMP|SERGEL|LINDORFF|GOTHIA|PRA GROUP|CREDIGO|MEDIATOR`),
  },
  // money in from enforcement is a refund or a share of a debt collected for the user, not a loan
  { category: "collection", direction: "out", re: w(String.raw`ULOSOTTO[A-Z]*`) },
  { category: "interest", re: w(String.raw`KORKO|KORKOKULU|LUOTONKORKO|LUOTTOKORKO|VIIVASTYSKORKO|LUOTTOKULU[A-Z]*|LUOTTOKUSTANNUS|NOSTOPALKKIO`) },
  { category: "loans", re: w(String.raw`(?:${NORDEA_FINANCE_WORDS})[A-Z ]*|${LOAN_WORDS}|LUOTTO|${RESURS_WORDS}|${CARD_ISSUER_BANK_WORDS}|${CONSUMER_LENDER_WORDS}`) },
  // credit named by a compound, and the finance companies; a card purchase, a lease, a bond, a housing company's own loan and a refund stay what the rules below make them
  { category: "loans", re: w(`${CREDIT_WORDS}|${FINANCE_LENDER_WORDS}`), when: (text, input) => noCard(input) && !isNoCreditText(text) && !isHousingCompanyName(fold(input.counterparty ?? "")) && !(input.amountCents > 0 && isRefundText(text)) },
  // a purchase paid in parts through a payment service; one paid at once is shopping, and so is a refund (below)
  { category: "loans", direction: "out", re: w(INSTALMENT_SERVICE_WORDS), when: (text) => isInstalmentPlanText(text) },

  // ── savings & investments (both directions: money back from them reduces savings) ──
  { category: "pension", re: w(String.raw`ELAKEVAKUUTUS|ELAKESAASTO[A-Z]*|PS-TILI|PITKAAIKAISSAASTO[A-Z]*|VAPAAEHTOINEN ELAKE`) },
  {
    category: "investments",
    re: w(
      String.raw`NORDNET|RAHASTO[A-Z]*|NORDEA RAHASTO[A-Z]*|SAASTOSOPIMUS|KUUKAUSISAASTO[A-Z]*|OSAKESAASTOTILI|OST|ARVOPAPERI[A-Z]*|SIJOITUS[A-Z]*|SELIGSON|EVLI|EQ|SAXO|DEGIRO|INTERACTIVE BROKERS|LYNX|TRADE REPUBLIC|LIGHTYEAR|MONTHIO|TITAN|${PEER_LENDING_WORDS}|COINBASE|BITSTAMP|KRAKEN|BINANCE|NORTHCRYPTO|COINMOTION|TAVEX|SIJOITUSKULTA|KULTAHARKKO|HOPEAHARKKO|JALOMETALLI[A-Z]*|GOLD BULLION`,
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
      String.raw`PALVELUMAKSU|PALVELUPAKETTI|PAIVITTAISPALVELU[A-Z]*|KUUKAUSIMAKSU NORDEA|TILINHOITOMAKSU|KORTTIMAKSU|KORTIN VUOSIMAKSU|KORTTIVUOSIMAKSU|PANKKIMAKSU|SERVICE FEE|VALUUTANVAIHTO[A-Z]*|VALUUTTAMUUNNOS[A-Z]*|ULKOMAANMAKSU|NOSTOMAKSU|MUISTUTUSMAKSU`,
    ),
  },
  { category: "cash", direction: "out", re: w(String.raw`KATEISNOSTO|OTTO|ATM|AUTOMAATTI|CASH WITHDRAWAL`) },
  {
    category: "taxes",
    direction: "out",
    re: w(
      String.raw`VEROHALLINTO|${RESIDUAL_TAX_WORDS}|${OTHER_TAX_WORDS}|LAHDEVERO|TRAFICOM|YLEISRADIO|POLIISI[A-Z]*|OIKEUSREKISTERIKESKUS|RIKESAKKO|SAKKO|PYSAKOINTIVIRHE[A-Z]*|PYSAKOINNINVALVONTA|VALVONTAMAKSU|TARKASTUSMAKSU|PARKKIPATE|TULLI|DIGI- JA VAESTOTIETOVIRASTO|DVV|MAANMITTAUSLAITOS|PATENTTI- JA REKISTERIHALLITUS|MAAHANMUUTTOVIRASTO|MIGRI`,
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
  ...payeeRules(fold).later,
  {
    category: "utilities",
    re: w(
      String.raw`${ELECTRICITY_SELLER_WORDS}|SAVON VOIMA|${ELECTRICITY_NETWORK_WORDS}|PKS|SAHKO(?!ASENN|ASENT|TYO|URAKOINTI|LIIKE|PALVELU)[A-Z]*|[A-Z]*ENERGIA|KAUKOLAMPO|GASUM|JATEMAKSU|PUHAS|NUOHOUS[A-Z]*`,
    ),
  },
  // premiums only: money in from an insurer is a claim payout (reimbursements, below)
  { category: "insurance", direction: "out", re: new RegExp(INSURER_WORDS) },
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
      String.raw`MUSTI JA MIRRI|MUSTI|PETENKOTI|PET CITY|ELAINLAAKARI[A-Z]*|ELAINSAIRAALA|ELAINKLINIKKA|EVIDENSIA|ANICURA|ZOOPLUS|FAUNATAR|LEMMIKKI[A-Z]*|[A-Z]*KENNEL[A-Z]*|KOIRAHOITOLA|ELAINHOITOLA|KOIRAKOULU|[A-Z]*TRIMMAAMO|AGRIA`,
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
      String.raw`[A-Z]*APTEEKKI|TERVEYSTALO|MEHILAINEN|PIHLAJALINNA|DIACOR|DEXTRA|PLUSTERVEYS|CORONARIA|ATTENDO|ESPERI|OMA LAAKARI|HAMMAS[A-Z]*|DENTAL|DENTO|HAMPAAT|HAMPAAN[A-Z]*|SUUHYGIENISTI|LAAKARIASEMA|[A-Z]*FYSIO[A-Z]*|NAKOKESKUS|LUONTAISTUOTE[A-Z]*|TERVEYSKESKUS|TERVEYSASEMA|[A-Z-]*HYVINVOINTIALUE[A-Z]*|HUS|SAIRAALA|POLIKLINIKKA|TYOTERVEYS[A-Z]*|SYNLAB|HUSLAB|LABORATORIO|[A-Z]*TERAPIA|PSYKOLOGI[A-Z]*|KIROPRAKTIKKO|OSTEOPAATTI|NAPRAPAATTI|JALKAHOITO[A-Z]*|[A-Z]*HIERONTA|INSTRUMENTARIUM|SPECSAVERS|SYNSAM|NEWSEC OPTIKKO|OPTIKKO|[A-Z]*OPTIIKKA|SILMAASEMA|SILMALAAKARI|LAAKARIKESKUS`,
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
      String.raw`[A-Z]*KAMPAAMO|HIUSSALONKI|[A-Z]*SALONKI|HAIR SALON|[A-Z]*PARTURI[A-Z-]*|BARBER[A-Z]*|HIUS[A-Z]*|TUKKA[A-Z]*|KAUNEUS[A-Z]*|KOSMETOLOGI|KYNSI[A-Z]*|MANIKYYRI|PEDIKYYRI|SOLARIUM|LYKO|KICKS|SOKOS EMOTION|EMOTION|SKINCITY|SEPHORA|THE BODY SHOP|SPA`,
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
      String.raw`HSL|HELSINGIN SEUDUN LIIKENNE|VR|VR-YHTYMA|NYSSE|FOLI|WALTTI|[A-Z]*JOUKKOLIIKENNE|MATKAHUOLTO|ONNIBUS|FLIXBUS|SAVONLINJA|PAUNU|KOIVISTON AUTO|POHJOLAN LIIKENNE|[A-Z]*TAKSI[A-Z]*|TAXI|LAHITAKSI|KAJON|VALOPILKKU|MENEVA|UBER|BOLT|TIER|VOI|LIME|DOTT|HOOP|RYDE|KAUPUNKIPYORA[A-Z]*|PYORAHUOLTO|PYORAKORJAAMO|CITYBIKE[A-Z]*`,
    ),
  },
  {
    category: "car",
    re: w(
      String.raw`NESTE|ST1|ABC|SHELL|TEBOIL|SEO|GULF|EASYPARK|APCOA|SCANDINAVIAN PARKING|PARKMAN|MOOVY|AIMO PARK|EUROPARK|Q-PARK|P-HUB|PYSAKOINTI|PARKKI[A-Z]*|[A-Z-]*KATSASTUS|AVAINASEMA|RENGAS[A-Z]*|RENKAAT|AUTOPESU[A-Z]*|AUTOHUOLTO|AUTOPALVELU|AUTOKORJAAMO|KORJAAMO|AUTOMAALAAMO|MEKONOMEN|EUROMASTER|VIANOR|K-LATAUS|VIRTA|PLUGIT|RECHARGE|IONITY|SUPERCHARGER|TESLA`,
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
      String.raw`[A-Z]*RAVINTOLA|RESTAURANT|RAFLAAMO|CAFE|[A-Z]*KAHVILA|KUPPILA|COFFEE|ESPRESSO HOUSE|STARBUCKS|ROBERT'?S COFFEE|FAZER CAFE|FAZER FOOD|MCDONALD'?S?|[A-Z]*BURGER[A-Z]*|SOCIAL BURGERJOINT|FRIENDS & BRGRS|SUBWAY|KOTIPIZZA|[A-Z]*PIZZERIA|PIZZA[A-Z]*|THAI|KEITTIO|[A-Z]*JAATELO|PIZZA HUT|DOMINO'?S|SUSHI|RAX|PICNIC|ROLLS|FAFA'?S|ROSSO|AMARILLO|CHICO'?S|O'?LEARYS|PANCHO VILLA|AMICA|SODEXO|COMPASS|UNICAFE|JUVENES|LOUNAS|LOUNASRAVINTOLA|LOUNASKAHVILA|[A-Z]*BAARI|BAR|PUB|BISTRO|GRILL|KEBAB|TACO|VAPIANO|FRANKIES|ARNOLDS|PANDA|LEIPOMO|KONDITORIA|PULLAPUOTI|PULLAKAHVILA|[A-Z]*PANIMO|OLUTRAVINTOLA|KROGI|TRATTORIA|OSTERIA|BRASSERIE|STEAKHOUSE|RAMEN|NOODLE[A-Z]*|NUUDELI[A-Z]*|FALAFEL|GYROS|BURRITO|TANDOORI|CURRY|NEPAL[A-Z]*|INTIALAINEN|INDIAN`,
    ),
  },
  // the paint maker; Tikkurila is also a district of Vantaa (FYSIOPISTE TIKKURILA OY)
  { category: "home", re: w("TIKKURILA OYJ?"), when: (_text, input) => /^TIKKURILA OYJ?(?![A-Z0-9])/.test(fold((input.counterparty || input.description || "").trim())) },
  {
    category: "home",
    re: w(
      String.raw`IKEA|JYSK|BAUHAUS|K-?RAUTA|RAUTA|RAUTAKAUPPA|RAUTIA|RAUTAKESKO|EURONICS|MEDIA ?MARKT|ELKJOP|ELGIGANTEN|FOTOKEMA|STARK|OBI|BILTEMA|MOTONET|PUUILO|GIGANTTI|VERKKOKAUPPA\.?COM|POWER|JIMMS|PROSHOP|DUSTIN|DATATRONIC|MULTITRONIC|APPLE STORE|ASKO|SOTKA|MASKU OY|MASKUN KALUSTETALO|VEPSALAINEN OY|VEPSALAINEN\.COM|ISKU|INDISKA|BEDSHOP|UNIKULMA|HOBBY HALL|CLAS OHLSON|PLANTAGEN|HAKAMAKI|HONG KONG|SINOOPPI|[A-Z]*KUKKA[A-Z]*|KIMPPU|FLORISTI[A-Z]*|[A-Z]*PUUTARHA[A-Z]*|[A-Z]*PESULA|LUKKOLIIKE|HUOLTOMIES|[A-Z]*SIIVOUS[A-Z]*|KOTISIIVOUS|IKKUNANPESU|[A-Z]*REMONTTI[A-Z]*|SAHKO(?:ASENN|ASENT|PALVELU|TYO|URAKOINTI)[A-Z]*|LVI|PUTKI(?!NEN)[A-Z]*|LUKKOSEPPA|SUUTARI|OMMELU|KELLOSEPPA|VAATEKORJAAMO|BETONI|MAANRAKENNUS|PIHAKIVI|PIHA|KATTOREMONTTI|MAALARI|[A-Z]*MAALAUS[A-Z]*|SIIVOUSPALVELU[A-Z]*|SIIVOUSLIIKE|MUUTTO[A-Z]*|PIHATYO[A-Z]*|LUMITYO[A-Z]*|KOTITALKKARI`,
    ),
  },
  {
    category: "shopping",
    re: w(
      String.raw`ZALANDO|H&M|HM|LINDEX|KAPPAHL|ZARA|GINA TRICOT|BIK BOK|CUBUS|MANGO|PEPCO|NEW YORKER|RESERVED|STADIUM|XXL|NIKE|ADIDAS|PUMA|SPORTS ?DIRECT|DECATHLON|HALENS|ANTTILA|INTERSPORT|DRESSMANN|CARLINGS|KOOKENKA|FOOTWAY|NILSON SHOES|DIN SKO|STOCKMANN|SOKOS|TOKMANNI|J\. ?KARKKAINEN|KARKKAINEN OY|AMAZON|AMZN|ALIEXPRESS|TEMU|SHEIN|ETSY|EBAY|NORMAL|FLYING TIGER|SOSTRENE GRENE|HALPA-HALLI|TOKYO|IITTALA|MARIMEKKO|FINLAYSON|PENTIK|${INSTALMENT_SERVICE_WORDS}|BOOZT|ELLOS|VERO MODA|JACK & JONES|NAKKI|BRANDOS|ADLIBRIS|AKATEEMINEN|SUOMALAINEN KIRJAKAUPPA|KIRJAKAUPPA|ANTIKVARIAATTI|KIRPPUTORI|KIERRATYSKESKUS|UFF|FIDA LAHETYSTORI`,
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
  // last: a city or municipality without a more specific purpose (daycare and health care are matched above). A merchant rule, so a town's name is no person's (namedLikeBusiness)
  { category: "taxes", direction: "out", re: w(String.raw`[A-Z]+N KAUPUNKI|[A-Z]+N KUNTA|KAUPUNGINKANSLIA`) },
];

/** Generic fallbacks, after every merchant rule. */
const FALLBACK_RULES: readonly BuiltinRule[] = [
  // a travel claim comes with its number glued on (MATKALASKU123456)
  { category: "reimbursements", direction: "in", re: w(REIMBURSEMENT_WORDS, true) },
  // a company paid or paying with MobilePay is not a person (TIKKURILAN TIIKERIT RY)
  { category: "p2p_in", direction: "in", re: w(`${MOBILEPAY_WORDS}|SIIRTO HENKILOLTA`), when: (_text, input) => !hasPayeeForm(fold(input.counterparty ?? "")) },
  { category: "p2p", direction: "out", re: w(`${MOBILEPAY_WORDS}|SIIRTO HENKILOLLE`), when: (_text, input) => !hasPayeeForm(fold(input.counterparty ?? "")) },
];

// An employer may be a shop too, so a code (lists in wording.ts) decides before a merchant's name. COAT is as the words OMA SIIRTO.
const CODE_RULES: readonly CompiledRule[] = [
  { category: "salary", income: true, field: "any", direction: "in", test: (text, input) => isSalaryCode(input.bankTxnCode) && !isReimbursementText(text) },
  { category: "cash", income: false, field: "any", direction: "out", test: (_text, input) => isCashWithdrawalCode(input.bankTxnCode) },
  { category: "savings", income: false, field: "any", test: (_text, input) => isOwnTransferCode(input.bankTxnCode) },
];

/**
 * Whether a merchant rule recognises the name as a business: a trade word
 * that the rules also find inside a compound (KESÄKAHVILA, LÄHIAPTEEKKI), or
 * a brand of several words, or one with a digit or a hyphen in it (FITNESS24, K-RAUTA). A brand of one plain word
 * is not enough: first names and surnames are often brand words too (Elisa, Helen, Silja, Asko, Virta).
 */
function namedLikeBusiness(name: string): boolean {
  return isCarTradeName(name) || MERCHANT_RULES.some((r) => {
    // "Q" + word matches only through a "[A-Z]*" prefix, which the rules give trade words
    if (name.split(" ").some((word) => r.re.test(`Q${word}`))) return true;
    return /[ \d-]/.test(r.re.exec(name)?.[0] ?? "");
  });
}

/** Whether a message alone holds a word of a shop's or service's rule: the person paid may be paid for what the word names. */
const namesShopOrService = (message: string) => MERCHANT_RULES.some((r) => r.re.test(message));

/** A payment to a car dealer buys the car from this sum on; under it the row is the car's upkeep. */
const CAR_PRICE_CENTS = 150_000;
/** The category of a car dealer's row by its sum. Money in follows the same sum: a deposit paid back is the purchase's. */
export const dealerCategory = (amountCents: number) => (Math.abs(amountCents) >= CAR_PRICE_CENTS ? "vehicle_purchase" : "car");

export interface CompiledRule {
  id?: number;
  /** The category is an income one; resolved once because every row is tested against every rule. */
  income: boolean;
  category: string;
  field: RuleField;
  direction?: Direction;
  /** One of the user's own rules. */
  byUser?: boolean;
  /** `input` is there for rules that look at a single field, `holders` for the rules about people (categorize-people.ts), `accounts` for those about the household's banks. */
  test: (text: string, input: CategorizeInput, holders: Holders, accounts: readonly Account[]) => boolean;
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

/**
 * What a company's own name says it sells, for a register entry whose industry is too broad to say (wholesale 46900) or
 * missing: a car dealer's name (wording-car.ts) or a generic trade noun (trade-words.ts, a short list: brand words are
 * no trade). A car dealer's name gives `vehicle_purchase`, which the sum of a row turns into the car or its upkeep.
 */
export function categoryByTradeWord(name: string): string | null {
  const folded = fold(name);
  if (isCarTradeName(folded) && !headedByOtherRule(folded)) return isCarDealerName(folded) ? "vehicle_purchase" : "car";
  return tradeWordCategory(folded);
}

/** The category a register answer gives: its industry's, else the trade word of the company's name. */
export function categoryForCompany({ code, codeSet, companyName }: RegisterAnswer): string | null {
  return (code && codeSet ? categoryForIndustry(code, codeSet) : null) ?? (companyName ? categoryByTradeWord(companyName) : null);
}

/** A shop, a bus company or a school whose own name stands first keeps its rule: K-Market Autokeskus, Koiviston Auto. */
const headedByOtherRule = (name: string) => MERCHANT_RULES.some((r) => r.category !== "car" && r.re.exec(name)?.index === 0);
/**
 * A car dealer's row, by the payee's name alone (wording-car.ts) and before the shops, whose words a dealer's name may
 * hold (Auto Market). The sum tells the car from its upkeep; a garage of the trade is upkeep at any sum.
 */
const DEALER_RULES: readonly CompiledRule[] = [
  { category: "vehicle_purchase", income: false, field: "merchant", test: (name, input) => dealerCategory(input.amountCents) !== "car" && isCarDealerName(name) && !headedByOtherRule(name) },
  { category: "car", income: false, field: "merchant", test: (name) => isCarTradeName(name) && !headedByOtherRule(name) },
];

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
  const builtin = (rules: readonly BuiltinRule[]) => rules.map<CompiledRule>((r) => ({
    category: r.category,
    income: isIncome(r.category),
    field: "any",
    direction: r.direction,
    test: r.when ? (text, input) => r.re.test(text) && r.when!(text, input) : (text) => r.re.test(text),
  }));
  // a card code of a shop: the money transfer code (p2p) is none
  const people = peopleRules(namedLikeBusiness, (mcc) => (categoryForMcc(mcc) ?? "p2p") !== "p2p", namesShopOrService);
  return [...user, ...people.first, ...builtin(payeeRules(fold).first), ...builtin(PURPOSE_RULES), ...CODE_RULES, ...people.plain, ...bankRowRules(namedLikeBusiness, (mcc) => categoryForMcc(mcc) === "cash"), ...DEALER_RULES, ...builtin([...MERCHANT_RULES, ...FALLBACK_RULES])];
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

export function categorize(input: CategorizeInput, rules: readonly CompiledRule[], accounts: readonly Account[] = []): CategorizeResult {
  const direction: Direction = input.amountCents >= 0 ? "in" : "out";
  const holders = holdersOf(accounts);
  const texts = new Map<RuleField, string>();
  for (const rule of rules) {
    if (rule.direction && rule.direction !== direction) continue;
    // an income category never applies to money going out
    if (direction === "out" && rule.income) continue;
    let text = texts.get(rule.field);
    if (text === undefined) texts.set(rule.field, (text = fieldText(input, rule.field)));
    if (rule.test(text, input, holders, accounts)) {
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
