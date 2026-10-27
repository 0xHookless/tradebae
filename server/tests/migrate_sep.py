import sqlite3
c = sqlite3.connect(r"C:\TradingPlatform\server\data.db")
c.execute("UPDATE software SET separate_executable=1 WHERE slug IN ('atas','atas-x','bookmap','motivewave','sierra-chart')")
c.commit()
print(c.execute("SELECT slug, separate_executable FROM software").fetchall())
