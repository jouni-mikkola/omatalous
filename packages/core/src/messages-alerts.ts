/**
 * The alerts of the overview (`analysis/alerts.ts`, `subscription-alerts.ts`): one title and one detail each.
 * Decision: the household reads each warning in the language they chose and sees at once what it costs.
 * Same shape and the same test as the tables of `messages.ts`.
 */
export const FI_ALERTS = {
  "alr.double_twice": "Sama veloitus kahdesti: {merchant} {amount}",
  "alr.double_times": "Sama veloitus {n} kertaa: {merchant} {amount}",
  "alr.double_days": "{first} ja {second}",
  "alr.late_title": "Myöhästymiskuluja {amount}",
  "alr.late_last": "viimeksi {date}",
  "alr.uncategorised": "Luokittelematon maksu",
  "alr.overlap_title": "{count} {noun}",
  "alr.overlap_detail": "{names}, yhteensä {amount} kuussa",
  "alr.noun_audiobooks": "äänikirjapalvelua",
  "alr.noun_music": "musiikkipalvelua",
  "alr.noun_cloud": "pilvitallennuspalvelua",
  "alr.noun_video": "videopalvelua",
  "alr.spike_title": "{label} {amount} {when}",
  "alr.spike_about": "noin {amount}",
  "alr.spike_none": "ei lainkaan",
  "alr.spike_cut": "Tavallisesti siihen mennessä {expected}",
  "alr.spike_so_far": "Tavallisesti tähän mennessä {expected}",
  "alr.spike_expected": "Tavallisesti {expected}",
  "alr.spike_expected_month": "Tavallisesti {expected}/kk",
  "alr.fees_title": "Pankkikuluja {amount} vuodessa",
  "alr.habit_title": "{merchant} {n} kertaa kuussa",
  "alr.habit_detail": "Noin {amount} vuodessa",
  "alr.forgotten_title": "{merchant} {price} kuussa, {yearly} vuodessa",
  "alr.forgotten_detail": "Olet maksanut {n} kuukautta.",
  "alr.cancelled_title": "{merchant} veloitti {date}, vaikka merkitsit sen lopetetuksi.",
  "alr.cancelled_detail": "{n} veloitusta, yhteensä {amount}",
  "alr.spike_in_month": "{month}",
} as const;
