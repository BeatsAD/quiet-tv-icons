#!/usr/bin/env python3
"""Build or verify the signed online icon directory. Signing keys stay outside the repository."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tempfile

KEY_ID = 'quiettv-icons-1'
PATH = re.compile(r'images/[a-z0-9-]+/v[1-9][0-9]*/(?:icons|thumbnails)/[a-z0-9-]+\.png')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def envelope(root, name='latest.signed.json'):
    data = (root / name).read_bytes()
    if len(data) > 256 * 1024:
        raise ValueError('Icon directory exceeds 256 KiB')
    signed = json.loads(data)
    if signed['keyId'] != KEY_ID:
        raise ValueError('Unknown icon signing key')
    payload = base64.b64decode(signed['payload'], validate=True)
    # Keep the small public signature file; workspace policy forbids recursive cleanup.
    with tempfile.NamedTemporaryFile(prefix='quiettv-icon-signature-', delete=False) as signature:
        signature.write(base64.b64decode(signed['signature'], validate=True))
    subprocess.run(['openssl', 'dgst', '-sha256', '-keyform', 'DER', '-verify', str(root / 'public-key.der'),
                    '-signature', signature.name], input=payload, check=True, capture_output=True)
    return json.loads(payload)


def validate(root, name='latest.signed.json', artwork=True):
    catalog = envelope(root, name)
    if catalog['version'] != 2 or type(catalog['revision']) is not int or catalog['revision'] < 1 or len(catalog['items']) > 1024:
        raise ValueError('Invalid catalog version or item count')
    seen, count = set(), 0
    for item in catalog['items']:
        key = (item['style'], item['id'])
        if key in seen or not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', item['id']):
            raise ValueError('Invalid or repeated icon ID')
        seen.add(key)
        if item['style'] not in ('apple', 'google', 'flat', 'skeuo', 'soft', '3d', 'pixel') or not item['source'].strip() or not 1 <= len(item['name']) <= 40 or not 1 <= len(item['nameEn']) <= 80:
            raise ValueError('Invalid icon metadata')
        variants = set()
        if not 1 <= len(item['variants']) <= 7:
            raise ValueError('Invalid variant count')
        for variant in item['variants']:
            shape, form = variant['shape'], variant['form']
            if shape not in ('rectangle', 'square', 'circle') or form not in (('text', 'icon', 'transparent') if shape == 'rectangle' else ('icon', 'transparent')) or (shape, form) in variants:
                raise ValueError('Invalid icon variant')
            variants.add((shape, form))
            for thumbnail, field in ((False, 'image'), (True, 'thumbnail')):
                asset = variant[field]
                width, height = ((320, 180) if thumbnail else (720, 405)) if shape == 'rectangle' else ((256, 256) if thumbnail else (512, 512))
                if not PATH.fullmatch(asset['path']) or ('/thumbnails/' if thumbnail else '/icons/') not in asset['path'] or not re.fullmatch(r'[a-f0-9]{64}', asset['sha256']) or (asset['width'], asset['height']) != (width, height) or not 33 <= asset['bytes'] <= (256 * 1024 if thumbnail else 1024 * 1024):
                    raise ValueError('Invalid icon descriptor')
                if artwork:
                    data = (root / asset['path']).read_bytes()
                    if len(data) != asset['bytes'] or hashlib.sha256(data).hexdigest() != asset['sha256'] or data[:16] != b'\x89PNG\r\n\x1a\n\0\0\0\rIHDR' or struct.unpack('>IIBBBBB', data[16:29]) != (width, height, 8, 6, 0, 0, 0):
                        raise ValueError(f"Icon content differs: {asset['path']}")
                count += 1
    if artwork and (root / 'catalog.json').exists() and json.loads((root / 'catalog.json').read_bytes()) != catalog:
        raise ValueError('Gallery catalog differs from signed catalog')
    return len(seen), count


def build(args):
    source = json.loads((args.export / 'manifest.json').read_bytes())
    if source['count'] != len(source['items']) or source['style'] != 'apple' or source['shape'] != 'rectangle' or source['form'] != 'icon':
        raise ValueError('Expected reviewed Apple rectangle icon export')
    destination = args.output
    destination.mkdir(parents=True, exist_ok=True)
    items = []
    for item in source['items']:
        variant = dict(shape='rectangle', form='icon')
        for field, old in (('image', 'full'), ('thumbnail', 'thumbnail')):
            value = item[old]
            if value['file'] != f"{'icons' if old == 'full' else 'thumbnails'}/{item['id']}.png":
                raise ValueError('Invalid runtime export path')
            data = (args.export / value['file']).read_bytes()
            if len(data) != value['bytes'] or hashlib.sha256(data).hexdigest() != value['sha256']:
                raise ValueError('Runtime export hash differs')
            path = f"images/apple/v{args.revision}/{value['file']}"
            target = destination / path
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists() and target.read_bytes() != data:
                raise ValueError('Versioned artwork cannot be overwritten')
            target.write_bytes(data)
            variant[field] = {**{key: value[key] for key in ('width', 'height', 'bytes', 'sha256')}, 'path': path}
        items.append(dict(id=item['id'], name=item['name'], nameEn=item.get('nameEn', item['id'].replace('-', ' ').title()),
                          style='apple', source='Quiet TV custom icon design', variants=[variant]))
    payload = encoded(dict(version=2, revision=args.revision, items=items))
    signature = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(args.key)], input=payload, check=True, capture_output=True).stdout
    public = subprocess.run(['openssl', 'pkey', '-in', str(args.key), '-pubout', '-outform', 'DER'], check=True, capture_output=True).stdout
    signed = encoded(dict(keyId=KEY_ID, payload=base64.b64encode(payload).decode(), signature=base64.b64encode(signature).decode())) + b'\n'
    if (destination / 'latest.signed.json').exists():
        previous = envelope(destination)
        if previous['revision'] > args.revision or previous['revision'] == args.revision and encoded(previous) != payload:
            raise ValueError('Catalog revision must increase for changes')
    (destination / 'latest.signed.json').write_bytes(signed)
    (destination / 'public-key.der').write_bytes(public)
    (destination / 'catalog.json').write_bytes(payload + b'\n')
    if args.bootstrap:
        args.bootstrap.mkdir(parents=True, exist_ok=True)
        (args.bootstrap / 'online.json').write_bytes(signed)
        (args.bootstrap / 'public-key.der').write_bytes(public)
    print(f'Validated online catalog: {validate(destination)}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    pack = sub.add_parser('build')
    pack.add_argument('--export', type=Path, required=True)
    pack.add_argument('--key', type=Path, required=True)
    pack.add_argument('--revision', type=int, required=True)
    pack.add_argument('--output', type=Path, required=True)
    pack.add_argument('--bootstrap', type=Path)
    check = sub.add_parser('verify')
    check.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'build':
        if args.revision < 1:
            raise ValueError('Revision must be positive')
        build(args)
    else:
        print(f'Validated online catalog: {validate(args.root)}')


if __name__ == '__main__':
    main()
