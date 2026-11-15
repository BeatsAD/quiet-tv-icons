// Only this exporter constructs the outer plate. Generated foregrounds contain no plate.
const $ = selector => document.querySelector(selector);
const shapes = ['rectangle', 'square', 'circle'];
const encoder = new TextEncoder();
const assert = (condition, message) => { if (!condition) throw Error(message); };
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const canvas = (width, height) => Object.assign(document.createElement('canvas'), {width, height});
const context = c => c.getContext('2d', {willReadFrequently: true});
const bounds = (pixels, width, height, threshold) => {
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] < threshold) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  assert(x1 > x0 && y1 > y0, '前景没有可测量的主体');
  return [x0, y0, x1, y1];
};
const pngBytes = async c => new Uint8Array(await (await new Promise(resolve => c.toBlob(resolve, 'image/png'))).arrayBuffer());
const image = async blob => {
  const url = URL.createObjectURL(blob), img = new Image(); img.src = url;
  try { await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
};
const json = value => encoder.encode(JSON.stringify(value, null, 2) + '\n');
let profile, profileHash, output = null, previewURLs = [];
const masks = new Map();

async function init() {
  const response = await fetch('design/baselines.json'); assert(response.ok, '无法读取视觉基准');
  const bytes = await response.arrayBuffer(); profileHash = await hash(bytes); profile = JSON.parse(new TextDecoder().decode(bytes));
  for (const shape of shapes) for (const role of ['image', 'thumbnail']) {
    const descriptor = profile.templates[shape][role], response = await fetch('../' + descriptor.path);
    assert(response.ok, '无法读取轮廓模板'); const bytes = await response.arrayBuffer();
    assert(await hash(bytes) === descriptor.sha256, '轮廓模板哈希不符');
    const img = await image(new Blob([bytes], {type: 'image/png'}));
    const c = canvas(descriptor.width, descriptor.height), ctx = context(c); ctx.drawImage(img, 0, 0);
    masks.set(shape + '-' + role, ctx.getImageData(0, 0, c.width, c.height).data);
  }
  for (const reference of profile.references) {
    const card = document.createElement('figure'); card.className = 'reference';
    const img = new Image(); img.src = '../' + reference.variants.rectangle.path; img.alt = reference.name;
    const caption = document.createElement('figcaption'); caption.textContent = reference.name + '  ' + reference.id;
    card.append(img, caption); $('#references').append(card);
  }
  $('#status').textContent = '模板已就绪。选择配方和透明前景后生成。'; $('#export').disabled = false;
}

async function foreground(file) {
  assert(file && file.type === 'image/png', '缺少配方指定的前景 PNG');
  assert(file.size <= 32 * 1024 * 1024, '单张前景不能超过 32 MiB');
  const bytes = await file.arrayBuffer(), img = await image(file);
  assert(Math.min(img.width, img.height) >= 1024 && Math.max(img.width, img.height) <= 4096, '前景宽高须为 1024–4096 px');
  const c = canvas(img.width, img.height), ctx = context(c); ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
  const core = bounds(pixels, c.width, c.height, profile.coreAlpha), paint = bounds(pixels, c.width, c.height, profile.clipAlpha);
  assert(paint[0] > 0 && paint[1] > 0 && paint[2] < c.width && paint[3] < c.height, '前景边缘存在不透明内容：请去掉外底板，保留透明余量');
  return {img, core, paint, metadata: {file: file.name, sha256: await hash(bytes), width: img.width, height: img.height, core}};
}

function render(source, recipe, reference, shape) {
  const {width, height} = reference, core = source.core;
  const adjustment = recipe.scale ?? 1, offset = recipe.offset ?? [0, 0];
  assert(Number.isFinite(adjustment) && adjustment > 0 && adjustment <= 2 && Array.isArray(offset) && offset.length === 2 && offset.every(Number.isFinite), '缩放或偏移参数无效');
  const scale = Math.max(reference.core[2] - reference.core[0], reference.core[3] - reference.core[1]) / Math.max(core[2] - core[0], core[3] - core[1]) * adjustment;
  assert(scale <= 1, '核心主体分辨率不足，不能插值放大交付');
  const x = (reference.core[0] + reference.core[2]) / 2 + offset[0] - (core[0] + core[2]) / 2 * scale;
  const y = (reference.core[1] + reference.core[3]) / 2 + offset[1] - (core[1] + core[3]) / 2 * scale;
  const transformBox = b => [x + b[0] * scale, y + b[1] * scale, x + b[2] * scale, y + b[3] * scale];
  const paint = transformBox(source.paint);
  assert(paint[0] >= 0 && paint[1] >= 0 && paint[2] <= width && paint[3] <= height, '主体或投影超出画布，请调整构图');
  const fg = canvas(width, height), fc = context(fg); fc.imageSmoothingQuality = 'high';
  fc.drawImage(source.img, x, y, source.img.width * scale, source.img.height * scale);
  const data = fc.getImageData(0, 0, width, height).data, mask = masks.get(shape + '-image');
  let clippedPixels = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= profile.clipAlpha && mask[i] < 248) clippedPixels++;
  assert(clippedPixels === 0, '圆角或圆形会裁掉主体及投影，请调整前景');
  assert(Array.isArray(recipe.background) && recipe.background.length === 2 && recipe.background.every(c => /^#[a-fA-F0-9]{6}$/.test(c)), '背景需指定两个 #RRGGBB 颜色');
  const base = canvas(width, height), bc = context(base), gradient = bc.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, recipe.background[0]); gradient.addColorStop(1, recipe.background[1]);
  bc.fillStyle = gradient; bc.fillRect(0, 0, width, height); bc.drawImage(fg, 0, 0);
  return {base, subject: {core: transformBox(core), paint, transform: [x, y, scale], clippedPixels}};
}

function masked(base, shape, role) {
  const spec = profile.templates[shape][role], result = canvas(spec.width, spec.height), ctx = context(result);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(base, 0, 0, result.width, result.height);
  const data = ctx.getImageData(0, 0, result.width, result.height), mask = masks.get(shape + '-' + role);
  for (let i = 3; i < data.data.length; i += 4) {
    data.data[i] = mask[i];
    if (mask[i] === 0) data.data[i - 3] = data.data[i - 2] = data.data[i - 1] = 0;
  }
  ctx.putImageData(data, 0, 0); return result;
}

function preview(row, reference, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], {type: 'image/png'})); previewURLs.push(url);
  const square = row.shape !== 'rectangle', section = document.createElement('section'); section.className = 'candidate';
  const title = document.createElement('h2'); title.textContent = row.name + '  ' + row.shape; section.append(title);
  const caption = document.createElement('p'); caption.className = 'metrics';
  caption.textContent = '参考 ' + row.reference + '  主体框 ' + row.subject.core.map(n => n.toFixed(1)).join(', '); section.append(caption);
  for (const theme of ['dark', 'light']) {
    const pair = document.createElement('div'); pair.className = 'pair ' + theme;
    for (const [src, label] of [['../' + reference.path, '确认基准'], [url, '候选图标']]) {
      const figure = document.createElement('figure'), img = new Image(), caption = document.createElement('figcaption');
      img.src = src; img.width = square ? 176 : 314; img.height = square ? 176 : 177; img.alt = label;
      caption.textContent = label; figure.append(img, caption); pair.append(figure);
    }
    section.append(pair);
  }
  $('#preview').append(section);
}

