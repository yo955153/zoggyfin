# Upload the Play store listing, the graphics and an .aab to the internal testing track.
#
# Run from the repo root:
#   uv run -q --with google-auth --with google-auth-httplib2 --with google-api-python-client \
#     python -I store/play/upload.py path/to/zoggyfin.aab [--status draft|completed] [--listing-only]
#
# The service account key is read from $PLAY_SERVICE_ACCOUNT_KEY
# (default: ~/.config/zoggyfin/play-service-account.json). Never commit the key.
# The script never touches the production track. A new app that Google has not
# reviewed yet accepts only draft releases; roll out the draft in Play Console.
import argparse, glob, os, sys

import google_auth_httplib2
import httplib2
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

PKG = 'com.zogtech.zoggyfin'
LANG = 'en-US'
HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.join(HERE, 'metadata', LANG)

ap = argparse.ArgumentParser()
ap.add_argument('aab', nargs='?')
ap.add_argument('--status', default='draft', choices=['draft', 'completed'])
ap.add_argument('--listing-only', action='store_true')
a = ap.parse_args()
if not a.listing_only and not a.aab:
    sys.exit('Give the .aab path, or use --listing-only.')

key = os.path.expanduser(os.environ.get('PLAY_SERVICE_ACCOUNT_KEY', '~/.config/zoggyfin/play-service-account.json'))
cred = service_account.Credentials.from_service_account_file(key, scopes=['https://www.googleapis.com/auth/androidpublisher'])
http = httplib2.Http(timeout=900)
http.redirect_codes = http.redirect_codes - {308}  # resumable uploads answer 308
svc = build('androidpublisher', 'v3', http=google_auth_httplib2.AuthorizedHttp(cred, http=http), cache_discovery=False)
E = svc.edits()


def read(name):
    with open(os.path.join(META, name), encoding='utf-8') as f:
        return f.read().strip()


eid = E.insert(packageName=PKG, body={}).execute()['id']
print('edit', eid, flush=True)

E.details().update(packageName=PKG, editId=eid, body={
    'defaultLanguage': LANG,
    'contactEmail': 'admin@zog-tech.com',
    'contactWebsite': 'https://zoggyfin.zog-tech.com',
}).execute()
E.listings().update(packageName=PKG, editId=eid, language=LANG, body={
    'language': LANG,
    'title': read('title.txt'),
    'shortDescription': read('short_description.txt'),
    'fullDescription': read('full_description.txt'),
}).execute()
print('listing ok', flush=True)


def images(kind, paths):
    E.images().deleteall(packageName=PKG, editId=eid, language=LANG, imageType=kind).execute()
    for p in paths:
        E.images().upload(packageName=PKG, editId=eid, language=LANG, imageType=kind,
                          media_body=MediaFileUpload(p, mimetype='image/png')).execute()
    print(kind, len(paths), flush=True)


img = os.path.join(META, 'images')
images('icon', [os.path.join(img, 'icon.png')])
images('featureGraphic', [os.path.join(img, 'featureGraphic.png')])
for kind in ('phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots'):
    shots = sorted(glob.glob(os.path.join(img, kind, '*.png')))
    if shots:
        images(kind, shots)

if not a.listing_only:
    b = E.bundles().upload(packageName=PKG, editId=eid, media_body=MediaFileUpload(
        a.aab, mimetype='application/octet-stream', resumable=True, chunksize=8 * 1024 * 1024)).execute(num_retries=3)
    vc = b['versionCode']
    print('bundle ok, versionCode', vc, flush=True)
    # Use changelogs/<versionCode>.txt, or else the newest changelog below that versionCode.
    logs = {int(os.path.basename(p)[:-4]): p for p in glob.glob(os.path.join(META, 'changelogs', '*.txt'))
            if os.path.basename(p)[:-4].isdigit()}
    older = [n for n in logs if n <= int(vc)]
    release = {'name': f'0.1.0 ({vc})', 'versionCodes': [str(vc)], 'status': a.status}
    if older:
        release['releaseNotes'] = [{'language': LANG, 'text': read(f'changelogs/{max(older)}.txt')}]
    E.tracks().update(packageName=PKG, editId=eid, track='internal',
                      body={'track': 'internal', 'releases': [release]}).execute()
    print('internal track ok', flush=True)

r = E.commit(packageName=PKG, editId=eid).execute()
print('commit ok', r.get('id'))
