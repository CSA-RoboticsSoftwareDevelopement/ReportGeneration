import pypdf
r = pypdf.PdfReader('proj/assets/Trailer_Report_TEMPLATE .pdf')
print('Pages:', len(r.pages))
fields = r.get_fields() or {}
print('Fields:', len(fields))
for name, field in fields.items():
    print(f'  {name}: FT={field.get("/FT")} V={field.get("/V")}')
