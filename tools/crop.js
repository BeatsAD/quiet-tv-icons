import {canvas, png, sha256, decode, bounds, prepare, render, mask, validate, drawContain, contactSheet, zip} from './crop-engine.js';

const $ = selector => document.querySelector(selector), encoder = new TextEncoder();
const sampleIds = ['music', 'settings', 'aliyun-drive', 'xunlei', 'douyin', 'quiettv'];
const templates = new Map(), entries = [], curves = {template:'图库固定模板', continuous:'连续圆角', round:'普通圆角', sharp:'直角'};
let catalog, selected = '', revision = 0, timer, rows = [], uploadId = 0;
const ctx = c => c.getContext('2d', {willReadFrequently:true});
const setStatus = (message, error = false) => { $('#status').textContent = message; $('#status').classList.toggle('error', error); };
const paint = (target, source) => { target.width = source.width; target.height = source.height; ctx(target).drawImage(source, 0, 0); };
const disableExports = disabled => { $('#download-current').disabled = disabled; $('#download-review').disabled = disabled; };

function settings() {
  const result = {shape:$('#shape').value, width:Number($('#width').value), height:Number($('#height').value), curve:$('#curve').value, radius:Number($('#radius').value), background:$('#background').value, color:$('#color').value, trim:$('#trim').checked, scale:Number($('#scale').value)/100, x:Number($('#offset-x').value), y:Number($('#offset-y').value), thumbWidth:Number($('#thumb-width').value)};
  if (!$('#settings').checkValidity()) throw Error('请检查裁剪参数的范围');
  validate(result); return result;
}
function updateControls() {
  const circle = $('#shape').value === 'circle', fixed = $('#curve').value === 'template', sharp = $('#curve').value === 'sharp';
  $('#curve').disabled = circle; $('#radius').disabled = circle || fixed || sharp;
  $('#radius-field').hidden = circle || fixed || sharp;
  $('#radius').max = Math.min(Number($('#width').value), Number($('#height').value))/2;
  $('#radius-note').textContent = circle ? '圆形直径由输出尺寸决定。' : fixed ? '固定模板包含完整曲线，不由生图决定。' : sharp ? '输出直角矩形，不应用圆角。' : '半径以正式图像素计，缩略图按比例换算。';
  $('#color-field').hidden = $('#background').value !== 'solid';
  $('#scale-value').value = $('#scale').value + '%';
}
function defaults() {
  const rectangle = $('#shape').value === 'rectangle';
  for (const [id,value] of Object.entries({width:rectangle?720:512,height:rectangle?405:512,curve:'template',radius:rectangle?89.1:112.6,background:'extend',scale:100,'offset-x':0,'offset-y':0,'thumb-width':rectangle?320:256})) $('#' + id).value = value;
  $('#trim').checked = true; updateControls();
}
async function sourceFor(entry, shape) {
  const key = entry.item ? shape : 'upload';
  if (!entry.sources.has(key)) {
    const descriptor = entry.item.variants.find(v => v.shape === shape)?.image;
    if (!descriptor) throw Error(entry.name + ' 缺少对应形状，请使用适合的构图');
    const response = await fetch('../' + descriptor.path); if (!response.ok) throw Error('无法读取 ' + entry.name);
    const blob = await response.blob(), bytes = await blob.arrayBuffer();
    if (await sha256(bytes) !== descriptor.sha256) throw Error(entry.name + ' 原图校验不符');
    entry.sources.set(key, {image:await decode(blob), blob, path:descriptor.path, sha256:descriptor.sha256, prepared:new Map()});
  }
  return entry.sources.get(key);
}
function sourceList() {
  $('#source-count').textContent = String(entries.length); $('#source-list').replaceChildren();
  for (const entry of entries) {
    const button = document.createElement('button'), image = document.createElement('img'), text = document.createElement('span'), name = document.createElement('strong'), note = document.createElement('small');
    button.className = 'source'; button.setAttribute('aria-pressed', String(entry.id === selected)); button.dataset.id = entry.id;
    image.src = entry.preview; image.alt = ''; name.textContent = entry.name; note.textContent = entry.item ? '现有图库' : '本地图片'; text.append(name,note); button.append(image,text);
    button.addEventListener('click', () => { selected = entry.id; sourceList(); showActive(); }); $('#source-list').append(button);
  }
}
function showActive() {
  const row = rows.find(row => row.id === selected); if (!row) return;
  $('#active-name').textContent = row.name; $('#source-meta').textContent = `${row.before.width} × ${row.before.height} px  /  ${row.source.blob.type}`;
  paint($('#before'), row.before); paint($('#after'), row.result.image); paint($('#thumbnail'), row.result.thumbnail);
  $('#after-label').textContent = row.settings.shape === 'circle' ? '统一圆形' : curves[row.settings.curve];
  $('#output-meta').textContent = `${row.result.image.width} × ${row.result.image.height} px  /  PNG`;
  $('#thumb-meta').textContent = `${row.result.thumbnail.width} × ${row.result.thumbnail.height} px`;
  $('#mask-check').textContent = row.settings.background === 'transparent' ? '保留主体透明度' : '外轮廓与遮罩一致';
}
function reviews() {
  $('#review-grid').replaceChildren();
  for (const row of rows) {
    const card = document.createElement('article'), title = document.createElement('h3'), pair = document.createElement('div'), labels = document.createElement('div'), metrics = document.createElement('p');
    card.className = 'review-card'; title.textContent = row.name; pair.className = 'mini-pair'; labels.className = 'mini-labels'; metrics.className = 'metrics';
    for (const [image,label] of [[row.before,'处理前'],[row.result.image,'处理后']]) {
      const board = document.createElement('div'), preview = canvas(320, row.settings.shape === 'rectangle' ? 180 : 320), caption = document.createElement('span');
      board.className = 'mini-art'; drawContain(ctx(preview),image,0,0,preview.width,preview.height); board.append(preview); pair.append(board); caption.textContent = label; labels.append(caption);
    }
    const box = row.result.box; metrics.textContent = `${row.result.image.width}×${row.result.image.height} px  ${curves[row.settings.curve]}${row.settings.trim ? '  源图有效框 ' + (box[2]-box[0]) + '×' + (box[3]-box[1]) : ''}`;
    card.append(title,pair,labels,metrics); $('#review-grid').append(card);
  }
}
async function process(token) {
  try {
    const s = settings(), next = []; if (!entries.length) return;
    const contours = {image:mask(s,s.width,s.height,templates),thumbnail:mask(s,s.thumbWidth,Math.round(s.height*s.thumbWidth/s.width),templates,'thumbnail')};
    setStatus('正在处理本地样稿…');
    for (const entry of entries) {
      const source = await sourceFor(entry,s.shape); if (token !== revision) return;
      const key = JSON.stringify([s.trim,s.background]);
      if (!source.prepared.has(key)) source.prepared.set(key,prepare(source.image,s.trim,s.background));
      next.push({id:entry.id,name:entry.name,before:source.image,source,settings:{...s},result:render(source.prepared.get(key),s,templates,contours)});
      await new Promise(resolve => requestAnimationFrame(resolve)); if (token !== revision) return;
    }
    rows = next; showActive(); reviews(); disableExports(false);
    const clipped = rows.some(row => row.result.cropped), enlarged = rows.some(row => row.result.scale > 1.05);
    setStatus(clipped ? '构图已放大或偏移，请检查主体是否被裁切。' : enlarged ? '输出放大超过 5%，请检查清晰度；建议使用更高分辨率原图。' : `已生成 ${rows.length} 款待确认样稿，请检查四角补边与主体。`);
  } catch (error) { if (token === revision) { rows=[];$('#review-grid').replaceChildren();disableExports(true);setStatus(error.message,true); } }
}
function schedule() {
  revision++; clearTimeout(timer); disableExports(true); updateControls(); const token = revision;
  timer = setTimeout(() => process(token),100);
}
async function loadSamples() {
  $('#samples').disabled = true;
  try {
    for (const id of sampleIds) {
      if (entries.some(entry => entry.id === id)) continue;
      const item = catalog.items.find(item => item.id === id && item.style === 'apple');
      if (!item) throw Error('样稿缺少 ' + id);
      entries.push({id,name:item.name,item,sources:new Map(),preview:'../'+item.variants.find(v=>v.shape==='rectangle').thumbnail.path});
    }
    if (!selected) selected=entries[0].id; sourceList(); schedule();
  } catch (error) { setStatus(error.message,true); } finally { $('#samples').disabled=false; }
}
function download(blob, filename) {
  const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function dataURL(bytes) { let binary=''; for (let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192)); return 'data:image/png;base64,'+btoa(binary); }
