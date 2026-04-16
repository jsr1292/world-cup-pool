# Migrations

## 001_add_has_paid_to_predictions

```sql
ALTER TABLE predictions ADD COLUMN has_paid INTEGER DEFAULT 0;
```

Per-entry payment tracking. Each prediction entry has its own `has_paid` status.
Legacy `pool_members.has_paid` is kept as fallback for backwards compatibility.
