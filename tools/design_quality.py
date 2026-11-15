#!/usr/bin/env python3
"""Validate template exports, prepare review sheets, and stage reviewed Apple icons."""
import argparse
import base64
import binascii
import hashlib
import html
import json
import math
from pathlib import Path
import re
import struct
import zlib

SHAPES = ('rectangle', 'square', 'circle')
ID = re.compile(r'[a-z][a-z0-9-]{0,47}')
SHA = re.compile(r'[a-f0-9]{64}')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_text())


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def local(root, name):
    require(isinstance(name, str) and name and '\\' not in name, 'Invalid relative path')
    path = root / name
    require(not Path(name).is_absolute() and '..' not in Path(name).parts and path.resolve().is_relative_to(root.resolve()), 'Path escapes root')
    return path


def png(data, alpha_only=False):
    """Decode bounded, static, non-interlaced RGBA8 PNGs without image dependencies."""
    require(len(data) <= 4 * 1024 * 1024 and data[:8] == b'\x89PNG\r\n\x1a\n', 'Invalid PNG')
    pos, chunks, compressed, ended = 8, [], bytearray(), False
    while pos + 12 <= len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        require(pos + length + 12 <= len(data), 'Truncated PNG chunk')
        crc = struct.unpack('>I', data[pos + 8 + length:pos + 12 + length])[0]
        require(binascii.crc32(kind + body) & 0xffffffff == crc, 'PNG CRC differs')
        require(kind not in (b'acTL', b'fcTL', b'fdAT'), 'Animated PNG is not supported')
        chunks.append(kind)
        if kind == b'IHDR':
            require(len(chunks) == 1 and length == 13, 'Invalid PNG header')
            width, height, depth, color, comp, filt, interlace = struct.unpack('>IIBBBBB', body)
            require(0 < width <= 2048 and 0 < height <= 2048 and (depth, color, comp, filt, interlace) == (8, 6, 0, 0, 0), 'Expected static RGBA8 PNG')
        elif kind == b'IDAT':
            compressed.extend(body)
        elif kind == b'IEND':
            require(length == 0 and pos + 12 == len(data), 'Invalid PNG end')
            ended = True
            break
        elif kind[0] & 32 == 0:
            raise ValueError('Unsupported critical PNG chunk')
        pos += length + 12
    require(ended and chunks[0] == b'IHDR' and compressed, 'Incomplete PNG')
    size = height * (width * 4 + 1)
    decoder = zlib.decompressobj()
    raw = decoder.decompress(compressed, size + 1)
    require(len(raw) == size and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail, 'Invalid PNG pixel stream')
    stride, pixels, previous = width * 4, bytearray(), bytearray(width if alpha_only else width * 4)
    step = 1 if alpha_only else 4
    for y in range(height):
        at = y * (stride + 1)
        mode, row = raw[at], bytearray(raw[at + 1:at + stride + 1])
        require(mode <= 4, 'Invalid PNG filter')
        if alpha_only:
            row = row[3::4]
        if mode == 0:
            pixels.extend(row)
            previous = row
            continue
        for x in range(len(row)):
            left, up, corner = (row[x - step] if x >= step else 0), previous[x], (previous[x - step] if x >= step else 0)
            if mode == 1:
                value = left
            elif mode == 2:
                value = up
            elif mode == 3:
                value = (left + up) // 2
            elif mode == 4:
                p = left + up - corner
                distances = (abs(p - left), abs(p - up), abs(p - corner))
                value = (left, up, corner)[distances.index(min(distances))]
            else:
                value = 0
            row[x] = (row[x] + value) & 255
        pixels.extend(row)
        previous = row
    return width, height, bytes(pixels), raw


def compressed_png(data):
    width, height, _, raw = png(data, alpha_only=True)
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', binascii.crc32(kind + body) & 0xffffffff)
    stream = zlib.compress(raw, 9)
    require(zlib.decompress(stream) == raw, 'Compression changed pixel scanlines')
    result = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'sRGB', b'\0') + chunk(b'IDAT', stream) + chunk(b'IEND', b'')
    return result if len(result) < len(data) else data


def profile(root):
    path = root / 'tools/design/baselines.json'
    value = load(path)
    require(value['version'] == 1 and value['exporter'] == 'quiettv-design-1', 'Unknown design profile')
    require(value['spanTolerance'] == 0.05 and value['centerTolerance'] == 0.02, 'Unexpected design tolerance')
    require(len(value['references']) == 6 and len({r['id'] for r in value['references']}) == 6, 'Expected six visual references')
    return value, digest(path.read_bytes())


