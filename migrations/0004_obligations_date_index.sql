-- טעינה קלה: ימי חברות עד היום בלבד (בלי ימים עתידיים) – דרך אינדקס לפי התחייבות ותאריך
CREATE INDEX IF NOT EXISTS idx_obligations_commitment_date ON daily_obligations(commitment_id, local_date);
