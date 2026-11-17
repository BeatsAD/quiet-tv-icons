// Deterministic, local-only post-processing. Never writes catalog or production assets.
export const canvas = (width, height) => Object.assign(document.createElement('canvas'), {width, height});
const context = c => c.getContext('2d', {willReadFrequently: true});
export const png = c => new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(Error('PNG 导出失败')), 'image/png'));
export const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
export async function decode(blob) {
  const url = URL.createObjectURL(blob), image = new Image();
  try { image.src = url; await image.decode(); return image; } finally { URL.revokeObjectURL(url); }
}
export function bounds(data, width, height, threshold = 128) {
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < threshold) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  if (right <= left || bottom <= top) throw Error('图片没有可见内容');
  return [left, top, right, bottom];
}
// Only extend the exterior low-alpha region. Old generated plates often have
// alpha 251–253 throughout their interior; those RGB pixels must never be filled.
export function extend(data, width, height) {
  const count = width * height, owners = new Int32Array(count).fill(-1), queue = new Int32Array(count), exterior = new Uint8Array(count);
  let head = 0, tail = 0;
  const mark = i => { if (!exterior[i] && data[i * 4 + 3] < 128) { exterior[i]=1;queue[tail++]=i; } };
  for (let x=0;x<width;x++) {mark(x);mark((height-1)*width+x);}
  for (let y=0;y<height;y++) {mark(y*width);mark(y*width+width-1);}
  while(head<tail) {const i=queue[head++],x=i%width;if(x)mark(i-1);if(x<width-1)mark(i+1);if(i>=width)mark(i-width);if(i<count-width)mark(i+width);}
  head=0;tail=0;
  for (let i = 0; i < count; i++) if (data[i * 4 + 3] >= 128) { owners[i] = i; queue[tail++] = i; }
  if (!tail) throw Error('没有可延展的不透明底板，请选择纯色底板或保留透明背景');
  const visit = (next, owner) => { if (exterior[next] && owners[next] === -1) { owners[next] = owner; queue[tail++] = next; } };
  while (head < tail) {
    const i = queue[head++], x = i % width, owner = owners[i];
    if (x) visit(i - 1, owner); if (x < width - 1) visit(i + 1, owner);
    if (i >= width) visit(i - width, owner); if (i < count - width) visit(i + width, owner);
  }
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    if (exterior[i] && owners[i] >= 0) { const source = owners[i] * 4; data[offset] = data[source]; data[offset + 1] = data[source + 1]; data[offset + 2] = data[source + 2]; }
    data[offset + 3] = 255;
  }
}
export function prepare(image, trim, background) {
  const source = canvas(image.width, image.height), ctx = context(source); ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, source.width, source.height), box = trim ? bounds(pixels.data, source.width, source.height) : [0, 0, source.width, source.height];
  const cropped = canvas(box[2] - box[0], box[3] - box[1]), cc = context(cropped);
  cc.drawImage(source, box[0], box[1], cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  if (background === 'extend') { const data = cc.getImageData(0, 0, cropped.width, cropped.height); extend(data.data, cropped.width, cropped.height); cc.putImageData(data, 0, 0); }
  return {canvas: cropped, box};
}
// Same continuous-corner coefficients as the desktop renderer, in output pixels.
function continuous(ctx, width, height, radius) {
  if (radius >= Math.min(width,height)/2) { ctx.roundRect(0,0,width,height,Math.min(width,height)/2); return; }
  if (radius <= 0) { ctx.rect(0,0,width,height); return; }
  const r = Math.min(radius, width / 2, height / 2), extent = 1.528665 * r, ex = Math.min(extent, width / 2), ey = Math.min(extent, height / 2);
  const ax = 1.08849 * r - .24304622 * (extent - ex), ay = 1.08849 * r - .24304622 * (extent - ey);
  const bx = .868407 * r - .09156464 * (extent - ex), by = .868407 * r - .09156464 * (extent - ey);
  const c = .631494 * r, h = .0749114 * r, u = .372824 * r, v = .16906 * r;
  ctx.moveTo(ex, 0); ctx.lineTo(width - ex, 0);
  ctx.bezierCurveTo(width - ax, 0, width - bx, 0, width - c, h); ctx.bezierCurveTo(width - u, v, width - v, u, width - h, c); ctx.bezierCurveTo(width, by, width, ay, width, ey);
  ctx.lineTo(width, height - ey); ctx.bezierCurveTo(width, height - ay, width, height - by, width - h, height - c); ctx.bezierCurveTo(width - v, height - u, width - u, height - v, width - c, height - h); ctx.bezierCurveTo(width - bx, height, width - ax, height, width - ex, height);
  ctx.lineTo(ex, height); ctx.bezierCurveTo(ax, height, bx, height, c, height - h); ctx.bezierCurveTo(u, height - v, v, height - u, h, height - c); ctx.bezierCurveTo(0, height - by, 0, height - ay, 0, height - ey);
  ctx.lineTo(0, ey); ctx.bezierCurveTo(0, ay, 0, by, h, c); ctx.bezierCurveTo(v, u, u, v, c, h); ctx.bezierCurveTo(bx, 0, ax, 0, ex, 0); ctx.closePath();
}
export function mask(settings, width, height, templates, role = 'image') {
  const result = canvas(width, height), ctx = context(result), {shape, curve, radius} = settings;
  if (curve === 'template') {
    ctx.drawImage(templates.get(shape + '-' + role), 0, 0, width, height);
  } else {
    const scale = Math.min(4, Math.floor(4096 / Math.max(width, height))), large = canvas(width * scale, height * scale), lc = context(large);
    lc.scale(scale, scale); lc.fillStyle = '#fff'; lc.beginPath();
    const r = radius * width / settings.width;
    if (shape === 'circle') lc.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
    else if (curve === 'sharp') lc.rect(0, 0, width, height);
    else if (curve === 'round') lc.roundRect(0, 0, width, height, Math.min(r, width / 2, height / 2));
    else continuous(lc, width, height, r);
    lc.fill(); ctx.drawImage(large, 0, 0, width, height);
  }
  return result;
}
export function validate(s) {
  if (!['rectangle', 'square', 'circle'].includes(s.shape) || !['template', 'continuous', 'round', 'sharp'].includes(s.curve) || !['extend', 'solid', 'transparent'].includes(s.background)) throw Error('裁剪选项无效');
  for (const key of ['width', 'height']) if (!Number.isInteger(s[key]) || s[key] < 64 || s[key] > 2048) throw Error('宽高须为 64–2048 的整数像素');
  if (!Number.isInteger(s.thumbWidth) || s.thumbWidth < 16 || s.thumbWidth > Math.min(s.width, 512)) throw Error('缩略图宽度须为 16–512 的整数，且不超过正式图');
  if (!Number.isFinite(s.radius) || s.radius < 0 || s.radius > Math.min(s.width, s.height) / 2) throw Error('圆角半径须在 0 到短边一半之间');
  if (![s.scale, s.x, s.y].every(Number.isFinite) || s.scale < .6 || s.scale > 1.4 || Math.abs(s.x) > 1024 || Math.abs(s.y) > 1024) throw Error('缩放或偏移参数无效');
  if (!/^#[0-9a-f]{6}$/i.test(s.color)) throw Error('底板颜色无效');
}
function applyMask(base, contour) {
  const output = canvas(contour.width, contour.height), ctx = context(output); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(base, 0, 0, output.width, output.height);
  const pixels = ctx.getImageData(0, 0, output.width, output.height), alpha = context(contour).getImageData(0, 0, output.width, output.height).data;
  for (let i = 3; i < pixels.data.length; i += 4) { pixels.data[i] = Math.round(pixels.data[i] * alpha[i] / 255); if (!pixels.data[i]) pixels.data[i - 3] = pixels.data[i - 2] = pixels.data[i - 1] = 0; }
  ctx.putImageData(pixels, 0, 0); return output;
}
export function render(prepared, s, templates, contours) {
  validate(s);
  const base = canvas(s.width, s.height), ctx = context(base), source = prepared.canvas;
  const scale = Math.min(s.width / source.width, s.height / source.height) * s.scale, w = source.width * scale, h = source.height * scale, x = (s.width - w) / 2 + s.x, y = (s.height - h) / 2 + s.y;
  ctx.imageSmoothingQuality = 'high';
  if (s.background === 'solid') { ctx.fillStyle = s.color; ctx.fillRect(0, 0, s.width, s.height); }
  if (s.background === 'extend') {
    // Letterbox and offset areas use only background edges, never stretched symbols.
    const left = Math.max(0, Math.min(s.width, x)), top = Math.max(0, Math.min(s.height, y)), right = Math.max(0, Math.min(s.width, x + w)), bottom = Math.max(0, Math.min(s.height, y + h));
    if (left) ctx.drawImage(source, 0, 0, 1, source.height, 0, y, left, h);
    if (right < s.width) ctx.drawImage(source, source.width - 1, 0, 1, source.height, right, y, s.width - right, h);
    if (top) ctx.drawImage(source, 0, 0, source.width, 1, x, 0, w, top);
    if (bottom < s.height) ctx.drawImage(source, 0, source.height - 1, source.width, 1, x, bottom, w, s.height - bottom);
    for (const [sx, sy, dx, dy, dw, dh] of [[0,0,0,0,left,top],[source.width-1,0,right,0,s.width-right,top],[0,source.height-1,0,bottom,left,s.height-bottom],[source.width-1,source.height-1,right,bottom,s.width-right,s.height-bottom]]) if (dw && dh) ctx.drawImage(source, sx, sy, 1, 1, dx, dy, dw, dh);
  }
  ctx.drawImage(source, x, y, w, h);
  // Explicit opacity removes subpixel seams along extended strip joins.
  if (s.background === 'extend') { const pixels = ctx.getImageData(0, 0, s.width, s.height); for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255; ctx.putImageData(pixels, 0, 0); }
  const thumbHeight = Math.round(s.height * s.thumbWidth / s.width), contour = contours?.image ?? mask(s, s.width, s.height, templates), thumbMask = contours?.thumbnail ?? mask(s, s.thumbWidth, thumbHeight, templates, 'thumbnail');
  return {image: applyMask(base, contour), thumbnail: applyMask(base, thumbMask), contour, box: prepared.box, scale, cropped: x < -.01 || y < -.01 || x + w > s.width + .01 || y + h > s.height + .01};
}
export function drawContain(ctx, image, x, y, width, height) {
  const ratio = Math.min(width / image.width, height / image.height), w = image.width * ratio, h = image.height * ratio;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}
export function contactSheet(rows, theme) {
  const width = 1600, top = 170, rowHeight = 270, sheet = canvas(width, top + Math.ceil(rows.length / 2) * rowHeight + 70), ctx = context(sheet), light = theme === 'light';
  ctx.fillStyle = light ? '#edf0f4' : '#101216'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = light ? '#172330' : '#f3f5f8'; ctx.font = '600 38px "PingFang SC", sans-serif'; ctx.fillText('Quiet TV  图标轮廓统一样稿', 56, 68);
  ctx.fillStyle = light ? '#4d5e70' : '#a4b3c3'; ctx.font = '21px "PingFang SC", sans-serif'; ctx.fillText('处理前 / 处理后    同尺寸等比展示    待确认', 56, 112);
  rows.forEach((row, i) => {
    const x = 56 + i % 2 * 772, y = top + Math.floor(i / 2) * rowHeight;
    ctx.fillStyle = light ? '#172330' : '#f3f5f8'; ctx.font = '600 24px "PingFang SC", sans-serif'; ctx.fillText(row.name, x, y);
    drawContain(ctx, row.before, x, y + 22, 320, 180); drawContain(ctx, row.result.image, x + 364, y + 22, 320, 180);
    ctx.font = '17px "PingFang SC", sans-serif'; ctx.fillStyle = light ? '#536474' : '#a4b3c3'; ctx.fillText('处理前', x, y + 231); ctx.fillStyle = light ? '#175d80' : '#a9d9f2'; ctx.fillText('处理后', x + 364, y + 231);
  });
  const s = rows[0].settings; ctx.fillStyle = light ? '#536474' : '#a4b3c3'; ctx.font = '19px "PingFang SC", sans-serif';
  ctx.fillText(`${s.width}×${s.height} px    ${s.curve === 'template' ? '图库固定轮廓模板' : s.curve + '  半径 ' + s.radius + ' px'}    PNG    独立输出，原图保留`, 56, sheet.height - 30);
  return sheet;
}
// Store-only ZIP, matching the existing exporter: PNG bytes are already compressed.
export function zip(entries) {
  const encoder = new TextEncoder(), table = Array.from({length:256}, (_, n) => { for (let i=0;i<8;i++) n=n&1?0xedb88320^(n>>>1):n>>>1; return n>>>0; });
  const crc = bytes => { let n=0xffffffff; for (const b of bytes) n=table[(n^b)&255]^(n>>>8); return (n^0xffffffff)>>>0; };
  const header = size => { const bytes=new Uint8Array(size); return [bytes,new DataView(bytes.buffer)]; };
  let offset=0; const local=[],central=[];
  for (const entry of entries) {
    const name=encoder.encode(entry.name), checksum=crc(entry.bytes), [a,av]=header(30+name.length), [b,bv]=header(46+name.length);
    av.setUint32(0,0x04034b50,true);av.setUint16(4,20,true);av.setUint16(6,0x800,true);av.setUint16(12,33,true);av.setUint32(14,checksum,true);av.setUint32(18,entry.bytes.length,true);av.setUint32(22,entry.bytes.length,true);av.setUint16(26,name.length,true);a.set(name,30);
    bv.setUint32(0,0x02014b50,true);bv.setUint16(4,20,true);bv.setUint16(6,20,true);bv.setUint16(8,0x800,true);bv.setUint16(14,33,true);bv.setUint32(16,checksum,true);bv.setUint32(20,entry.bytes.length,true);bv.setUint32(24,entry.bytes.length,true);bv.setUint16(28,name.length,true);bv.setUint32(42,offset,true);b.set(name,46);
    local.push(a,entry.bytes);central.push(b);offset+=a.length+entry.bytes.length;
  }
  const size=central.reduce((sum,b)=>sum+b.length,0), [end,view]=header(22);view.setUint32(0,0x06054b50,true);view.setUint16(8,entries.length,true);view.setUint16(10,entries.length,true);view.setUint32(12,size,true);view.setUint32(16,offset,true);
  return new Blob([...local,...central,end],{type:'application/zip'});
}
