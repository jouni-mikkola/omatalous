section: Maintenance
- Two redundant transaction indexes and an unused table are dropped, so a sync writes less.
upgrade: Migration 0031 drops the table view_opens and two indexes of transactions on the first start, after the usual copy. A rollback restores that copy.
