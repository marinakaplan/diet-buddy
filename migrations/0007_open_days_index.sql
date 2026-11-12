-- אינדקס חלקי על ימים שעוד לא הוכרעו: המשימה המתוזמנת (כל 5 דקות) מוצאת ימים לסגירה בלי לסרוק את כל ההתחייבויות.
CREATE INDEX IF NOT EXISTS idx_obligations_open ON daily_obligations(local_date) WHERE outcome IS NULL AND status IN ('scheduled','open');