async function generate(recipe, files) {
  assert(recipe.version === 1 && Array.isArray(recipe.items) && recipe.items.length > 0, '配方版本或条目无效');
  const seen = new Set(), entries = [], rows = [];
  for (const item of recipe.items) {
    assert(/^[a-z][a-z0-9-]{0,47}$/.test(item.id) && !seen.has(item.id), '应用 ID 无效或重复'); seen.add(item.id);
    assert(typeof item.name === 'string' && item.name.trim() && item.name.length <= 40 && typeof item.nameEn === 'string' && item.nameEn.trim() && item.nameEn.length <= 80, '请填写中英文名称');
    const ref = profile.references.find(r => r.id === item.reference); assert(ref, '请选择六款已确认基准之一');
    for (const construction of ['rectangle', 'square']) {
      const layout = item[construction]; assert(layout && typeof layout.foreground === 'string' && !/[\\/]/.test(layout.foreground), '前景文件名无效');
      const source = await foreground(files.get(layout.foreground));
      for (const shape of (construction === 'rectangle' ? ['rectangle'] : ['square', 'circle'])) {
        const reference = ref.variants[shape], {base, subject} = render(source, layout, reference, shape);
        const row = {id: item.id, name: item.name, nameEn: item.nameEn, style: 'apple', form: 'icon', shape, reference: item.reference, exporter: profile.exporter, profileSha256: profileHash, foreground: source.metadata, subject};
        for (const role of ['image', 'thumbnail']) {
          const spec = profile.templates[shape][role], bytes = await pngBytes(masked(base, shape, role));
          assert(bytes.length <= (role === 'image' ? 1024 * 1024 : 256 * 1024), '导出 PNG 超出体积上限');
          const file = (role === 'image' ? 'icons/' : 'thumbnails/') + item.id + '-' + shape + '.png';
          row[role] = {file, width: spec.width, height: spec.height, bytes: bytes.length, sha256: await hash(bytes)};
          entries.push({name: file, bytes}); if (role === 'image') preview(row, reference, bytes);
        }
        rows.push(row);
      }
    }
  }
  entries.push({name: 'export.json', bytes: json({version: 1, items: rows})}, {name: 'recipe.json', bytes: json(recipe)});
  return {entries, rows};
}