def box(value, width, height):
    require(isinstance(value, list) and len(value) == 4 and all(type(n) in (int, float) and math.isfinite(n) for n in value), 'Invalid subject bounds')
    x0, y0, x1, y1 = value
    require(0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height, 'Subject is outside canvas')
    return value


def warnings(row, reference, rules):
    width, height = row['image']['width'], row['image']['height']
    a = box(row['subject']['core'], width, height)
    b = reference['core']
    span = max(a[2] - a[0], a[3] - a[1]) / max(b[2] - b[0], b[3] - b[1])
    center = max(abs((a[0] + a[2] - b[0] - b[2]) / (2 * width)), abs((a[1] + a[3] - b[1] - b[3]) / (2 * height)))
    return [code for code, failed in [('subject-scale', abs(span - 1) > rules['spanTolerance'] + 1e-6), ('subject-center', center > rules['centerTolerance'] + 1e-6)] if failed]


def check_row(row, directory, rules, profile_hash, published=False):
    require(row['exporter'] == rules['exporter'] and row['profileSha256'] == profile_hash, 'Export profile differs; export again')
    require(ID.fullmatch(row['id']) and row['style'] == 'apple' and row['form'] == 'icon' and row['shape'] in SHAPES, 'Unsupported design identity')
    references = {r['id']: r for r in rules['references']}
    require(row['reference'] in references, 'Unknown visual reference')
    reference = references[row['reference']]['variants'][row['shape']]
    for role in ('image', 'thumbnail'):
        asset, template = row[role], rules['templates'][row['shape']][role]
        key = 'path' if published else 'file'
        path = local(directory, asset[key])
        if published:
            require(re.fullmatch(r"images/apple/v[1-9][0-9]*/" + ('icons' if role == 'image' else 'thumbnails') + '/' + row['id'] + '-' + row['shape'] + r'\.png', asset[key]), 'Unexpected published design path')
        else:
            require(asset[key] == f"{'icons' if role == 'image' else 'thumbnails'}/{row['id']}-{row['shape']}.png", 'Unexpected export filename')
        data = path.read_bytes()
        require(asset['sha256'] == digest(data) and asset['bytes'] == len(data), f'Export hash differs: {path}')
        w, h, alpha, _ = png(data, alpha_only=True)
        require((w, h) == (template['width'], template['height']) == (asset['width'], asset['height']), 'Export dimensions differ')
        require(len(data) <= (1024 * 1024 if role == 'image' else 256 * 1024), 'Export exceeds byte limit')
        require(alpha == rules['_alpha'][(row['shape'], role)], f'Template contour differs: {path}')
    if published:
        require(row['image']['path'].split('/icons/')[0] == row['thumbnail']['path'].split('/thumbnails/')[0], 'Formal image and thumbnail resource versions differ')
    subject, source = row['subject'], row['foreground']
    require(subject['clippedPixels'] == 0, 'Subject is clipped by contour')
    require(SHA.fullmatch(source['sha256']) and type(source['width']) is int and type(source['height']) is int and 1024 <= min(source['width'], source['height']) <= max(source['width'], source['height']) <= 4096, 'Expected high resolution transparent foreground')
    core = box(source['core'], source['width'], source['height'])
    transform = subject['transform']
    require(len(transform) == 3 and all(type(n) in (int, float) and math.isfinite(n) for n in transform), 'Invalid subject transform')
    x, y, scale = transform
    require(0 < scale <= 1, 'Low resolution foreground would be enlarged')
    expected = [x + core[0] * scale, y + core[1] * scale, x + core[2] * scale, y + core[3] * scale]
    actual = box(subject['core'], row['image']['width'], row['image']['height'])
    require(max(abs(a - b) for a, b in zip(actual, expected)) < 0.01, 'Subject measurement differs from transform')
    box(subject['paint'], row['image']['width'], row['image']['height'])
    return warnings(row, reference, rules)


def complete_shapes(rows):
    require(len(rows) == 3 and {r['shape'] for r in rows} == set(SHAPES), 'Each export must include three shapes')
    require(len({(r['name'], r['nameEn'], r['reference']) for r in rows}) == 1, 'Shape identities or visual references differ')
    square = next(r for r in rows if r['shape'] == 'square')
    circle = next(r for r in rows if r['shape'] == 'circle')
    require(square['foreground'] == circle['foreground'], 'Square and circle must reuse the same foreground')


