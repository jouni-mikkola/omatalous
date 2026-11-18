section: Money and reports
- Loans that follow a euribor rate now use its published daily fixings.
upgrade: Migration 0032 runs on the first start, after the usual copy. The app fetches the euribor fixings once a day from reports.suomenpankki.fi. Set `REFERENCE_RATES=false` in `.env` to turn that off.