async function exportRows(selectedRows) {
  const files=[], report={version:1,tool:'quiettv-crop-1',status:'candidate',items:[]}, htmlRows=[];
  for (const row of selectedRows) {
    const image=new Uint8Array(await (await png(row.result.image)).arrayBuffer()), thumbnail=new Uint8Array(await (await png(row.result.thumbnail)).arrayBuffer());
    const name=row.id+'-'+row.settings.shape, before=new Uint8Array(await row.source.blob.arrayBuffer()), beforeName='before/'+row.id+(row.source.blob.type==='image/png'?'.png':row.source.blob.type==='image/jpeg'?'.jpg':'.webp');
    const imageName='icons/'+name+'.png', thumbName='thumbnails/'+name+'.png';
    files.push({name:beforeName,bytes:before},{name:imageName,bytes:image},{name:thumbName,bytes:thumbnail});
    report.items.push({id:row.id,name:row.name,settings:row.settings,source:{path:row.source.path,sha256:row.source.sha256,width:row.before.width,height:row.before.height},sourceBounds:row.result.box,renderScale:row.result.scale,cropped:row.result.cropped,image:{path:imageName,width:row.result.image.width,height:row.result.image.height,bytes:image.length,sha256:await sha256(image)},thumbnail:{path:thumbName,width:row.result.thumbnail.width,height:row.result.thumbnail.height,bytes:thumbnail.length,sha256:await sha256(thumbnail)}});
    const beforeCanvas=canvas(row.before.width,row.before.height);ctx(beforeCanvas).drawImage(row.before,0,0);
    htmlRows.push(`<article><h2>${row.name.replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';')}</h2><div class="pair"><figure><img src="${beforeCanvas.toDataURL()}" alt="处理前"><figcaption>处理前</figcaption></figure><figure><img src="${dataURL(image)}" alt="处理后"><figcaption>处理后</figcaption></figure></div></article>`);
  }
  for (const theme of ['dark','light']) files.push({name:'comparison-'+theme+'.png',bytes:new Uint8Array(await (await png(contactSheet(selectedRows,theme))).arrayBuffer())});
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quiet TV 裁剪样稿对比</title><style>body{margin:0;background:#101216;color:#eee;font:16px/1.6 "PingFang SC",sans-serif}main{max-width:1450px;margin:auto;padding:32px}h1{font-size:30px}p{color:#a4b3c3}button{font:inherit;padding:10px 16px;cursor:pointer}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:24px}article{padding:20px;border:1px solid #687382}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;text-align:center}img{width:100%;height:200px;object-fit:contain}figcaption{font-size:14px;margin-top:8px}body.light{background:#edf0f4;color:#172330}body.light p{color:#536474}</style><main><h1>Quiet TV 图标裁剪样稿</h1><p>处理前 / 处理后  等比展示  待确认，未更新线上图库</p><button onclick="document.body.classList.toggle(\'light\')">切换深浅背景</button><section>'+htmlRows.join('')+'</section></main></html>';
  files.push({name:'review.html',bytes:encoder.encode(html)},{name:'crop-report.json',bytes:encoder.encode(JSON.stringify(report,null,2)+'\n')});
  download(zip(files),selectedRows.length===1?'QuietTV-'+selectedRows[0].id+'-裁剪样稿.zip':'QuietTV-图标裁剪对比.zip');
}

$('#settings').addEventListener('submit',event=>event.preventDefault());
$('#settings').addEventListener('input',event=>{
  const id=event.target.id, rectangle=$('#shape').value==='rectangle';
  if (id==='shape') defaults();
  if (id==='width' && event.target.validity.valid) $('#height').value=Math.round(Number(event.target.value)*(rectangle?9/16:1));
  if (id==='height' && event.target.validity.valid) $('#width').value=Math.round(Number(event.target.value)*(rectangle?16/9:1));
  if (id==='width'||id==='height') { const maximum=Math.min(Number($('#width').value),Number($('#height').value))/2;$('#radius').value=Math.min(Number($('#radius').value),maximum); }
  schedule();
});
$('#reset').addEventListener('click',()=>{defaults();schedule();});
$('#samples').addEventListener('click',loadSamples);
document.querySelectorAll('button[data-theme]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('button[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  $('.comparison').dataset.theme=button.dataset.theme;$('#review-grid').dataset.theme=button.dataset.theme;
}));
$('#files').addEventListener('change',async event=>{
  const added=[];
  try {
    for (const file of event.target.files) {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>32*1024*1024) throw Error('支持不超过 32 MiB 的 PNG、JPEG、WebP');
      const image=await decode(file);if (Math.max(image.width,image.height)>4096||Math.min(image.width,image.height)<16) throw Error('原图宽高须在 16–4096 px 之间');
      const probe=canvas(image.width,image.height);ctx(probe).drawImage(image,0,0);bounds(ctx(probe).getImageData(0,0,probe.width,probe.height).data,probe.width,probe.height,1);
      const id='upload-'+(++uploadId), source={image,blob:file,path:file.name,sha256:await sha256(await file.arrayBuffer()),prepared:new Map()};
      added.push({id,name:file.name.replace(/\.[^.]+$/,''),sources:new Map([['upload',source]]),preview:URL.createObjectURL(file)});
    }
    entries.push(...added); if (added.length) selected=added[0].id;sourceList();schedule();
  } catch(error) { added.forEach(entry=>URL.revokeObjectURL(entry.preview));setStatus(error.message,true); }
  finally { event.target.value=''; }
});
for (const [id,select] of [['download-current',()=>rows.filter(row=>row.id===selected)],['download-review',()=>rows]]) $('#'+id).addEventListener('click',async()=>{
  const token=revision;disableExports(true);try { await exportRows(select());if(token===revision)setStatus('样稿已导出，原图与线上图库保持原样。'); } catch(error) {if(token===revision)setStatus(error.message,true);} finally {if(token===revision)disableExports(!rows.length);}
});
try {
  const response=await fetch('design/baselines.json');if(!response.ok)throw Error('无法读取轮廓配置');const profile=await response.json();
  for(const [shape,roles] of Object.entries(profile.templates)) for(const [role,asset] of Object.entries(roles)) {
    const response=await fetch('../'+asset.path);if(!response.ok)throw Error('无法读取轮廓模板');const blob=await response.blob();
    if(await sha256(await blob.arrayBuffer())!==asset.sha256)throw Error('轮廓模板校验失败');templates.set(shape+'-'+role,await decode(blob));
  }
  const responseCatalog=await fetch('../catalog.json');if(!responseCatalog.ok)throw Error('无法读取现有图库');catalog=await responseCatalog.json();
  await loadSamples();
} catch(error) {setStatus(error.message,true);$('#samples').disabled=true;}
