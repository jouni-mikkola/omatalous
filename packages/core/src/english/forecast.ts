/** The English table of forecast; the Finnish one it must match is in ../messages-forecast.ts. */
import type { FI_FORECAST } from "../messages-forecast.ts";

export const EN_FORECAST: Record<keyof typeof FI_FORECAST, string> = {
  "forecast.title": "The next 12 months",
  "forecast.question": "Left over in the next 12 months",
  "forecast.none": "A forecast is not possible yet: it needs at least {min} complete months of rows.",
  "forecast.answer": "Savings, that is earned income less spending, add up to {mid} in 12 months as expected. The range is {low} to {high}.",
  "forecast.answer_worth": " Net worth is then {mid} as expected, in the range {low} to {high}.",
  "forecast.basis": "The forecast draws each month {runs} times from the savings of {months} complete months. The range is the 5th to the 95th percentile, and it held the real month of the test data in at least 80% of months when each month was forecast from the rows before it only. It does not know of big purchases to come, raises or price changes of bills.",
  "forecast.chart": "Net worth over the years",
  "forecast.chart_total": "Savings built up over the years",
  "forecast.chart_answer": "In five years net worth is {mid} as expected, in the range {low} to {high}.",
  "forecast.chart_answer_total": "In five years savings have built up to {mid} as expected, in the range {low} to {high}.",
  "forecast.chart_label": "Expected course and range by month, 5 years ahead. Use the arrow keys to move from month to month.",
  "forecast.legend_mid": "Estimate",
  "forecast.legend_range": "Range (90%)",
  "forecast.caption_months": "The next 12 months",
  "forecast.caption_years": "Years ahead",
  "forecast.col_month": "Month",
  "forecast.col_year": "Time",
  "forecast.col_low": "Lowest",
  "forecast.col_mid": "Estimate",
  "forecast.col_high": "Highest",
  "forecast.col_saving": "Saved",
  "forecast.col_total": "Savings so far",
  "forecast.col_worth": "Net worth",
  "forecast.years_ahead": "Year {n}",
};