def prepared_profile(root):
    rules, fingerprint = profile(root)
    rules['_alpha'] = {}
    for shape in SHAPES:
        for role in ('image', 'thumbnail'):
            descriptor = rules['templates'][shape][role]
            data = local(root, descriptor['path']).read_bytes()
            require(digest(data) == descriptor['sha256'], 'Template hash differs')
            w, h, alpha, _ = png(data, alpha_only=True)
            require((w, h) == (descriptor['width'], descriptor['height']), 'Template dimensions differ')
            rules['_alpha'][(shape, role)] = alpha
    for ref in rules['references']:
        require(ref['style'] == 'apple' and set(ref['variants']) == set(SHAPES), 'Incomplete visual reference')
        for item in ref['variants'].values():
            data = local(root, item['path']).read_bytes()
            require(digest(data) == item['sha256'], 'Visual reference has changed')
            require(struct.unpack('>II', data[16:24]) == (item['width'], item['height']), 'Visual reference dimensions differ')
            box(item['core'], item['width'], item['height'])
    return rules, fingerprint


def verify(root, catalog):
    rules, fingerprint = prepared_profile(root)
    legacy = load(root / 'tools/design/legacy-assets.json')
    reviews = load(root / 'tools/design/reviews.json')
    require(reviews['version'] == 1, 'Unknown review registry')
    covered = {}
    batches = {}
    for path, sha in legacy.items():
        require(path.startswith('images/') and SHA.fullmatch(sha) and digest(local(root, path).read_bytes()) == sha, 'Historical artwork differs')
    for row in reviews['items']:
        flags = check_row(row, root, rules, fingerprint, published=True)
        require(row['review']['note'].strip() and (not flags or row['review']['deviationNote'].strip()), 'Visual review is missing')
        batches.setdefault((row['id'], row['image']['path'].split('/icons/')[0]), []).append(row)
        for role in ('image', 'thumbnail'):
            asset = row[role]
            require(asset['path'] not in covered and asset['path'] not in legacy, 'Repeated design approval')
            covered[asset['path']] = row, role
    for rows in batches.values():
        complete_shapes(rows)
    for path in (root / 'images').rglob('*.png'):
        name = path.relative_to(root).as_posix()
        require(name in legacy or name in covered, f'New artwork needs template export and review: {name}')
    for item in catalog['items']:
        for variant in item['variants']:
            for role in ('image', 'thumbnail'):
                asset = variant[role]
                if asset['path'] in legacy:
                    require(asset['sha256'] == legacy[asset['path']], 'Historical descriptor differs')
                else:
                    require(asset['path'] in covered, 'Design review is missing')
                    row, registered_role = covered[asset['path']]
                    require(registered_role == role and all(row[k] == item[k] for k in ('id', 'style')) and all(row[k] == variant[k] for k in ('shape', 'form')) and row[role] == asset, 'Design review does not match catalog')
    return len(legacy), len(reviews['items'])


def export_rows(directory, root):
    rules, fingerprint = prepared_profile(root)
    report = load(directory / 'export.json')
    require(report['version'] == 1 and report['items'], 'Empty or unknown export')
    groups, seen = {}, set()
    for row in report['items']:
        key = row['id'], row['shape']
        require(key not in seen, 'Duplicate exported shape')
        seen.add(key)
        groups.setdefault(row['id'], []).append(row)
        check_row(row, directory, rules, fingerprint)
    for rows in groups.values():
        complete_shapes(rows)
    return report, rules


