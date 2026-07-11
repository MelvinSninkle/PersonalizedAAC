#!/usr/bin/env python3
"""Static server for the repo + stubbed /api/* so app.html renders a real board."""
import http.server, json, struct, zlib, hashlib, re
from urllib.parse import urlparse, parse_qs

ROOT = '/home/user/PersonalizedAAC'

def png_solid(rgb, size=256):
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    row = b'\x00' + bytes(rgb) * size
    idat = zlib.compress(row * size)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', idat) + chunk(b'IEND', b''))

def color_for(key):
    h = hashlib.md5(key.encode()).digest()
    # pastel-ish: bias channels up
    return (128 + h[0] // 2, 128 + h[1] // 2, 128 + h[2] // 2)

def cat(id, section, label, parentId=None, order=0):
    return dict(id=id, section=section, label=label, parentId=parentId,
                imageUrl=None, imageKey=f'cat-{id}', keepAspect=False,
                order=order, childId='testkid', ownerUserId=None,
                taxonomySlug=None, kind=None)

def item(id, section, categoryId, label, order=0, pinned=False):
    return dict(id=id, section=section, categoryId=categoryId, label=label,
                imageUrl=None, imageKey=f'img-{id}', soundUrl=None, soundKey=None,
                keepAspect=False, order=order, pinned=pinned, childId='testkid',
                ownerUserId=None, taxonomySlug=None, description=None,
                descriptions=None, descriptiveClues=None, needsReview=False)

CATS = [
    cat(1, 'people', 'Family', order=0), cat(2, 'people', 'Friends', order=1),
    cat(3, 'nouns', 'Food', order=0), cat(4, 'nouns', 'Snacks', parentId=3, order=0),
    cat(5, 'nouns', 'Meals', parentId=3, order=1), cat(6, 'nouns', 'Toys', order=1),
    cat(7, 'verbs', 'Actions', order=0),
]
ITEMS = (
    [item(10 + i, 'people', 1, n, i) for i, n in enumerate(['Mom', 'Dad', 'Gran', 'Baby'])]
    + [item(20 + i, 'people', 2, n, i) for i, n in enumerate(['Sam', 'Lily'])]
    + [item(30 + i, 'nouns', 4, n, i) for i, n in enumerate(['Apple', 'Cookie', 'Crackers', 'Banana', 'Yogurt', 'Cheese'])]
    + [item(40 + i, 'nouns', 5, n, i) for i, n in enumerate(['Pasta', 'Pizza', 'Soup', 'Tacos'])]
    + [item(50 + i, 'nouns', 6, n, i) for i, n in enumerate(['Blocks', 'Car', 'Ball', 'Bear', 'Train'])]
    + [item(60 + i, 'verbs', 7, n, i) for i, n in enumerate(['Run', 'Jump', 'Eat', 'Drink', 'Play', 'Sleep'])]
    + [item(70 + i, 'needs', None, n, i) for i, n in enumerate(['Yes', 'No', 'Eat', 'Drink', 'Help', 'More', 'All done', 'Potty'])]
)


# simulate a zh board: translated display layer on a few entries
for _it in ITEMS:
    if _it['label'] == 'Pizza': _it['displayLabel'] = '披萨'
    if _it['label'] == 'Cookie': _it['displayLabel'] = '饼干'
    if _it['label'] == 'Eat': _it['displayLabel'] = '吃'
for _c in CATS:
    if _c['label'] == 'Food': _c['displayLabel'] = '食物'

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith('/api/sync'):
            return self.send_json({'categories': CATS, 'items': ITEMS})
        if u.path.startswith('/api/media'):
            key = parse_qs(u.query).get('key', ['x'])[0]
            body = png_solid(color_for(key))
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path.startswith('/api/onboarding/state'):
            return self.send_json({'step': 'child_photo', 'childId': 'testkid',
                                   'data': {'childName': 'Fletcher', 'birthDate': '2022-03-01',
                                            'seedNextG': 0, 'seededCount': 0}})
        if u.path.startswith('/api/demo'):
            tiles = []
            for sec in ['people', 'nouns', 'verbs', 'needs']:
                for i in range(8):
                    tiles.append(dict(label=f'{sec} word {i}', section=sec,
                                      category='Food' if sec == 'nouns' else ('Family' if sec == 'people' else ''),
                                      subcategory='', imageKey=f'demo-{sec}-{i}'))
            return self.send_json({'ok': True, 'tiles': tiles, 'folders': [],
                                   'voices': [{'id': 'v1', 'name': 'Bella'}]})
        if u.path.startswith('/api/child-settings'):
            return self.send_json({'settings': {'tz': 'America/Denver'}})
        if u.path.startswith('/api/relationships'):
            return self.send_json({'relationships': [
                {'value': 'mother', 'label': 'Mother', 'age': 'adult'},
                {'value': 'sister', 'label': 'Sister', 'sibling': True, 'ageDefault': 'child'},
                {'value': 'family_friend', 'label': 'Family friend', 'ageDefault': 'adult'},
                {'value': 'pet', 'label': 'Pet'},
            ], 'sides': ['maternal', 'paternal'], 'pronouns': ['she', 'he', 'they']})
        if u.path.startswith('/api/admin/style-guides'):
            return self.send_json({'styleGuides': [
                {'id': 1, 'label': '3D Animated Style', 'active': True, 'personRefKey': 'p1', 'stuffRefKey': 's1', 'previewBlobKey': None, 'blobUrl': '/api/media?key=sg1', 'blobKey': 'sg1'},
                {'id': 2, 'label': 'Felt Style', 'active': True, 'personRefKey': None, 'stuffRefKey': None, 'previewBlobKey': None, 'blobUrl': '/api/media?key=sg2', 'blobKey': 'sg2'},
            ]})
        if u.path.startswith('/api/admin/lab') and 'action=style-defaults' in (u.query or ''):
            return self.send_json({'ok': True,
                'style': {'id': 1, 'label': '3D Animated Style', 'personRefKey': 'p1', 'stuffRefKey': 's1'},
                'tiles': [
                    {'id': 't1', 'label': 'yes', 'column': 'Needs', 'category': 'Core', 'subcategory': '', 'defaultable': True, 'genericKey': None, 'imageKey': 'img-a', 'status': 'done', 'error': None},
                    {'id': 't2', 'label': 'cow', 'column': 'Nouns', 'category': 'Animals', 'subcategory': 'Farm', 'defaultable': True, 'genericKey': None, 'imageKey': 'img-b', 'status': 'done', 'error': None},
                    {'id': 't3', 'label': 'horse', 'column': 'Nouns', 'category': 'Animals', 'subcategory': 'Farm', 'defaultable': True, 'genericKey': None, 'imageKey': None, 'status': None, 'error': None},
                    {'id': 't4', 'label': 'pizza', 'column': 'Nouns', 'category': 'Food', 'subcategory': '', 'defaultable': True, 'genericKey': None, 'imageKey': None, 'status': 'failed', 'error': 'engine busy'},
                    {'id': 't5', 'label': 'run', 'column': 'Verbs', 'category': 'Actions', 'subcategory': '', 'defaultable': False, 'genericKey': None, 'imageKey': 'img-c', 'status': 'done', 'error': None},
                ],
                'chips': [
                    {'section': 'nouns', 'label': 'Animals', 'parent': '', 'imageKey': 'chip-a', 'status': 'done', 'error': None},
                    {'section': 'nouns', 'label': 'Farm', 'parent': 'Animals', 'imageKey': None, 'status': None, 'error': None},
                    {'section': 'nouns', 'label': 'Food', 'parent': '', 'imageKey': 'chip-b', 'status': 'done', 'error': None},
                    {'section': 'verbs', 'label': 'Actions', 'parent': '', 'imageKey': 'chip-c', 'status': 'done', 'error': None},
                ],
                'counts': {'tiles': 5, 'tilesDone': 3, 'chips': 4, 'chipsDone': 3}})
        if u.path.startswith('/api/admin/lab') and 'action=voices' in (u.query or ''):
            return self.send_json({'ok': True, 'voices': [
                {'id': 'sB7vwSCyX0tQmU24cW2C', 'name': 'Jon', 'gender': 'Male', 'accent': 'American', 'active': True, 'sortOrder': 0},
                {'id': 'LZAcK8Cx5QjdQhfBsJQZ', 'name': 'Grace', 'gender': 'Female', 'accent': 'British', 'active': True, 'sortOrder': 1},
                {'id': 'oO7sLA3dWfQXsKeSAjpA', 'name': 'Sia', 'gender': 'Female', 'accent': 'Indian', 'active': False, 'sortOrder': 2},
            ]})
        if u.path.startswith('/api/admin/lab') and 'action=defaults-view' in (u.query or ''):
            return self.send_json({'ok': True, 'tiles': [
                {'id': 't1', 'label': 'yes', 'column': 'needs', 'category': 'Core'},
                {'id': 't2', 'label': 'no', 'column': 'needs', 'category': 'Core'},
                {'id': 't3', 'label': 'cow', 'column': 'nouns', 'category': 'Animals'},
                {'id': 't4', 'label': 'pizza', 'column': 'nouns', 'category': 'Food'},
                {'id': 't5', 'label': 'run', 'column': 'verbs', 'category': 'Actions'},
            ], 'folders': []})
        if u.path.startswith('/api/admin/lab') and 'action=layout' in (u.query or ''):
            return self.send_json({'ok': True, 'columns': [
                {'section': 'needs', 'categories': [
                    {'label': 'Core', 'parent': '', 'sort': 0, 'words': [
                        {'id': 'w1', 'label': 'yes', 'sort': 0}, {'id': 'w2', 'label': 'no', 'sort': 10},
                        {'id': 'w3', 'label': 'eat', 'sort': 20}], 'subs': []}]},
                {'section': 'people', 'categories': [
                    {'label': 'Family', 'parent': '', 'sort': 0, 'words': [
                        {'id': 'w4', 'label': 'Mom', 'sort': None}], 'subs': []}]},
                {'section': 'nouns', 'categories': [
                    {'label': 'Animals', 'parent': '', 'sort': 0, 'words': [],
                     'subs': [{'label': 'Farm', 'parent': 'Animals', 'sort': 0,
                               'words': [{'id': 'w5', 'label': 'cow', 'sort': None},
                                          {'id': 'w6', 'label': 'horse', 'sort': None}]}]},
                    {'label': 'Food', 'parent': '', 'sort': 10, 'words': [
                        {'id': 'w7', 'label': 'pizza', 'sort': None}], 'subs': []}]},
                {'section': 'verbs', 'categories': [
                    {'label': 'Actions', 'parent': '', 'sort': 0, 'words': [
                        {'id': 'w8', 'label': 'run', 'sort': None}], 'subs': []}]},
            ]})
        if u.path.startswith('/api/admin/lab') and 'action=reports' in (u.query or ''):
            import datetime
            now = datetime.datetime.now(datetime.timezone.utc)
            iso = lambda h: (now - datetime.timedelta(hours=h)).isoformat()
            return self.send_json({'ok': True,
                'summary': {'days': 30, 'boards': 3, 'boardsSynced24h': 2, 'boardsNeverSynced': 1,
                            'jobsQueued': 4, 'jobsFailed': 2, 'accounts': 3, 'signupsInWindow': 2,
                            'activeInWindow': 2, 'purchases': 2, 'purchasedCredits': 350,
                            'purchasedCents': 1998, 'fulfillmentAttention': 1},
                'boards': [
                    {'childId': 'fletcher', 'owner': 'peterson.andrew.a@gmail.com', 'items': 412,
                     'lastSyncAt': iso(1), 'lastTapAt': iso(3), 'jobsQueued': 0, 'jobsFailed': 0,
                     'userAgent': 'MyWorld-iOS/1.4 iPad'},
                    {'childId': 'kid-b', 'owner': 'other@example.com', 'items': 380,
                     'lastSyncAt': iso(60), 'lastTapAt': iso(90), 'jobsQueued': 4, 'jobsFailed': 2,
                     'userAgent': 'MyWorld-Android/1.2'},
                    {'childId': 'kid-c', 'owner': None, 'items': 12,
                     'lastSyncAt': None, 'lastTapAt': None, 'jobsQueued': 0, 'jobsFailed': 0, 'userAgent': None},
                ],
                'logins': [
                    {'email': 'peterson.andrew.a@gmail.com', 'role': 'admin', 'childId': 'fletcher',
                     'signedUpAt': iso(24 * 200), 'lastLoginAt': iso(2)},
                    {'email': 'other@example.com', 'role': 'parent', 'childId': 'kid-b',
                     'signedUpAt': iso(24 * 20), 'lastLoginAt': iso(24 * 18)},
                    {'email': 'ghost@example.com', 'role': 'parent', 'childId': None,
                     'signedUpAt': iso(24 * 40), 'lastLoginAt': None},
                ],
                'purchases': [
                    {'at': iso(30), 'email': 'other@example.com', 'platform': 'stripe',
                     'product': 'pack.large', 'credits': 300, 'cents': 1499},
                    {'at': iso(200), 'email': 'peterson.andrew.a@gmail.com', 'platform': 'apple',
                     'product': 'pack.small', 'credits': 50, 'cents': 499},
                ],
                'purchaseTotals': {'count': 2, 'credits': 350, 'cents': 1998},
                'fulfillment': [
                    {'status': 'stuck', 'email': 'other@example.com', 'childId': 'kid-b',
                     'boughtCredits': 300, 'boughtCents': 1499, 'buys': 1, 'spentCredits': 120, 'spends': 3,
                     'rendersDone': 96, 'rendersQueued': 4, 'rendersFailed': 2},
                    {'status': 'ok', 'email': 'peterson.andrew.a@gmail.com', 'childId': 'fletcher',
                     'boughtCredits': 50, 'boughtCents': 499, 'buys': 1, 'spentCredits': 30, 'spends': 2,
                     'rendersDone': 30, 'rendersQueued': 0, 'rendersFailed': 0},
                ]})
        if u.path.startswith('/api/admin/lab') and 'action=boards' in (u.query or ''):
            return self.send_json({'ok': True, 'boards': [
                {'section': 'nouns', 'label': 'Animals', 'count': 12, 'storeOnly': True, 'pricing': 'free'},
                {'section': 'nouns', 'label': 'Food', 'count': 8, 'storeOnly': True, 'pricing': 'credits'},
                {'section': 'verbs', 'label': 'Actions', 'count': 6, 'storeOnly': False, 'pricing': 'free'},
            ]})
        if u.path.startswith('/api/admin/lab') and 'action=publish' in (u.query or ''):
            return self.send_json({'ok': True, 'total': 5,
                                   'children': ['kid-a', 'kid-b', 'kid-c', 'kid-d', 'kid-e']})
        if u.path.startswith('/api/store'):
            action = parse_qs(u.query).get('action', [''])[0]
            if action == 'catalog':
                return self.send_json({'balance': 5, 'packs': [], 'subscriptions': [],
                                       'entitlement': None, 'rebuild': None})
            if action == 'browse':
                tiles = []
                for gi, (col, cat, words) in enumerate([
                    ('people', 'Family', ['Mom', 'Dad', 'Gran']),
                    ('nouns', 'Animals', ['cow', 'horse', 'pig', 'dog', 'cat']),
                    ('nouns', 'Food', ['pizza', 'apple', 'cookie']),
                    ('verbs', 'Actions', ['run', 'jump', 'eat']),
                ]):
                    for wi, w in enumerate(words):
                        tiles.append({'id': f't{gi}-{wi}', 'label': w, 'column': col,
                                      'category': cat, 'credits': 1, 'previewKey': f'img-{w}',
                                      'personalized': False, 'onBoard': wi == 0})
                return self.send_json({'tiles': tiles})
            return self.send_json({})
        if u.path.startswith('/api/milestones'):
            return self.send_json({'milestones': [
                {'kind': 'first_combo', 'key': 'first', 'payload': {'phrase': 'more bubbles'}, 'at': '2026-07-10T15:02:00Z'},
                {'kind': 'chain3', 'key': 'first', 'payload': {'phrase': 'I want cookie'}, 'at': '2026-07-11T09:10:00Z'},
                {'kind': 'words', 'key': 'words_25', 'payload': {'count': 25}, 'at': '2026-07-09T12:00:00Z'},
                {'kind': 'combo', 'key': 'combo:eat→banana', 'payload': {'phrase': 'eat banana'}, 'at': '2026-07-11T08:00:00Z'},
            ]})
        if u.path.startswith('/api/onboarding/voices'):
            return self.send_json({'voices': [
                {'id': 'sB7vwSCyX0tQmU24cW2C', 'name': 'Jon', 'gender': 'Male', 'accent': 'American'},
                {'id': 'LZAcK8Cx5QjdQhfBsJQZ', 'name': 'Grace', 'gender': 'Female', 'accent': 'British'},
            ], 'sampleText': 'Hi! This is how I sound.'})
        if u.path.startswith('/api/'):
            return self.send_json({})
        if re.match(r'^/u/[^/]+$', u.path):
            self.path = '/app.html'
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path.startswith('/api/onboarding/seed-core'):
            return self.send_json({'done': True, 'total': 13, 'placed': 13, 'failed': 0})
        if u.path.startswith('/api/admin/lab') and 'action=publish' in (u.query or ''):
            n = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(n) or b'{}')
            kids = ['kid-a', 'kid-b', 'kid-c', 'kid-d', 'kid-e']
            off = int(body.get('offset', 0))
            what = body.get('what', {})
            chunk = kids[off:off + (2 if what.get('sounds') else 10)]
            results = []
            for k in chunk:
                r = {'childId': k}
                if what.get('layout'): r['layout'] = {'cats': 3, 'tiles': 41}
                if what.get('sounds'): r['sounds'] = {'updated': 12, 'failed': 0, 'already': 300, 'partial': False}
                results.append(r)
            nxt = off + len(chunk)
            return self.send_json({'ok': True, 'total': len(kids), 'results': results,
                                   'nextOffset': nxt, 'done': nxt >= len(kids)})
        return self.send_json({})

    def send_json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
