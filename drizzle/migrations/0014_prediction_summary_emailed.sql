-- Track when a prediction's "you're locked in — here's what you predicted"
-- confirmation email was sent, so the auto-notifier sends it at most once.
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS summary_emailed_at TIMESTAMPTZ;