def review_sheet(directory, root, report, rules):
    def image(path, width, height):
        data = base64.b64encode(path.read_bytes()).decode()
        return f'<img width="{width}" height="{height}" src="data:image/png;base64,{data}" alt="图标对照">'
    references = {r['id']: r for r in rules['references']}
    cards = []
    for row in report['items']:
        square = row['shape'] != 'rectangle'
        w, h = (176, 176) if square else (314, 177)
        ref = references[row['reference']]['variants'][row['shape']]
        candidate, reference = local(directory, row['image']['file']), local(root, ref['path'])
        flags = warnings(row, ref, rules)
        views = ''.join(f'<div class="pair {theme}"><figure>{image(reference,w,h)}<figcaption>确认基准</figcaption></figure><figure>{image(candidate,w,h)}<figcaption>候选图标</figcaption></figure></div>' for theme in ('dark', 'light'))
        small = image(candidate, 96 if square else 160, 96 if square else 90)
        core_label = '[' + ', '.join(f'{n:.1f}' for n in row['subject']['core']) + ']'
        cards.append(f'<section><h2>{html.escape(row["name"])}  {row["shape"]}</h2><p>参考 {html.escape(row["reference"])}  主体框 {core_label}  {html.escape(", ".join(flags) or "几何检查通过")}</p>{views}<div class="small">{small}<span>小尺寸辨识检查</span></div></section>')
    document = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quiet TV 图标发布前对照</title><style>body{font:16px system-ui;background:#202124;color:#eee;margin:24px}main{max-width:1400px;margin:auto}section{border:1px solid #686868;border-radius:16px;padding:20px;margin:24px 0}h1{font-size:28px}h2{font-size:20px}p{line-height:1.6}figure{margin:12px;display:grid;gap:8px;text-align:center}.pair{display:flex;flex-wrap:wrap;padding:12px;border-radius:12px}.dark{background:#111;color:white}.light{background:#eee;color:#222}img{object-fit:contain;max-width:100%;height:auto}.small{display:flex;align-items:center;gap:20px;padding:20px}</style><main><h1>Quiet TV 图标发布前对照</h1><p>逐项检查三种形状的主体大小、视觉居中、配色、边缘和小尺寸辨识度。几何通过后仍须确认视觉效果。矩形参考 314×177，方形与圆形参考 176×176；下方另提供小尺寸。</p>' + ''.join(cards) + '</main></html>'
    (directory / 'review.html').write_text(document)


def finalize(directory, root):
    report, rules = export_rows(directory, root)
    for row in report['items']:
        for role in ('image', 'thumbnail'):
            asset = row[role]
            path = local(directory, asset['file'])
            data = compressed_png(path.read_bytes())
            path.write_bytes(data)
            asset.update(bytes=len(data), sha256=digest(data))
    save(directory / 'export.json', report)
    export_rows(directory, root)
    review_sheet(directory, root, report, rules)
    print(f'Finalized {len(report["items"])} variants with lossless pixels. Review: {directory / "review.html"}')


def stage(args):
    report, rules = export_rows(args.export, args.root)
    require(args.review_note.strip(), 'A visual review note is required')
    require(args.resource_version > 0, 'Resource version must be positive')
    references = {r['id']: r for r in rules['references']}
    registry_path = args.root / 'tools/design/reviews.json'
    registry = load(registry_path)
    additions, writes, items = [], [], {}
    for row in report['items']:
        flags = warnings(row, references[row['reference']]['variants'][row['shape']], rules)
        require(not flags or args.deviation_note.strip(), f'{row["id"]} {row["shape"]} needs deviation review: {flags}')
        registered = json.loads(json.dumps(row))
        registered['review'] = dict(note=args.review_note, deviationNote=args.deviation_note)
        item = items.setdefault(row['id'], dict(id=row['id'], style='apple', name=row['name'], nameEn=row['nameEn'], source='Quiet TV custom icon design', variants=[]))
        variant = dict(shape=row['shape'], form='icon')
        for role in ('image', 'thumbnail'):
            asset = registered[role]
            relative = f"images/apple/v{args.resource_version}/{'icons' if role == 'image' else 'thumbnails'}/{row['id']}-{row['shape']}.png"
            target = local(args.root, relative)
            require(not target.exists(), f'Immutable path already exists: {relative}')
            writes.append((target, local(args.export, asset.pop('file')).read_bytes()))
            asset['path'] = relative
            variant[role] = asset.copy()
        item['variants'].append(variant)
        additions.append(registered)
    require(not ({r['image']['path'] for r in registry['items']} & {r['image']['path'] for r in additions}), 'Review already registered')
    fragment = args.export / 'catalog-items.json'
    require(not fragment.exists(), 'Catalog fragment already exists; use a fresh export directory')
    for path, data in writes:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    registry['items'].extend(additions)
    save(registry_path, registry)
    save(fragment, dict(items=list(items.values())))
    print(f'Staged {len(additions)} reviewed variants. Merge {fragment} into catalog, then sign with an increased revision.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('finalize', 'stage'):
        child = sub.add_parser(command)
        child.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
        child.add_argument('--export', type=Path, required=True)
        if command == 'stage':
            child.add_argument('--resource-version', type=int, required=True)
            child.add_argument('--review-note', required=True)
            child.add_argument('--deviation-note', default='')
    args = parser.parse_args()
    if args.command == 'finalize':
        finalize(args.export, args.root)
    else:
        stage(args)


if __name__ == '__main__':
    main()
