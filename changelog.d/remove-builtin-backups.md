section: Maintenance
- The app no longer makes backups: no daily copy, no copy to a NAS or another machine, no restore from the page. Back up the data folder yourself, see docs/ADVANCED.md.
- A damaged database is left as it is: the app answers with a notice and writes nothing, and you put back your own copy.
- The copies before an update, a migration, a reset or a secret rotation stay, and `./scripts/update.sh --rollback` works as before.
upgrade: Settings of the removed backups are deleted on the first start. `scripts/backup.sh`, `scripts/restore.sh`, `BACKUP_*` in `.env` and a cron line of `backup.sh --schedule` do nothing now: remove the cron line and keep your own backup of the data folder.
