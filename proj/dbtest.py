import pymysql
from auth import _settings   # change "auth" to the actual module name of your auth file

try:
    c = pymysql.connect(**_settings(), connect_timeout=5)
    print("Connected OK")
    cur = c.cursor()
    cur.execute("SHOW TABLES")
    print(cur.fetchall())
except Exception as e:
    print(type(e).__name__, e)