"""Create original Bisik assets. Requires Pillow only when regenerating icons."""
from pathlib import Path
from PIL import Image, ImageDraw
import json

root = Path(__file__).resolve().parents[1] / 'Bisik/Resources'
assets = root / 'Assets.xcassets'
icon_dir = assets / 'AppIcon.appiconset'
accent_dir = assets / 'AccentColor.colorset'
icon_dir.mkdir(parents=True, exist_ok=True)
accent_dir.mkdir(parents=True, exist_ok=True)
(assets / 'Contents.json').write_text(json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2))

# Oversampled, original microphone symbol; solid background for App Store icons.
im = Image.new('RGB', (2048, 2048), '#F7F7F5')
d = ImageDraw.Draw(im)
ink = '#212121'
d.rounded_rectangle((854, 450, 1194, 1150), radius=170, fill=ink)
d.arc((678, 684, 1370, 1380), 0, 180, fill=ink, width=68)
d.line((1024, 1352, 1024, 1560), fill=ink, width=68)
d.rounded_rectangle((840, 1532, 1208, 1600), radius=34, fill=ink)
for x, y1, y2 in [(480, 830, 1170), (620, 902, 1098), (1428, 902, 1098), (1568, 830, 1170)]:
    d.rounded_rectangle((x - 28, y1, x + 28, y2), radius=28, fill=ink)
im.resize((1024, 1024), Image.Resampling.LANCZOS).save(icon_dir / 'AppIcon.png')
(icon_dir / 'Contents.json').write_text(json.dumps({'images': [{'filename': 'AppIcon.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}], 'info': {'author': 'xcode', 'version': 1}}, indent=2))
(accent_dir / 'Contents.json').write_text(json.dumps({'colors': [{'idiom': 'universal', 'color': {'color-space': 'srgb', 'components': {'alpha': '1.000', 'red': '0.129', 'green': '0.129', 'blue': '0.129'}}}], 'info': {'author': 'xcode', 'version': 1}}, indent=2))

products = []
for period, suffix, name, price in [('P1M', 'monthly', 'Bisik Pro Bulanan', '49000'), ('P1Y', 'annual', 'Bisik Pro Tahunan', '399000')]:
    products.append({'adHocOffers': [], 'codeOffers': [], 'displayPrice': price, 'familyShareable': False, 'groupNumber': 1, 'internalID': 'bisik-' + suffix, 'introductoryOffer': None, 'localizations': [{'description': '300 menit transkripsi setiap bulan kalender UTC. Kuota bulanan tidak diakumulasi.', 'displayName': name, 'locale': 'id_ID'}], 'productID': 'com.maruz75.bisik.pro.' + suffix, 'recurringSubscriptionPeriod': period, 'referenceName': name, 'subscriptionGroupID': 'bisik-pro', 'type': 'RecurringSubscription', 'winBackOffers': []})
storekit = {'identifier': 'Bisik-Local-StoreKit', 'nonRenewingSubscriptions': [], 'products': [], 'settings': {'_applicationInternalID': '0', '_developerTeamID': '', '_failTransactionsEnabled': False, '_locale': 'id_ID', '_storefront': 'IDN', '_storeKitErrors': [], '_timeRate': 0}, 'subscriptionGroups': [{'id': 'bisik-pro', 'localizations': [{'description': 'Transkripsi lebih panjang dengan Bisik Pro', 'displayName': 'Bisik Pro', 'locale': 'id_ID'}], 'name': 'Bisik Pro', 'subscriptions': products}], 'version': {'major': 3, 'minor': 0}}
(root / 'Bisik.storekit').write_text(json.dumps(storekit, ensure_ascii=False, indent=2), encoding='utf-8')
print('Original icon, accent color, and local StoreKit configuration generated.')
