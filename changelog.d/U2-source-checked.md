section: Maintenance
- A source install can wait for GitHub's checks: with `TALOUS_SOURCE_CHECKED=yes` an update takes only a commit they passed.
upgrade: New optional `.env` key `TALOUS_SOURCE_CHECKED` (`yes` or `no`, default `no`), read only with `TALOUS_CHANNEL=source`.