// Small ZIP writer using the store method; PNG data is already compressed.
function zip(entries) {
  const table = Array.from({length: 256}, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc = bytes => { let n = 0xffffffff; for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; };
  const header = size => { const bytes = new Uint8Array(size); return [bytes, new DataView(bytes.buffer)]; };
  let offset = 0; const local = [], central = [];
  // ZIP DOS date 33 means 1980-01-01; keep archive timestamps valid and reproducible.
  for (const entry of entries) {
    const name = encoder.encode(entry.name), checksum = crc(entry.bytes), [a, av] = header(30 + name.length), [b, bv] = header(46 + name.length);
    av.setUint32(0, 0x04034b50, true); av.setUint16(4, 20, true); av.setUint16(6, 0x800, true); av.setUint16(12, 33, true); av.setUint32(14, checksum, true); av.setUint32(18, entry.bytes.length, true); av.setUint32(22, entry.bytes.length, true); av.setUint16(26, name.length, true); a.set(name, 30);
    bv.setUint32(0, 0x02014b50, true); bv.setUint16(4, 20, true); bv.setUint16(6, 20, true); bv.setUint16(8, 0x800, true); bv.setUint16(14, 33, true); bv.setUint32(16, checksum, true); bv.setUint32(20, entry.bytes.length, true); bv.setUint32(24, entry.bytes.length, true); bv.setUint16(28, name.length, true); bv.setUint32(42, offset, true); b.set(name, 46);
    local.push(a, entry.bytes); central.push(b); offset += a.length + entry.bytes.length;
  }
  const centralSize = central.reduce((s, b) => s + b.length, 0), [end, view] = header(22);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], {type: 'application/zip'});
}

function clear() {
  output = null; $('#download').disabled = true; $('#preview').replaceChildren();
  previewURLs.forEach(url => URL.revokeObjectURL(url)); previewURLs = [];
}
$('#recipe').addEventListener('change', clear); $('#foregrounds').addEventListener('change', clear);
$('#export').addEventListener('click', async () => {
  clear(); $('#export').disabled = true; $('#status').className = ''; $('#status').textContent = '正在测量主体、生成三种形状和对照…';
  try {
    assert($('#recipe').files.length === 1, '请选择配方 JSON');
    const list = [...$('#foregrounds').files], files = new Map(list.map(f => [f.name, f])); assert(files.size === list.length, '前景文件名重复');
    output = await generate(JSON.parse(await $('#recipe').files[0].text()), files);
    $('#download').disabled = false; $('#status').textContent = `已生成 ${output.rows.length} 个形状版本和对应缩略图。下载后运行 finalize，查看完整对照稿，再登记发布。`;
  } catch (error) { clear(); $('#status').className = 'error'; $('#status').textContent = error.message; }
  finally { $('#export').disabled = false; }
});
$('#download').addEventListener('click', () => {
  if (!output) return; const url = URL.createObjectURL(zip(output.entries)), link = document.createElement('a');
  link.href = url; link.download = 'QuietTV-icon-export.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
});
init().catch(error => { $('#status').className = 'error'; $('#status').textContent = error.message; });
