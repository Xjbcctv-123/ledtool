// calc.js - 全局状态 + 所有计算逻辑 + 数据管理
// 此文件由 split_script.py 自动生成

// ====================================================
//  全局常量（替换魔法数字）
// ====================================================
const CONST = {
  // 电源降额 & 冗余
  PSU_DERATE: 0.8,         // 电源降额系数 80%（行业默认）
  PSU_MIN_CAPACITY: 1.5,   // 最小截面积 mm²（电缆起步规格）
  REDUNDANCY_DEFAULT: 1,    // 默认备份数量

  // 功耗估算
  POWER_AVG_RATIO: 0.6,     // 平均功耗/最大功耗 ≈ 60%（典型值）
  POWER_MARGIN: 1.25,      // 电力系统预留容量倍数

  // 电压 & 压降
  VOLT_SINGLE: 220,         // 单相电压 V
  VOLT_THREE: 380,          // 三相电压 V
  VOLT_DROP_RATIO: 0.05,    // 国标允许压降 5%
  VOLT_DROP_SINGLE: 11,     // 单相允许压降 V
  VOLT_DROP_THREE: 19,      // 三相允许压降 V

  // 接收卡冗余系数（用于估算实际带载能力）
  RECEIVER_RESERVE_RATIO: 0.75,  // 实际带载 ≈ 接收卡像素 × 0.75

  // 电缆参数
  RHO_COPPER: 0.0175,      // 铜导线电阻率 Ω·mm²/m
  RHO_ALUMINUM: 0.028,     // 铝导线电阻率 Ω·mm²/m

  // 默认值
  MOD_POWER_DEFAULT: 45,   // 默认单模组功耗 W
  MOD_PIXEL_W: 32,         // 默认模组像素宽
  MOD_PIXEL_H: 16,         // 默认模组像素高
  PSU_RATED_DEFAULT: 200,  // 默认电源额定功率 W
  BRANCH_CURRENT_DEFAULT: 20,  // 默认分支电流 A
  CABLE_LEN_DEFAULT: 20,   // 默认电缆长度 m
  PORTS_DEFAULT: 4,          // 默认网口数
  RECV_CAP_W: 512,         // 默认接收卡像素宽
  RECV_CAP_H: 512,         // 默认接收卡像素高
};

// ====================================================
//  国际化轻量翻译函数
// ====================================================
const _L = (translations) => {
  const lang = document.documentElement.lang;
  return translations[lang] || translations['en'] || Object.values(translations)[0];
};

const G = {
  // 硬件
  pixels_w: 0, pixels_h: 0, total_pixels: 0,
  screen_area: 0, pitch: CONST.MOD_PIXEL_W,
  box_x: 0, box_y: 0, total_boxes: 0,
  total_modules: 0,
  senders: 0, receivers: 0,
  mod_pixel_w: CONST.MOD_PIXEL_W, mod_pixel_h: CONST.MOD_PIXEL_H, mod_power: CONST.MOD_POWER_DEFAULT,
  // 电力
  max_power_total: 0, avg_power_total: 0,
  psu_count: 0, psu_rated: CONST.PSU_RATED_DEFAULT,
  min_cable_mm: 0,
  // 辅助
  heat_watts: 0, fans: 0,
  amp_power: 0, speakers: 0,
};

// ====================================================
//  Tab切换（用 data-tab 属性定位按钮，不依赖 event）
// ====================================================
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  // 用 data-tab 属性精确匹配当前 tab 按钮
  const activeBtn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if(name === 'bom') generateBOM();
  if(name === 'report') genReport();
}

// ====================================================
//  工具函数
// ====================================================
function vt(id) { return parseFloat(document.getElementById(id)?.value) || 0; }
function vs(id) { return document.getElementById(id)?.value || ''; }
function ceil(v, step) { return Math.ceil(v / step) * step; }
function resultItem(label, value, unit='', cls='') {
  return `<div class="result-item ${cls}">
    <div class="result-label">${label}</div>
    <div class="result-value ${cls}">${value}<span class="result-unit">${unit}</span></div>
  </div>`;
}
function tag(text, cls='tag-blue') { return `<span class="tag ${cls}">${text}</span>`; }

function getPitch() {
  const val = vs('h_pitch');
  return val ? parseFloat(val) : 0;
}


// ====== 是否有箱体 单选逻辑 ======
// 从 DBM 动态加载箱体数据到下拉列表
function _populateBoxSelect() {
  const sel = document.getElementById('box_preset_select');
  if(!sel) return;
  const cabinets = DBM.getCabinets();
  // 按分类分组
  const groups = {};
  cabinets.forEach(c => {
    const g = c.category || 'Other';
    if(!groups[g]) groups[g] = [];
    groups[g].push(c);
  });
  let html = '<option value="">-- Select Cabinet --</option>';
  const groupKeys = Object.keys(groups).sort();
  if (groupKeys.length === 0) {
    html += `<option value="" disabled>⚠️ ${_L({ 'zh-CN': "暂无箱体数据，请先添加箱体。", 'en': "No cabinet data. Please add a cabinet first." })}</option>`;
  } else {
    groupKeys.forEach(g => {
      html += `<optgroup label="${g}">`;
      groups[g].forEach(c => {
        html += `<option value="${c.id}">${c.name}（${c.width_mm}×${c.height_mm}mm）</option>`;
      });
      html += '</optgroup>';
    });
  }
  sel.innerHTML = html;
}

// ====== Pitch 下拉：关联模组库 ======
function _populatePitchSelect() {
  const sel = document.getElementById('h_pitch');
  if(!sel) return;
  const modules = DBM.getModules();
  let html = '<option value="">-- Select from Module Library --</option>';
  let sorted = [];

  if(modules.length === 0) {
    html += `<option value="" disabled selected>⚠️ ${_L({ 'zh-CN': "暂无模组数据，请先添加模组。", 'en': "No module data. Please add a module first." })}</option>`;
  } else {
    sorted = [...modules].sort((a,b) => {
      const pa = a.pixelW > 0 ? +(a.width_mm / a.pixelW).toFixed(3) : 0;
      const pb = b.pixelW > 0 ? +(b.width_mm / b.pixelW).toFixed(3) : 0;
      return pb - pa;
    });
    sorted.forEach(m => {
      const pitch = m.pixelW > 0 ? +(m.width_mm / m.pixelW).toFixed(3) : 0;
      const label = `${m.name} (${m.width_mm}×${m.height_mm}mm)`;
      html += `<option value="${pitch}" data-mod-w="${m.pixelW}" data-mod-h="${m.pixelH}" data-name="${m.name}" data-mod-phys-w="${m.width_mm}" data-mod-phys-h="${m.height_mm}" data-power="${m.power||10}">${label}</option>`;
    });
  }

  sel.innerHTML = html;
  if(sorted.length > 0) {
    const first = sorted[0];
    const pitch = first.pixelW > 0 ? +(first.width_mm / first.pixelW).toFixed(3) : 0;
    for(const opt of sel.options) {
      if(opt.value === String(pitch)) { sel.value = pitch; break; }
    }
  }
  // 触发一次 onPitchChange 以正确初始化模块尺寸和提示
  onPitchChange();
}

// 选中模组后自动填充模组像素尺寸
function onPitchChange() {
  const sel = document.getElementById('h_pitch');
  const val = sel.value;
  const noteGroup = document.getElementById('pitch_from_module_note');

  if(!val) {
    noteGroup.style.display = 'none';
    // 无模组时，箱体下拉恢复显示全部
    if (document.getElementById('has_box_yes').checked) {
      _populateBoxSelect();
    }
    return;
  }

  const opt = sel.options[sel.selectedIndex];
  const modW = parseInt(opt.dataset.modW);
  const modH = parseInt(opt.dataset.modH);
  const modPhysW = parseInt(opt.dataset.modPhysW);
  const modPhysH = parseInt(opt.dataset.modPhysH);
  const modName = opt.dataset.name || '';
  const modPower = parseFloat(opt.dataset.power) || 10; // 单模组功耗(W)
  document.getElementById('h_mod_w').value = modW || 32;
  document.getElementById('h_mod_h').value = modH || 16;
  // 同步存储模组像素尺寸、物理尺寸和功耗，供 calcHardware 和 calcPower 使用
  G.mod_pixel_w = modW || 0;
  G.mod_pixel_h = modH || 0;
  G.mod_power = modPower; // 单模组功耗(W)
  if(modName) {
    document.getElementById('pitch_module_note').textContent = _L({ 'zh-CN': `已自动填充模组"${modName}"，像素尺寸 ${modW}×${modH}px，功耗 ${modPower}W`, 'en': `Auto-filled module "${modName}" pixel size ${modW}×${modH}px, power ${modPower}W` });
    noteGroup.style.display = 'flex';
  } else {
    noteGroup.style.display = 'none';
  }
  // 如果当前已勾选"有箱体"，同步刷新箱体下拉（按模组过滤）
  if (document.getElementById('has_box_yes').checked) {
    _populateBoxSelect(); // 箱体不再按模组过滤，兼容性由计算时判定
  }
  calcHardware();
  calcPower(); // 功耗计算依赖模组功耗
}

function onBoxRadioChange() {
  const isYes = document.getElementById('has_box_yes').checked;
  const group = document.getElementById('box_preset_group');
  const boxSelect = document.getElementById('box_preset_select');
  const boxMw = document.getElementById('h_box_mw');
  const boxMh = document.getElementById('h_box_mh');
  const recvConfigGroup = document.getElementById('recv_config_group');
  const recvLoadContent = document.getElementById('recv_load_content');
  const recvPerboxContent = document.getElementById('recv_perbox_content');
  const recvConfigLabel = document.getElementById('recv_config_label');
  group.style.display = isYes ? 'flex' : 'none';
  if (recvConfigGroup) {
    recvConfigGroup.style.display = 'flex';
    if (isYes) {
      recvConfigLabel.textContent = _L({'zh-CN':'每箱接收卡数','en':'Receivers per Cabinet'});
      recvLoadContent.style.display = 'none';
      recvPerboxContent.style.display = 'block';
    } else {
      recvConfigLabel.textContent = _L({'zh-CN':'每卡带载像素 (宽×高)','en':'Load per Card (W×H)'});
      recvLoadContent.style.display = 'block';
      recvPerboxContent.style.display = 'none';
    }
  }
  if (!isYes) {
    boxSelect.value = '';
    delete boxSelect.dataset.boxW;
    delete boxSelect.dataset.boxH;
    // 选"否"时，箱体横向/纵向模组数输入框显示为0（保存原值以便恢复）
    if (boxMw) {
      boxMw.dataset.saved = boxMw.value;
      boxMw.value = 0;
    }
    if (boxMh) {
      boxMh.dataset.saved = boxMh.value;
      boxMh.value = 0;
    }
  } else {
    // 从 pitch 下拉的当前选中 option 获取模组像素尺寸，过滤箱体列表
    const pitchSel = document.getElementById('h_pitch');
    const selOpt = pitchSel?.selectedOptions?.[0];
    const modW = selOpt?.dataset?.modW ? parseInt(selOpt.dataset.modW) : null;
    const modH = selOpt?.dataset?.modH ? parseInt(selOpt.dataset.modH) : null;
    _populateBoxSelect(); // 箱体不再按模组过滤
    // 选"是"时恢复箱体模组数
    if (boxMw && boxMw.dataset.saved) { boxMw.value = boxMw.dataset.saved; delete boxMw.dataset.saved; }
    if (boxMh && boxMh.dataset.saved) { boxMh.value = boxMh.dataset.saved; delete boxMh.dataset.saved; }
  }
  calcHardware();
}

function applyBoxPreset() {
  const id = document.getElementById('box_preset_select').value;
  const cabinets = DBM.getCabinets();
  const c = cabinets.find(x => x.id === id);
  if(!c) return;
  // 获取当前选中的模组物理尺寸（由间距选择确定）
  const pitchSel = document.getElementById('h_pitch');
  const selOpt = pitchSel?.selectedOptions?.[0];
  const modPhysW = selOpt?.dataset?.modPhysW ? parseInt(selOpt.dataset.modPhysW) : null;
  const modPhysH = selOpt?.dataset?.modPhysH ? parseInt(selOpt.dataset.modPhysH) : null;
  const modPixelW = selOpt?.dataset?.modW ? parseInt(selOpt.dataset.modW) : null;
  const modPixelH = selOpt?.dataset?.modH ? parseInt(selOpt.dataset.modH) : null;
  // 计算模组排列：箱体物理尺寸 ÷ 模组物理尺寸
  if (modPhysW && modPhysH) {
    const boxMw = Math.floor(c.width_mm / modPhysW);
    const boxMh = Math.floor(c.height_mm / modPhysH);
    document.getElementById('h_box_mw').value = boxMw;
    document.getElementById('h_box_mh').value = boxMh;
    // 显示模组与箱体匹配状态
    const fitEl = document.getElementById('box_fit_status');
    const fitW = c.width_mm % modPhysW === 0;
    const fitH = c.height_mm % modPhysH === 0;
    if (fitW && fitH) {
      fitEl.innerHTML = `✅ ${_L({ 'zh-CN': '匹配', 'en': 'Match' })}`;
      fitEl.style.color = '#2E7D32';
    } else {
      fitEl.innerHTML = `⚠️ ${_L({ 'zh-CN': '模组/箱体不匹配', 'en': 'Module/Cabinet mismatch' })}`;
      fitEl.style.color = '#E65100';
    }
  } else {
    document.getElementById('box_fit_status').innerHTML = '';
  }
  if (modPixelW && modPixelH) {
    document.getElementById('h_mod_w').value = modPixelW;
    document.getElementById('h_mod_h').value = modPixelH;
  }
  // 保存箱体物理尺寸供计算使用
  document.getElementById('box_preset_select').dataset.boxW = c.width_mm;
  document.getElementById('box_preset_select').dataset.boxH = c.height_mm;
  calcHardware();
}

// ====== 控制系统下拉动态加载 ======
// 发送卡 → 控制系统库（类型=发送设备）
// 接收卡 → 接收卡库（独立库）
function _populateCtrlSelects() {
  const controls = DBM.getControls();
  const recvCards = DBM.getRecvCards();

  const senderSel = document.getElementById('h_sender_type');
  const recvSel   = document.getElementById('h_recv_type');
  if(!senderSel || !recvSel) return;

  // 发送卡下拉 → 控制系统库（发送设备 + 视频处理器）
  // 显示：名称 (带载能力万px)
  const senders = controls.filter(c =>
    c.type === '发送设备' || c.type === 'sender' ||
    c.type === '视频处理器' || c.type === 'vprocessor' ||
    c.type === '异步卡' || c.type === '播放盒' || c.type === '同异步播放盒'
  );
  let senderHtml = '<option value="">-- Select Sender --</option>';
  senders.forEach(s => {
    const cap = s.capacityUnit === 'px'
      ? `${s.capacity}px`
      : `${s.capacity}万px`;
    senderHtml += `<option value="${s.id}">${s.name}（${cap}）</option>`;
  });
  senderHtml += '<option value="__custom__">Custom Sender</option>';
  senderSel.innerHTML = senderHtml;

  // 接收卡下拉 → 接收卡库
  // 显示：名称 (分辨率宽×高px)
  let recvHtml = '<option value="">-- Select Receiver --</option>';
  recvCards.forEach(r => {
    recvHtml += `<option value="${r.id}">${r.name}（${r.capW||0}×${r.capH||0}px）</option>`;
  });
  recvHtml += '<option value="__custom__">Custom Receiver</option>';
  recvSel.innerHTML = recvHtml;
}

// ====== 视频处理器下拉动态加载 ======
function _populateVProcessorSelect() {
  const sel = document.getElementById('h_vprocessor_type');
  if(!sel) return;
  const vprocessors = DBM.getVProcessors();
  let html = '<option value="">-- Select Video Processor --</option>';
  vprocessors.forEach(v => {
    html += `<option value="${v.id}">${v.name} (${v.resW||'-'}×${v.resH||'-'}, ${v.type})</option>`;
  });
  html += '<option value="__custom__">Custom Processor</option>';
  sel.innerHTML = html;
}

// ====== 电源下拉动态加载 ======
function _populatePSUSelect() {
  const sel = document.getElementById('p_psu_rated');
  if(!sel) return;
  const psus = DBM.getPSUs();
  let html = '';
  psus.forEach(p => { html += `<option value="${p.id}">${p.name}</option>`; });
  html += '<option value="__custom__">Custom Power</option>';
  sel.innerHTML = html;
}

// 从DB获取当前PSU参数
function _getPSUParams(id) {
  const p = DBM.getPSUs().find(p => p.id === id);
  return p ? { ratedW: p.ratedW, outputV: p.outputV } : null;
}

// 发送卡带载能力（从DB读取，支持发送设备和视频处理器）
function _getSenderCap(id) {
  const ctrl = DBM.getControls().find(c => c.id === id && (
    c.type === '发送设备' || c.type === 'sender' || 
    c.type === '视频处理器' || c.type === 'vprocessor' ||
    c.type === '异步卡' || c.type === '播放盒' || c.type === '同异步播放盒'
  ));
  return ctrl ? ctrl.capacity * 10000 : null; // 万px → px
}
// 发送卡网口数（从DB读取，支持发送设备和视频处理器）
function _getSenderPorts(id) {
  const ctrl = DBM.getControls().find(c => c.id === id && (
    c.type === '发送设备' || c.type === 'sender' || 
    c.type === '视频处理器' || c.type === 'vprocessor' ||
    c.type === '异步卡' || c.type === '播放盒' || c.type === '同异步播放盒'
  ));
  return ctrl && ctrl.ports ? ctrl.ports : CONST.PORTS_DEFAULT; // 默认网口数
}
// 接收卡带模组数（从接收卡库读取）
// 公式：接收卡像素 × 0.75 ÷ 模组像素 = 一张卡能带的模组数
function _getRecvCap(id) {
  if (!id || id === '__custom__') return null;
  const card = DBM.getRecvCards().find(r => r.id === id);
  if (!card) return null;
  // 接收卡分辨率（宽×高）
  const recvCapW = card.capW || CONST.RECV_CAP_W;
  const recvCapH = card.capH || CONST.RECV_CAP_H;
  // 接收卡总像素 = 宽 × 高
  const recvTotalPx = recvCapW * recvCapH;
  // 模组像素尺寸
  const modW = G.mod_pixel_w || CONST.MOD_PIXEL_W;
  const modH = G.mod_pixel_h || CONST.MOD_PIXEL_H;
  const modPx = modW * modH; // 单模组总像素
  // 一张卡能带的模组数 = 接收卡像素 × 冗余系数 ÷ 单模组像素
  return Math.floor((recvTotalPx * CONST.RECEIVER_RESERVE_RATIO) / modPx);
}

// ====================================================
//  硬件计算
// ====================================================
function calcHardware() {
  const W = vt('h_width'), H = vt('h_height');
  const pitch = getPitch();
  if(!W || !H || !pitch) return;

  G.pitch = pitch;

  // 检查是否选择了箱体，根据箱体或模组尺寸计算实际屏体尺寸（取整）
  const boxSelect = document.getElementById('box_preset_select');
  const hasBox = document.getElementById('has_box_yes').checked;
  const boxW = boxSelect?.dataset?.boxW ? parseInt(boxSelect.dataset.boxW) : null;
  const boxH = boxSelect?.dataset?.boxH ? parseInt(boxSelect.dataset.boxH) : null;
  // 无箱体时读取当前模组的物理尺寸
  const pitchSel = document.getElementById('h_pitch');
  const modPhysW = pitchSel?.dataset?.modPhysW ? parseInt(pitchSel.dataset.modPhysW) : null;
  const modPhysH = pitchSel?.dataset?.modPhysH ? parseInt(pitchSel.dataset.modPhysH) : null;

  // 屏体实际尺寸
  let actualW, actualH;
  if(hasBox && boxW) {
    actualW = Math.floor(W / boxW) * boxW;
    actualH = Math.floor(H / boxH) * boxH;
  } else if(modPhysW && modPhysH) {
    actualW = Math.floor(W / modPhysW) * modPhysW;
    actualH = Math.floor(H / modPhysH) * modPhysH;
  } else {
    actualW = W;
    actualH = H;
  }

  // 像素分辨率
  const px_w = Math.round(actualW / pitch);
  const px_h = Math.round(actualH / pitch);
  const total = px_w * px_h;
  G.pixels_w = px_w; G.pixels_h = px_h; G.total_pixels = total;
  G.screen_area = (actualW / 1000) * (actualH / 1000);

  // 宽高比
  const gcd = (a, b) => b ? gcd(b, a%b) : a;
  const g = gcd(px_w, px_h);
  const ratio = `${px_w/g}:${px_h/g}`;

  document.getElementById('hw_pixel_grid').innerHTML =
    resultItem(_L({ 'zh-CN': '实际宽度', 'en': 'Actual Width' }), (actualW/1000).toFixed(2), 'm') +
    resultItem(_L({ 'zh-CN': '实际高度', 'en': 'Actual Height' }), (actualH/1000).toFixed(2), 'm') +
    resultItem(_L({ 'zh-CN': '像素间距', 'en': 'Pixel Pitch' }), pitch, 'mm', 'accent') +
    resultItem(_L({ 'zh-CN': '水平分辨率', 'en': 'H-Resolution' }), px_w.toLocaleString(), 'px', 'accent') +
    resultItem(_L({ 'zh-CN': '垂直分辨率', 'en': 'V-Resolution' }), px_h.toLocaleString(), 'px', 'accent') +
    resultItem(_L({ 'zh-CN': '总像素', 'en': 'Total Pixels' }), (total/10000).toFixed(1), '万px') +
    resultItem(_L({ 'zh-CN': '屏幕面积', 'en': 'Screen Area' }), G.screen_area.toFixed(2), 'm²') +
    resultItem(_L({ 'zh-CN': '宽高比', 'en': 'Aspect Ratio' }), ratio, '', 'success');

  const scene = vs('h_scene');
  const nits = {indoor:'800~2000', outdoor:'5000~10000', stage:'500~1500', traffic:'3000~8000'}[scene];
  let adjustNote = '';
  if(hasBox && boxW && (actualW !== W || actualH !== H)) {
    adjustNote = `<div style="margin-top:4px">⚠️ ${_L({ 'zh-CN': '根据箱体尺寸调整为', 'en': 'Adjusted to' })} <b>${actualW}×${actualH}mm</b> ${_L({ 'zh-CN': '(输入值为', 'en': '(input was' })} ${W}×${H}mm)</div>`;
  } else if(!hasBox && modPhysW && (actualW !== W || actualH !== H)) {
    adjustNote = `<div style="margin-top:4px">⚠️ ${_L({ 'zh-CN': '根据模组尺寸调整为', 'en': 'Adjusted to' })} <b>${actualW}×${actualH}mm</b> ${_L({ 'zh-CN': '(输入值为', 'en': '(input was' })} ${W}×${H}mm)</div>`;
  }
  const sceneLabelMap = {indoor:{ 'zh-CN':'室内', 'en':'Indoor' }, outdoor:{ 'zh-CN':'室外', 'en':'Outdoor' }, stage:{ 'zh-CN':'舞台', 'en':'Stage' }, traffic:{ 'zh-CN':'交通', 'en':'Traffic' }};
  const sceneLabel = _L(sceneLabelMap[scene] || { 'zh-CN': scene, 'en': scene });
  document.getElementById('hw_pixel_note').innerHTML =
    `<div>ℹ️ ${_L({ 'zh-CN': '像素间距', 'en': 'Pixel pitch' })} <b>P${pitch}mm</b>，${_L({ 'zh-CN': '分辨率', 'en': 'resolution' })} <b>${px_w}×${px_h}</b>，${_L({ 'zh-CN': '宽高比约', 'en': 'aspect ratio approx' })} <b>${ratio}</b></div>` +
    `<div>${_L({ 'zh-CN': '屏幕类型', 'en': 'Screen type' })}：<b>${sceneLabel}</b>，${_L({ 'zh-CN': '推荐亮度', 'en': 'recommended brightness' })} <b>${nits} nits</b></div>` +
    adjustNote;

  // 模组/箱体
  const mod_w = vt('h_mod_w') || 32, mod_h = vt('h_mod_h') || 16;
  let box_mw = vt('h_box_mw') || 0, box_mh = vt('h_box_mh') || 0;
  // 无箱体时箱体相关结果全部归零
  if (!hasBox) {
    box_mw = 0;
    box_mh = 0;
  }
  G.mod_pixel_w = mod_w; G.mod_pixel_h = mod_h;

  let box_px_w, box_px_h, box_x, box_y, total_boxes, total_modules, box_w_mm, box_h_mm;
  if (box_mw > 0 && box_mh > 0) {
    box_px_w = mod_w * box_mw;
    box_px_h = mod_h * box_mh;
    box_x = Math.ceil(px_w / box_px_w);
    box_y = Math.ceil(px_h / box_px_h);
    total_boxes = box_x * box_y;
    total_modules = total_boxes * box_mw * box_mh;
    box_w_mm = box_px_w * pitch;
    box_h_mm = box_px_h * pitch;
  } else {
    box_px_w = 0; box_px_h = 0;
    box_x = 0; box_y = 0;
    total_boxes = 0;
    box_w_mm = 0; box_h_mm = 0;
    // 无箱体时，模组总数计算：
    // 优先用物理尺寸（更精确），否则用像素分辨率/模组像素数（始终可算）
    if (modPhysW && modPhysH) {
      const modCntX = Math.floor(actualW / modPhysW);
      const modCntY = Math.floor(actualH / modPhysH);
      total_modules = modCntX * modCntY;
    } else {
      // 按像素格计算：屏体分辨率 ÷ 单模组像素数
      total_modules = Math.ceil(px_w / mod_w) * Math.ceil(px_h / mod_h);
    }
  }

  document.getElementById('hw_box_grid').innerHTML =
    resultItem(_L({'zh-CN':'模组像素尺寸','en':'Module Pixel Size'}), `${mod_w}×${mod_h}`, 'px') +
    resultItem(_L({'zh-CN':'箱体像素尺寸','en':'Cabinet Pixel Size'}), `${box_px_w}×${box_px_h}`, 'px') +
    resultItem(_L({'zh-CN':'箱体物理尺寸','en':'Cabinet Physical Size'}), `${box_w_mm}×${box_h_mm}`, 'mm') +
    resultItem(_L({'zh-CN':'箱体数量(横)','en':'Cabinets (H)'}), box_x, 'pcs', 'accent') +
    resultItem(_L({'zh-CN':'箱体数量(纵)','en':'Cabinets (V)'}), box_y, 'pcs', 'accent') +
    resultItem(_L({'zh-CN':'箱体总数','en':'Total Cabinets'}), total_boxes, 'pcs', 'accent') +
    resultItem(_L({'zh-CN':'模组总数','en':'Total Modules'}), total_modules, 'pcs', 'success');

  // 同步全局状态 & 电力配电输入框
  G.total_modules = total_modules;
  G.total_boxes = total_boxes;
  const pwModulesEl = document.getElementById('pw_total_modules');
  const pwModPowerEl = document.getElementById('pw_mod_power_input');
  if (pwModulesEl && total_modules > 0) {
    pwModulesEl.value = total_modules;
    G._syncModName = document.getElementById('h_pitch')?.selectedOptions[0]?.dataset?.name || 'Selected module';
  }
  if (pwModPowerEl && G.mod_power > 0) {
    pwModPowerEl.value = G.mod_power;
  }
  // 同步箱体总数到电力配电
  const pwTotalBoxesEl = document.getElementById('pw_total_boxes');
  if (pwTotalBoxesEl) {
    pwTotalBoxesEl.value = total_boxes;
  }

  // 无箱体时提示，有箱体时显示精确度检查
  if (!hasBox || box_mw === 0 || box_mh === 0) {
    document.getElementById('hw_box_note').innerHTML = `<div class="alert" style="background:#F5F5F5;border:1px solid #E0E0E0;color:#757575">ℹ️ ${_L({ 'zh-CN': "未选择箱体，屏幕直接由模组拼装。", 'en': "No cabinet selected. Screen is assembled directly from modules." })}</div>`;
  } else {
    // 检查模组与箱体物理尺寸是否匹配
    const boxSelect = document.getElementById('box_preset_select');
    const boxW = boxSelect?.dataset?.boxW ? parseInt(boxSelect.dataset.boxW) : null;
    const boxH = boxSelect?.dataset?.boxH ? parseInt(boxSelect.dataset.boxH) : null;
    const pitchSel = document.getElementById('h_pitch');
    const selOpt = pitchSel?.selectedOptions?.[0];
    const modPhysW = selOpt?.dataset?.modPhysW ? parseInt(selOpt.dataset.modPhysW) : null;
    const modPhysH = selOpt?.dataset?.modPhysH ? parseInt(selOpt.dataset.modPhysH) : null;
    let modFitNote = '';
    if (boxW && boxH && modPhysW && modPhysH) {
      const fitW = boxW % modPhysW === 0;
      const fitH = boxH % modPhysH === 0;
      if (!fitW || !fitH) {
        modFitNote = `<div class="alert alert-warn">⚠️ ${_L({ 'zh-CN': "注意：模组", 'en': "Note: Module" })} (${modPhysW}×${modPhysH}mm) ${_L({ 'zh-CN': "与箱体", 'en': "and cabinet" })} (${boxW}×${boxH}mm) ${_L({ 'zh-CN': "不匹配", 'en': "mismatch" })}${!fitW?`，${_L({ 'zh-CN': "宽度余量", 'en': "width remainder" })}：${boxW%modPhysW}mm`:''}${!fitH?`，${_L({ 'zh-CN': "高度余量", 'en': "height remainder" })}：${boxH%modPhysH}mm`:''}。${_L({ 'zh-CN': "请选择匹配的模组或箱体。", 'en': "Please select a matching module or cabinet." })}</div>`;
      } else {
        modFitNote = `<div class="alert alert-success">✅ ${_L({ 'zh-CN': "模组与箱体尺寸匹配", 'en': "Module and cabinet size match" })} (${modPhysW}×${modPhysH}mm → ${boxW/modPhysW}×${boxH/modPhysH} ${_L({ 'zh-CN': "个模组", 'en': "modules" })})。</div>`;
      }
    }
    const warn_w = px_w % box_px_w !== 0;
    const warn_h = px_h % box_px_h !== 0;
    // 像素裁剪提示
    let cropNote = '';
    if (warn_w || warn_h) {
      cropNote = `<div class="alert alert-warn">⚠️ ${_L({ 'zh-CN': "注意：箱体/模组不匹配。", 'en': "Note: Cabinet/module mismatch." })} ${warn_w?_L({ 'zh-CN': "水平", 'en': "Horizontal" }):''}${warn_h?_L({ 'zh-CN': "垂直", 'en': " vertical" }):''}${_L({ 'zh-CN': "像素可能需要裁切。", 'en': " pixel cropping may be required." })}</div>`;
    }
    document.getElementById('hw_box_note').innerHTML = cropNote;
  }
  // 观看距离
  const k1 = vt('h_k1') || 1000, k2 = vt('h_k2') || 3500, k3 = vt('h_k3') || 500;
  const d_best = (pitch * k1 / 1000).toFixed(1);
  const d_far  = (pitch * k2 / 1000).toFixed(1);
  const d_near = (pitch * k3 / 1000).toFixed(1);

  document.getElementById('hw_dist_grid').innerHTML =
    resultItem(_L({'zh-CN':'最近视距','en':'Min Viewing Dist.'}), d_near, 'm') +
    resultItem(_L({'zh-CN':'最佳视距','en':'Optimal Viewing Dist.'}), d_best, 'm', 'accent') +
    resultItem(_L({'zh-CN':'最远视距','en':'Max Viewing Dist.'}), d_far, 'm') +
    resultItem(_L({'zh-CN':'推荐安装高度','en':'Recommended Height'}), (parseFloat(d_best)*0.3).toFixed(1)+'~'+(parseFloat(d_best)*0.5).toFixed(1), 'm', 'success');

  // 控制系统
  const senderType = vs('h_sender_type');
  const senderCapacity = senderType === '__custom__' ? vt('h_sender_cap') * 10000 :
    (_getSenderCap(senderType) || 130 * 10000);

  // 有箱体时提取端口参数（供计算和提示复用）
  const hasBoxAndData = hasBox && total_boxes > 0 && box_px_w > 0 && box_px_h > 0;
  const boxPixels = hasBoxAndData ? box_px_w * box_px_h : 0;
  const ports = hasBoxAndData ? _getSenderPorts(senderType) : 0;

  let senders;
  if (hasBoxAndData) {
    // 发送卡总像素 ÷ 单箱体像素 = 最多可带箱体数（受像素上限约束）
    const maxCabByCapacity = Math.floor(senderCapacity / boxPixels);
    // 单口像素 = 发送卡总带载 ÷ 网口数
    const pixelsPerPort = ports > 0 ? Math.floor(senderCapacity / ports) : 0;
    // 每口可带箱体数 = 单口像素 ÷ 单箱体像素
    const cabsPerPort = pixelsPerPort > 0 && boxPixels > 0 ? Math.floor(pixelsPerPort / boxPixels) : 0;
    // 端口上限 = 每口箱体数 × 网口数
    const maxCabByPort = cabsPerPort * ports;
    // 取 像素上限 和 端口上限 的小值
    const cabinetsPerSender = Math.min(maxCabByCapacity, maxCabByPort);
    senders = Math.ceil(total_boxes / cabinetsPerSender);
  } else {
    senders = Math.ceil(total / senderCapacity);
  }

  // 视频处理器校验：获取选中的处理器发送输出数量
  let vpSendOutputs = 0;
  let vpInfo = '';
  const vpId = vs('h_vprocessor_type');
  if (vpId && vpId !== '__custom__') {
    const vp = DBM.getVProcessors().find(v => v.id === vpId);
    if (vp) {
      vpSendOutputs = vp.sendOutputs || vp.outputCount || 1;
      vpInfo = `（${_L({'zh-CN':'视频处理器','en':'Video processor'})} ${vp.name} ${_L({'zh-CN':'最多输出','en':'max outputs'})} ${vpSendOutputs} ${_L({'zh-CN':'路发送信号','en':'sender signals'})}）`;
    }
  }

  // 重复选型警告：选了控制系统库的"视频处理器"类型（自带发送），又选了视频处理器库的处理器
  const ctrlSelected = vs('h_sender_type');
  let ctrlTypeName = '';
  let isCtrlVpType = false; // 控制系统库选的是视频处理器类型（自带发送）
  if (ctrlSelected && ctrlSelected !== '__custom__') {
    const ctrl = DBM.getControls().find(c => c.id === ctrlSelected);
    if (ctrl) {
      ctrlTypeName = ctrl.name;
      isCtrlVpType = ctrl.type === '视频处理器' || ctrl.type === 'vprocessor';
    }
  }

  const recvType = vs('h_recv_type');
  let receivers;
  if (hasBoxAndData) {
    // 有箱体：箱体数量 × 每箱体接收卡数量
    receivers = total_boxes * vt('h_recv_per_box');
  } else {
    // 无箱体：每卡带载像素 → 每卡能带模组数 → 所需接收卡数
    const recvLoadW = vt('h_recv_load_w') || 128;
    const recvLoadH = vt('h_recv_load_h') || 128;
    const modW = G.mod_pixel_w || 32;
    const modH = G.mod_pixel_h || 16;
    const modulesPerCard = Math.floor(recvLoadW / modW) * Math.floor(recvLoadH / modH);
    // modulesPerCard 可能为 0（模组像素 > 接收卡带载区域），避免除零出 Infinity
    receivers = (total_modules > 0 && modulesPerCard > 0) ? Math.ceil(total_modules / modulesPerCard) : (total_modules > 0 ? total_modules : 0);
  }

  G.senders = senders; G.receivers = receivers;

  // 品牌匹配检查
  let brandWarn = false;
  let senderBrand = '', recvBrand = '';
  const _senderObj = senderType && senderType !== '__custom__' ? DBM.getControls().find(c => c.id === senderType) : null;
  const _recvObj = recvType && recvType !== '__custom__' ? DBM.getRecvCards().find(r => r.id === recvType) : null;
  if (_senderObj && _recvObj) {
    // 取名称前2~4个中文字符作为品牌标识
    const extractBrand = (name) => { const m = name.match(/^([\u4e00-\u9fa5]+)/); return m ? m[1] : ''; };
    senderBrand = extractBrand(_senderObj.name);
    recvBrand = extractBrand(_recvObj.name);
    if (senderBrand && recvBrand && senderBrand !== recvBrand) brandWarn = true;
  }

  document.getElementById('hw_ctrl_grid').innerHTML =
    resultItem(_L({'zh-CN':'发送卡数量','en':'Sender Count'}), senders, 'pcs', 'accent') +
    resultItem(_L({'zh-CN':'接收卡数量','en':'Receiver Count'}), receivers, 'pcs', 'accent') +
    resultItem(_L({'zh-CN':'级联方案','en':'Cascade Scheme'}), senders > 1 ? `1+${senders-1} ${_L({'zh-CN':'级联','en':'Cascade'})}` : _L({'zh-CN':'单卡','en':'Single Card'}), '') +
    resultItem(_L({'zh-CN':'控制电脑','en':'Control PC'}), 1, 'unit');

  // 控制系统的详细提示
  let ctrlDetail = '';
  if (hasBoxAndData) {
    const loadPx = total_boxes * boxPixels;
    const senderCapWan = (senderCapacity / 10000).toFixed(0);
    const maxCabByCapacity = Math.floor(senderCapacity / boxPixels);
    const pixelsPerPort = ports > 0 ? Math.floor(senderCapacity / ports) : 0;
    const cabsPerPort = pixelsPerPort > 0 && boxPixels > 0 ? Math.floor(pixelsPerPort / boxPixels) : 0;
    ctrlDetail = `(${senderCapWan}万px ${_L({ 'zh-CN': "容量", 'en': "capacity" })}, ${ports} ${_L({ 'zh-CN': "端口", 'en': "ports" })}, ${(pixelsPerPort/10000).toFixed(0)}万px/${_L({ 'zh-CN': "端口", 'en': "port" })} ≈ ${cabsPerPort} ${_L({ 'zh-CN': "箱体/端口", 'en': "cabinets/port" })}, ${_L({ 'zh-CN': "最大", 'en': "max" })} ${Math.min(maxCabByCapacity, cabsPerPort*ports)} ${_L({ 'zh-CN': "箱体/卡", 'en': "cabinets/card" })}, ${_L({ 'zh-CN': "总计", 'en': "total" })} ${(loadPx/10000).toFixed(1)}万px)`;
  }

  // 异步卡/播放盒/同异步播放盒 带载检查
  let isAsyncOrBox = false;
  let asyncCapacityWan = 0;
  let asyncName = '';
  if (senderType && senderType !== '__custom__') {
    const sender = DBM.getControls().find(c => c.id === senderType);
    if (sender && (sender.type === '异步卡' || sender.type === '播放盒' || sender.type === '同异步播放盒')) {
      isAsyncOrBox = true;
      asyncCapacityWan = sender.capacity || 0;
      asyncName = sender.name;
    }
  }
  const totalWan = total / 10000;

  const ctrlNote = document.getElementById('hw_ctrl_note');
  if (brandWarn) {
    ctrlNote.style.display = 'flex';
    ctrlNote.className = 'alert alert-warn';
    ctrlNote.innerHTML = `⚠️ ${_L({ 'zh-CN': "发送卡", 'en': "Sender" })} (${senderBrand}) ${_L({ 'zh-CN': "与接收卡", 'en': "and Receiver" })} (${recvBrand}) ${_L({ 'zh-CN': "品牌不同，可能存在兼容性问题。建议同品牌。", 'en': "brands differ — compatibility issue possible. Recommend same brand." })}`;
  } else if (isAsyncOrBox && totalWan > asyncCapacityWan) {
    // 异步卡/播放盒带不动
    ctrlNote.style.display = 'flex';
    ctrlNote.className = 'alert alert-warn';
    ctrlNote.innerHTML = `⚠️ ${asyncName} ${_L({ 'zh-CN': "最大带载", 'en': "max capacity is" })} <b>${asyncCapacityWan}万</b>px，${_L({ 'zh-CN': "当前屏体为", 'en': "but current screen is" })} <b>${totalWan.toFixed(1)}万</b>px — ${_L({ 'zh-CN': "不足。请选择更强力的发送卡。", 'en': "insufficient. Please select a more powerful sender." })}`;
  } else if (isCtrlVpType && vpId && vpId !== '__custom__') {
    // 选了控制系统库的视频处理器类型（自带发送），又选了视频处理器库 → 重复
    ctrlNote.style.display = 'flex';
    ctrlNote.className = 'alert alert-warn';
    ctrlNote.innerHTML = `⚠️ ${_L({ 'zh-CN': "注意：", 'en': "Note: " })}${ctrlTypeName} ${_L({ 'zh-CN': "已内置视频处理，无需额外视频处理器。", 'en': "already has video processing — no need for an additional video processor." })}`;
  } else if (vpId && vpId !== '__custom__' && senders > vpSendOutputs) {
    // 视频处理器发送输出能力不足
    ctrlNote.style.display = 'flex';
    ctrlNote.className = 'alert alert-warn';
    ctrlNote.innerHTML = `⚠️ ${_L({ 'zh-CN': "本项目需要", 'en': "This project needs" })} <b>${senders}</b> ${_L({ 'zh-CN': "张发送卡，但所选视频处理器仅有", 'en': "sender cards, but the selected video processor" })} (${vpSendOutputs} ${_L({ 'zh-CN': "个输出口) 能力不足。请升级处理器或增加设备。", 'en': "outputs) is insufficient. Please upgrade the processor or add more." })}) ${ctrlDetail}`;
  } else if (isAsyncOrBox && vpId && vpId !== '__custom__') {
    // 异步卡/播放盒/同异步播放盒 选了视频处理器 → 提示不兼容
    const vpName = (DBM.getVProcessors().find(v => v.id === vpId) || {}).name || vpId;
    ctrlNote.style.display = 'flex';
    ctrlNote.className = 'alert alert-warn';
    ctrlNote.innerHTML = `⚠️ ${_L({ 'zh-CN': "异步卡不支持视频处理器。请重新配置。", 'en': "Async cards do not support video processors. Please reconfigure." })}`;
  } else {
    ctrlNote.style.display = 'flex';
    if (senders > 1) {
      ctrlNote.className = 'alert alert-warn';
      ctrlNote.innerHTML = `⚠️ ${_L({ 'zh-CN': "本项目需要", 'en': "This project requires" })} <b>${senders}</b> ${_L({ 'zh-CN': "张发送卡", 'en': "sender cards" })} ${ctrlDetail}。${_L({ 'zh-CN': "请设置级联同步以确保多卡帧同步。", 'en': "Please set up cascade sync to ensure multi-card frame synchronization." })}`;
    } else {
      ctrlNote.className = 'alert alert-success';
      const recvLoadW = vt('h_recv_load_w') || 128;
      const recvLoadH = vt('h_recv_load_h') || 128;
      const modW = G.mod_pixel_w || 32;
      const modH = G.mod_pixel_h || 16;
      const modulesPerCard = Math.floor(recvLoadW / modW) * Math.floor(recvLoadH / modH);
      const recvDetail = !hasBoxAndData && total_modules > 0 ? `，${_L({'zh-CN':'单卡带载','en':'load per card'})}：${recvLoadW}×${recvLoadH}px (${modulesPerCard} ${_L({'zh-CN':'个模组','en':'modules'})})` : (hasBoxAndData ? `，${vt('h_recv_per_box')} ${_L({'zh-CN':'张/箱体','en':'card(s)/cabinet'})}` : '');
      const loadStr = ctrlDetail ? `${_L({'zh-CN':'带载','en':'Loaded'})} ${(total/10000).toFixed(1)}万px ${ctrlDetail}` : `${_L({'zh-CN':'带载','en':'Loaded'})} ${(total/10000).toFixed(1)}万px，${_L({'zh-CN':'利用率','en':'utilization'})} ${(total/senderCapacity*100).toFixed(1)}%`;
      ctrlNote.innerHTML = vpInfo ? `✅ ${_L({ 'zh-CN': "单发送卡即可满足。", 'en': "Single sender sufficient." })} ${loadStr}。${vpInfo}${recvDetail}` : `✅ ${_L({ 'zh-CN': "单发送卡即可满足。", 'en': "Single sender sufficient." })} ${loadStr}。${recvDetail}`;
    }
  }
  // 同步箱体总数到电力配电后触发电力计算刷新
  calcPower();
}

// ====================================================
//  电力计算
// ====================================================
function calcPower() {
  const area = G.screen_area || 0;
  // 优先从输入框读取，若输入框为0则尝试用G的值
  const total_modules = vt('pw_total_modules') || 0;
  const total_boxes = vt('pw_total_boxes') || 0;
  const modPower = vt('pw_mod_power_input') || CONST.MOD_POWER_DEFAULT; // 单模组功耗(W)

  // 显示来自硬件配置的同步提示
  const modInfoEl = document.getElementById('pw_module_info');
  const modNameEl = document.getElementById('pw_mod_name');
  if(G._syncModName) {
    modInfoEl.style.display = 'block';
    modNameEl.textContent = G._syncModName;
  } else {
    modInfoEl.style.display = 'none';
  }

  // 屏体功耗 = 模组总数 × 单模组功耗
  const max_power = total_modules * modPower; // 最大功耗 (W)
  const avg_power = max_power * CONST.POWER_AVG_RATIO; // 平均功耗约为最大功耗的 60%

  G.max_power_total = max_power;
  G.avg_power_total = avg_power;

  // 显示计算结果
  document.getElementById('pw_power_grid').innerHTML =
    resultItem(_L({'zh-CN':'模组总数','en':'Total Modules'}), total_modules, 'pcs') +
    resultItem(_L({'zh-CN':'箱体总数','en':'Total Cabinets'}), total_boxes, 'pcs') +
    resultItem(_L({'zh-CN':'单模组功耗','en':'Power/Module'}), modPower, 'W') +
    resultItem(_L({'zh-CN':'屏幕最大功率','en':'Max Power (Screen)'}), (max_power/1000).toFixed(2), 'kW', 'accent') +
    resultItem(_L({'zh-CN':'屏幕平均功率','en':'Avg Power (Screen)'}), (avg_power/1000).toFixed(2), 'kW', 'success') +
    resultItem(_L({'zh-CN':'最大功耗密度','en':'Max Power Density'}), area > 0 ? (max_power/area).toFixed(0) : 0, 'W/m²') +
    resultItem(_L({'zh-CN':'平均功耗密度','en':'Avg Power Density'}), area > 0 ? (avg_power/area).toFixed(0) : 0, 'W/m²') +
    resultItem(_L({'zh-CN':'年耗电量(10h/天)','en':'Annual Energy (10h/d)'}), ((avg_power/1000)*10*365).toFixed(0), 'kWh/yr');

  document.getElementById('pw_power_note').innerHTML =
    total_modules > 0 && modPower > 0
    ? `⚡ ${_L({'zh-CN':'屏幕功耗','en':'Screen Power'})} = <b>${total_modules}</b> ${_L({'zh-CN':'个模组','en':'modules'})} × <b>${modPower}</b>W = <b>${(max_power/1000).toFixed(2)}kW</b> ${_L({'zh-CN':'(最大)','en':'(max)'})}，${_L({'zh-CN':'平均约','en':'avg ≈'})} <b>${(avg_power/1000).toFixed(2)}kW</b> ${_L({'zh-CN':'(典型)','en':'(typical)'})}。<br>     ${_L({'zh-CN':'电力系统应按','en':'Power system should be sized at'})} <b>${CONST.POWER_MARGIN}×</b> ${_L({'zh-CN':'最大功耗配置','en':'max ='})} <b>${(max_power/1000*CONST.POWER_MARGIN).toFixed(2)}kW</b>。`
    : `⚠️ ${_L({ 'zh-CN': "请填写总模组数和单模组功耗，或先在硬件配置标签页中配置屏体参数。", 'en': "Please fill in total modules and power per module, or configure screen params in the Hardware tab first." })}`;

  // 电源数量：区分有箱体 / 无箱体两种情况
  const psuRatedSel = vs('p_psu_rated');
  const psuParams = psuRatedSel === '__custom__' ? null : _getPSUParams(psuRatedSel);
  const psuRated = psuParams ? psuParams.ratedW : vt('p_psu_custom');
  const derate = vt('p_psu_derate') / 100 || CONST.PSU_DERATE;
  const redundancy = parseInt(vs('p_redundancy')) || CONST.REDUNDANCY_DEFAULT;
  const psuUsable = psuRated * derate;

  // 判断是否有箱体（与硬件配置保持一致）
  const hasBox = document.getElementById('has_box_yes')?.checked || false;

  // 每箱体电源数量
  const box_mw = vt('h_box_mw') || 0;
  const box_mh = vt('h_box_mh') || 0;
  const modulesPerBox = box_mw * box_mh;
  const powerPerBox = modulesPerBox * modPower;
  const psuPerBox = modulesPerBox > 0 && psuRated > 0 ? Math.ceil(powerPerBox / psuUsable) : 0;
  G.psu_per_box = psuPerBox;

  let psuNeeded;
  if (hasBox && total_boxes > 0 && modulesPerBox > 0) {
    // 有箱体：按箱体计算，每箱体 X 个电源
    psuNeeded = psuPerBox * total_boxes;
  } else {
    // 无箱体：按总功耗计算
    psuNeeded = Math.ceil(max_power / psuUsable);
  }

  const psuTotal = psuNeeded + redundancy;
  G.psu_count = psuTotal; G.psu_rated = psuRated;

  // 根据有无箱体调整显示内容
  const isBoxMode = hasBox && total_boxes > 0 && modulesPerBox > 0;
  const boxModeGrid = isBoxMode
    ? resultItem(_L({'zh-CN':'模组/箱体','en':'Modules/Cabinet'}), modulesPerBox, 'pcs') +
      resultItem(_L({'zh-CN':'功耗/箱体','en':'Power/Cabinet'}), (powerPerBox/1000).toFixed(2), 'kW') +
      resultItem(_L({'zh-CN':'电源/箱体','en':'PSU/Cabinet'}), psuPerBox, 'pcs', 'accent')
    : '';

  document.getElementById('pw_psu_grid').innerHTML =
    (isBoxMode ? boxModeGrid : '') +
    resultItem(_L({'zh-CN':'电源额定功率','en':'PSU Rating'}), psuRated, 'W') +
    resultItem(_L({'zh-CN':'可用功率','en':'Usable Power'}), psuUsable.toFixed(0), _L({'zh-CN':'W(降额)','en':'W (derated)'})) +
    resultItem(_L({'zh-CN':'最少电源数','en':'Min PSU Required'}), psuNeeded, 'pcs') +
    resultItem(_L({'zh-CN':'电源总数(含备份)','en':'Total PSU (w/ backup)'}), psuTotal, 'pcs', 'accent') +
    resultItem(_L({'zh-CN':'电源总功率','en':'Total PSU Power'}), (psuTotal*psuRated/1000).toFixed(1), 'kW');

  let noteText;
  if (isBoxMode) {
    noteText = `<div>🔋 <b>${_L({'zh-CN':'箱体模式','en':'Cabinet mode'})}</b>: ${modulesPerBox} ${_L({'zh-CN':'模组/箱体','en':'modules/cabinet'})} × ${modPower}W = ${(powerPerBox/1000).toFixed(2)}kW ÷ ${psuUsable.toFixed(0)}W ${_L({'zh-CN':'(降额)','en':'(derated)'})} ≈ ${psuPerBox} ${_L({'zh-CN':'电源/箱体','en':'PSU/cabinet'})}</div>` +
      `<div>📦 ${total_boxes} ${_L({'zh-CN':'个箱体','en':'cabinets'})} × ${psuPerBox} = <b>${psuNeeded}</b> + ${redundancy} ${_L({'zh-CN':'备份','en':'backup'})} = <b>${psuTotal}</b> × ${psuRated}W PSU</div>`;
  } else {
    noteText = `<div>🔋 <b>${_L({'zh-CN':'无箱体模式','en':'No-cabinet mode'})}</b>: ${_L({'zh-CN':'总功耗','en':'total power'})} ${(max_power/1000).toFixed(2)}kW ÷ ${psuUsable.toFixed(0)}W ${_L({'zh-CN':'(降额)','en':'(derated)'})} ≈ ${psuNeeded} PSU</div>` +
      `<div>📦 + ${redundancy} ${_L({'zh-CN':'备份','en':'backup'})} = <b>${psuTotal}</b> × ${psuRated}W ${_L({'zh-CN':'电源需求','en':'PSU required'})}</div>`;
  }
  document.getElementById('pw_psu_note').innerHTML = noteText;

  calcCable();
}

function calcCable() {
  const I = vt('p_branch_current') || CONST.BRANCH_CURRENT_DEFAULT;
  const L = vt('p_cable_len') || CONST.CABLE_LEN_DEFAULT;
  const phase = vs('p_power_phase');
  const conductor = vs('p_conductor');
  const rho = conductor === 'aluminum' ? CONST.RHO_ALUMINUM : CONST.RHO_COPPER;
  const psuRated = G.psu_rated || CONST.PSU_RATED_DEFAULT;
  const psuCount = G.psu_count || 1;

  // 国标允许压降：单相 220V×5%=11V，三相 380V×5%=19V
  const voltNominal = phase === 'three' ? CONST.VOLT_THREE : CONST.VOLT_SINGLE;
  const voltDropAllow = voltNominal * CONST.VOLT_DROP_RATIO;  // 11V 或 19V

  // 压降公式：S = 2 * ρ * L * I / ΔU（往返双线）
  const S_for_vd = 2 * rho * L * I / voltDropAllow;

  // 载流量表（穿管敷设，更保守更安全）
  const ampacityTable = [
    { s: 1.5,   a: 13 },
    { s: 2.5,   a: 18 },
    { s: 4,     a: 25 },
    { s: 6,     a: 32 },
    { s: 10,    a: 44 },
    { s: 16,    a: 59 },
    { s: 25,    a: 77 },
    { s: 35,    a: 94 },
    { s: 50,    a: 113 },
    { s: 70,    a: 143 },
    { s: 95,    a: 175 },
    { s: 120,   a: 206 },
    { s: 150,   a: 238 },
    { s: 185,   a: 275 },
    { s: 240,   a: 320 },
  ];

  // 双重校验：找同时满足载流量 ≥ 分支电流 AND 截面积 ≥ 压降所需最小截面积的最小线径
  let S_final = CONST.PSU_MIN_CAPACITY; // 最小1.5mm²起步
  let ampacity_ok = false, vd_ok = false;
  for (const row of ampacityTable) {
    const actual_dV_for_s = 2 * rho * L * I / row.s;
    const actual_pct = (actual_dV_for_s / voltNominal) * 100;
    if (row.a >= I && actual_pct <= 5) {
      S_final = row.s;
      ampacity_ok = true;
      vd_ok = actual_pct <= 5;
      break;  // 找到第一个达标的，就是最经济的
    }
  }

  // 如果载流量表没有达标的（电流极大），取最大截面积
  if (!ampacity_ok) S_final = 240;

  G.min_cable_mm = S_final;

  // 电缆数量计算：一条电缆安全承载功率 ÷ 电源额定功率
  const ampacityFinal = ampacityTable.find(r => r.s === S_final)?.a || 25;
  const cableSafePower = ampacityFinal * voltNominal;       // 单条电缆安全承载功率 (W)
  const psusPerCable = Math.floor(cableSafePower / psuRated); // 一条电缆能带几个电源
  const cablesNeeded = psusPerCable > 0 ? Math.ceil(psuCount / psusPerCable) : psuCount;
  // 配电柜数量：按30kW一台估算（大型配电），或按电源数量/每柜容纳电源数
  const psuPerCabinet = 8; // 每台配电柜约容纳8个电源
  const cabinetsNeeded = Math.max(1, Math.ceil(psuCount / psuPerCabinet));
  G.cables_needed = cablesNeeded;
  G.psus_per_cable = psusPerCable;
  G.power_cabinets = cabinetsNeeded;
  G.cable_mm = S_final;
  G.cable_phase = phase;

  // 重新用最终截面积算实际压降
  const actual_dV = 2 * rho * L * I / S_final;
  const actual_pct = (actual_dV / voltNominal) * 100;
  const ampacity = ampacityTable.find(r => r.s === S_final)?.a || 240;
  const ampacityPass = ampacity >= I;
  const vdPass = actual_pct <= 5;

  const _matName = conductor === 'aluminum' ? 'Al' : 'Cu';
  const _phaseName = phase === 'three' ? _L({'zh-CN':'三相380V','en':'3-Phase 380V'}) : _L({'zh-CN':'单相220V','en':'Single-Phase 220V'});

  document.getElementById('pw_cable_grid').innerHTML =
    resultItem(_L({'zh-CN':'最小截面积(压降)','en':'Min Cross-section (Vdrop)'}), S_for_vd.toFixed(2), 'mm²') +
    resultItem(_L({'zh-CN':'推荐截面积','en':'Recommended Cross-section'}), S_final, 'mm²', 'accent') +
    resultItem(_L({'zh-CN':'载流量校验','en':'Ampacity Check'}), ampacity + 'A ≥ ' + I + 'A', ampacityPass ? 'success' : 'warn') +
    resultItem(_L({'zh-CN':'压降校验','en':'Voltage Drop Check'}), actual_dV.toFixed(2) + 'V / ' + actual_pct.toFixed(1) + '%', vdPass ? 'success' : 'warn') +
    resultItem(_L({'zh-CN':'单线缆容量','en':'Per-cable Capacity'}), (cableSafePower/1000).toFixed(1) + 'kW', '') +
    resultItem(_L({'zh-CN':'每线电源数','en':'PSU per Cable'}), psusPerCable + ' pcs', '') +
    resultItem(_L({'zh-CN':'所需线缆数','en':'Cables Required'}), cablesNeeded, _L({'zh-CN':'条','en':'cables'}), 'success');

  let note = `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;align-items:baseline;font-size:14px;line-height:1.6">
      <div style="color:#666;text-align:right">${_L({'zh-CN':'线缆规格','en':'Cable Size'})}</div>
      <div><b>${S_final}mm²</b> ${_matName} ${_phaseName}</div>

      <div style="color:#666;text-align:right">${_L({'zh-CN':'压降','en':'Voltage Drop'})}</div>
      <div><b>${actual_dV.toFixed(2)}V</b> (${actual_pct.toFixed(1)}%)</div>

      <div style="color:#666;text-align:right">${_L({'zh-CN':'载流量','en':'Ampacity'})}</div>
      <div><b>${ampacity}A</b> ≥ ${I}A</div>

      <div style="color:#666;text-align:right">${_L({'zh-CN':'单线负载','en':'Per-cable Load'})}</div>
      <div><b>${(cableSafePower/1000).toFixed(1)}kW</b> (${ampacity}A × ${voltNominal}V)</div>

      <div style="color:#666;text-align:right">${_L({'zh-CN':'电源配置','en':'PSU Config'})}</div>
      <div>${_L({'zh-CN':'共','en':'Total'})} <b>${psuCount}</b> PSU, <b>${psuRated}W</b> ${_L({'zh-CN':'每台','en':'each'})}</div>

      <div style="color:#666;text-align:right">${_L({'zh-CN':'每线电源数','en':'PSU per Cable'})}</div>
      <div><b>${psusPerCable}</b> PSU</div>

      <div style="color:#666;text-align:right">${_L({'zh-CN':'所需线缆','en':'Cables Required'})}</div>
      <div><b>${cablesNeeded}</b> ${_L({'zh-CN':'条主线','en':'cable(s) main power'})}</div>
    </div>
  `;

  if (ampacityPass && vdPass) {
    note += `<div class="alert alert-success" style="margin-top:10px">✅ ${_L({'zh-CN':'双重校验通过（载流量 + 5%压降）。选型最优。','en':'Dual check passed (ampacity + 5% voltage drop). Optimal selection.'})}</div>`;
  } else if (!ampacityPass) {
    note += `<div class="alert alert-warn" style="margin-top:10px">⚠️ ${_L({'zh-CN':'电流过大。请增加回路数或使用更大截面积。','en':'Current too high. Increase circuits or use larger cross-section.'})}</div>`;
  } else {
    note += `<div class="alert alert-warn" style="margin-top:10px">⚠️ ${_L({'zh-CN':'压降超标。请使用更粗的电缆或缩短布线距离。','en':'Voltage drop exceeded. Use larger cable or shorten run.'})}</div>`;
  }

  document.getElementById('pw_cable_note').innerHTML = note;
}

// ====================================================
//  辅助系统计算
// ====================================================
function calcAux() {
  const maxPower = G.max_power_total || 1000;
  const env_temp = vt('a_env_temp') || 40;
  const max_junc = vt('a_max_junc') || 85;
  const margin = vt('a_margin') || 15;
  const cool_type = vs('a_cool_type');
  const fan_flow = vt('a_fan_flow') || 120;

  // 散热: 约30%功耗转为热量（LED效率约70%用于发光）
  const heat_watts = maxPower * 0.3;
  G.heat_watts = heat_watts;
  const allowDelta = max_junc - margin - env_temp;

  // 自然散热经验值：约20-50W/m² per degree
  const natural_limit = G.screen_area * 30 * allowDelta;
  const need_forced = heat_watts > natural_limit;

  // 强制风冷：每kW约需30 m³/h风量
  const total_flow_needed = heat_watts / 1000 * 30;
  const fans = cool_type === 'forced' ? Math.ceil(total_flow_needed / fan_flow) : 0;
  G.fans = fans;

  // 空调选型（适用于大型屏）：按单位面积冷量估算，约200~300W/m²
  const acCooling = G.screen_area * 250;  // W
  // 按匹数选型：匹数 = 制冷量(W) / 2500W，取标准匹数
  const acByP = [
    { p: '0.8P',  w: 2300 },
    { p: '1P',   w: 2600 },
    { p: '1.5P', w: 3500 },
    { p: '2P',   w: 5000 },
    { p: '3P',   w: 7200 },
    { p: '5P',   w: 12000 },
  ];
  const acUnits = Math.ceil(acCooling / 5000);  // 按5kW/台估算
  // 空调匹数推荐
  let acRec = { p: '-', w: 0 };
  if (acUnits > 0) {
    acRec = acByP.reduce((prev, cur) => Math.abs(cur.w - acCooling/acUnits) < Math.abs(prev.w - acCooling/acUnits) ? cur : prev);
  }
  G.ac_units = cool_type === 'ac' ? acUnits : 0;
  G.ac_model = cool_type === 'ac' ? `${acRec.p} (${(acRec.w/1000).toFixed(1)}kW)` : '';
  const coolTypeNameMap = {
    natural: _L({'zh-CN':'自然冷却','en':'Natural Cooling'}),
    forced:  _L({'zh-CN':'强制风冷','en':'Forced Air'}),
    ac:      _L({'zh-CN':'空调制冷','en':'Air Conditioning'})
  };
  const coolTypeName = coolTypeNameMap[cool_type] || coolTypeNameMap.natural;
  G.cool_type_name = coolTypeName;

  document.getElementById('aux_heat_grid').innerHTML =
    resultItem(_L({'zh-CN':'屏幕散热量','en':'Screen Heat Dissipation'}), (heat_watts/1000).toFixed(2), 'kW') +
    resultItem(_L({'zh-CN':'环境温度','en':'Ambient Temp'}), env_temp, '°C') +
    resultItem(_L({'zh-CN':'允许温升','en':'Allowed Temp Rise'}), allowDelta, '°C') +
    resultItem(_L({'zh-CN':'自然冷却极限','en':'Natural Cooling Limit'}), (natural_limit/1000).toFixed(2), 'kW') +
    resultItem(_L({'zh-CN':'散热方式','en':'Cooling Method'}), coolTypeName) +
    (cool_type === 'forced' ? resultItem(_L({'zh-CN':'所需风扇','en':'Fans Required'}), fans, 'pcs', fans > 5 ? 'warn' : 'accent') : '') +
    (cool_type === 'ac' ? (() => {
      const acRec = acByP.reduce((prev, cur) => Math.abs(cur.w - acCooling/acUnits) < Math.abs(prev.w - acCooling/acUnits) ? cur : prev);
      return resultItem(_L({'zh-CN':'空调规格','en':'AC Unit Size'}), acRec.p + ' (' + acRec.w/1000 + 'kW)', '') + resultItem(_L({'zh-CN':'空调数量','en':'AC Units Needed'}), acUnits + ' ' + _L({'zh-CN':'台','en':'unit(s)'}), 'accent');
    })() : '');

  const heatNote = document.getElementById('aux_heat_note');
  if (cool_type === 'natural') {
    if (need_forced) {
      heatNote.className = 'alert alert-warn';
      heatNote.innerHTML = `⚠️ ${_L({'zh-CN':'屏幕散热量','en':'Screen heat'})} <b>${(heat_watts/1000).toFixed(2)}kW</b> ${_L({'zh-CN':'超过自然冷却极限','en':'exceeds natural cooling limit'})} <b>${(natural_limit/1000).toFixed(2)}kW</b>。${_L({'zh-CN':'建议升级为强制风冷或空调制冷。','en':'Upgrade to forced air or AC cooling.'})}`;
    } else {
      heatNote.className = 'alert alert-success';
      heatNote.innerHTML = `✅ ${_L({'zh-CN':'自然冷却足够','en':'Natural cooling sufficient'})} (${(heat_watts/1000).toFixed(2)}kW < ${_L({'zh-CN':'极限','en':'limit'})} ${(natural_limit/1000).toFixed(2)}kW)。${_L({'zh-CN':'无需额外散热。','en':'No additional cooling needed.'})}`;
    }
  } else if (cool_type === 'forced') {
    if (fans > 20) {
      heatNote.className = 'alert alert-warn';
      heatNote.innerHTML = `⚠️ ${_L({'zh-CN':'建议','en':'Recommend'})} <b>${fans}</b> ${_L({'zh-CN':'台轴流风扇','en':'axial fans'})} (${fan_flow}m³/h ${_L({'zh-CN':'每台','en':'each'})}, ${_L({'zh-CN':'总风量','en':'total'})} ${total_flow_needed.toFixed(0)}m³/h)。${_L({'zh-CN':'建议考虑改用空调制冷。','en':'Consider switching to AC cooling.'})}`;
    } else {
      heatNote.className = 'alert alert-info';
      heatNote.innerHTML = `💨 ${_L({'zh-CN':'建议','en':'Recommend'})} <b>${fans}</b> ${_L({'zh-CN':'台轴流风扇','en':'axial fans'})} (${fan_flow}m³/h ${_L({'zh-CN':'每台','en':'each'})}, ${_L({'zh-CN':'总风量','en':'total'})} ${total_flow_needed.toFixed(0)}m³/h)。`;
    }
  } else if (cool_type === 'ac') {
    const acRec = acByP.reduce((prev, cur) => Math.abs(cur.w - acCooling/acUnits) < Math.abs(prev.w - acCooling/acUnits) ? cur : prev);
    heatNote.className = 'alert alert-info';
    heatNote.innerHTML = `❄️ ${_L({'zh-CN':'建议','en':'Recommend'})} <b>${acUnits}</b> × ${acRec.p} ${_L({'zh-CN':'空调','en':'AC unit(s)'})} (~${acRec.w/1000}kW ${_L({'zh-CN':'每台','en':'each'})}, ${_L({'zh-CN':'总制冷量约','en':'total ~'})}<b>${(acCooling/1000).toFixed(1)}kW</b>)。${_L({'zh-CN':'适用于大型或封闭箱体。','en':'Suitable for large or enclosed cabinets.'})}`;
  }

  // 音频估算（基于实际施工经验）
  const area = vt('a_area') || 200;
  const noise_db = parseInt(vs('a_noise')) || 45;
  const snr = vt('a_snr') || 10;
  const speaker_w = parseInt(vs('a_speaker_w')) || 100;
  const sens = vt('a_sens') || 95;
  const dist = vt('a_dist') || 20;

  // 声压级计算（保留作为参考信息）
  const target_spl = noise_db + snr;
  const dist_loss = 20 * Math.log10(dist);
  const spl_1m = sens + 10 * Math.log10(speaker_w);
  const spl_dist = spl_1m - dist_loss;

  // 音箱数量：基于实际施工经验
  let speakers;
  const screenArea = G.screen_area || 0;
  if (screenArea > 0 && screenArea < 10) {
    speakers = 1;  // 小屏，1只就够了
  } else {
    speakers = 2;  // 标准：左右立体声
  }
  // 场地很大时增加分布式音箱
  if (area > 1000) {
    speakers += Math.floor(area / 500);
  }
  speakers = Math.max(1, speakers);

  // 功放功率 = 音箱总数 × 单只功率 × 1.5倍余量
  const amp_power = speakers * speaker_w * 1.5;
  G.speakers = speakers; G.amp_power = amp_power;

  document.getElementById('aux_audio_grid').innerHTML =
    resultItem(_L({'zh-CN':'推荐音箱数','en':'Recommended Speakers'}), speakers, 'pcs', 'accent') +
    resultItem(_L({'zh-CN':'功放功率','en':'Amplifier Power'}), amp_power.toFixed(0), 'W', 'success') +
    resultItem(_L({'zh-CN':'目标声压级','en':'Target SPL'}), target_spl, 'dB') +
    resultItem(_L({'zh-CN':`声压级@${dist}m(单只)`,'en':`SPL@${dist}m (per speaker)`}), spl_dist.toFixed(1), 'dB');

  const areaExtra = area > 1000 ? `· ${_L({'zh-CN':'覆盖面积>1000m²，每500m²增加1只','en':'Coverage > 1000m², add 1 speaker per 500m²'})}<br>` : '';
  const screenNote = screenArea < 10 ? _L({'zh-CN':'(小屏)，建议1只','en':'(small screen), 1 speaker recommended'}) : _L({'zh-CN':'，立体声左右各1只','en':', stereo L/R 1 each'});
  document.getElementById('aux_audio_note').innerHTML =
    `<div>🔊 ${_L({'zh-CN':'覆盖面积','en':'Coverage'})}: ${area}m², ${_L({'zh-CN':'环境噪声','en':'ambient noise'})}: ${noise_db}dB。${_L({'zh-CN':'屏幕面积','en':'Screen area'})}: ${screenArea.toFixed(1)}m²${screenNote}</div>` +
    `<div>${areaExtra}· ${_L({'zh-CN':'共','en':'Total'})} <b>${speakers}</b> × ${speaker_w}W ${_L({'zh-CN':'音箱','en':'speakers'})}, ${_L({'zh-CN':'功放功率≥','en':'amp power ≥'})}<b>${amp_power.toFixed(0)}W</b>。</div>` +
    `<div>· ${_L({'zh-CN':'参考','en':'Ref'})}: ${sens}dB ${_L({'zh-CN':'灵敏度音箱在','en':'sensitivity speaker at'})} ${dist}m ≈ ${spl_dist.toFixed(1)}dB, ${_L({'zh-CN':'目标','en':'target'})} ${target_spl}dB。</div>`;
}

// ====================================================
//  BOM生成
// ====================================================
function generateBOM() {
  calcHardware();
  calcPower();
  calcAux();

  const pitch = G.pitch || 4;
  const scene = vs('h_scene');
  const sceneNameMap = {indoor: _L({'zh-CN':'室内','en':'Indoor'}), outdoor: _L({'zh-CN':'室外','en':'Outdoor'}), stage: _L({'zh-CN':'舞台','en':'Stage'}), traffic: _L({'zh-CN':'交通','en':'Traffic'})};
  const sceneName = sceneNameMap[scene] || scene;
  const modPrice = scene === 'indoor' ? 200 : (pitch <= 6 ? 150 : 80);
  const boxPrice = scene === 'indoor' ? 800 : (pitch <= 6 ? 600 : 400);

  // === 从DBM获取真实型号名称 ===
  const senderId = vs('h_sender_type');
  const recvId = vs('h_recv_type');
  const psuId = vs('p_psu_rated');

  // 发送卡
  let senderName = senderId === '__custom__' ? _L({'zh-CN':'自定义发送卡','en':'Custom Sender'}) : _L({'zh-CN':'发送卡','en':'Sender Card'});
  let senderCap = '';
  if (senderId && senderId !== '__custom__') {
    const s = DBM.getControls().find(c => c.id === senderId && (c.type === '发送设备' || c.type === 'sender' || c.type === '视频处理器' || c.type === 'vprocessor' || c.type === '异步卡' || c.type === '播放盒' || c.type === '同异步播放盒'));
    if (s) { senderName = s.name; senderCap = s.capacityUnit === 'px' ? `${s.capacity}px` : `${s.capacity}万px`; }
  }

  // 接收卡
  let recvName = recvId === '__custom__' ? _L({'zh-CN':'自定义接收卡','en':'Custom Receiver'}) : _L({'zh-CN':'接收卡','en':'Receiver Card'});
  if (recvId && recvId !== '__custom__') {
    const r = DBM.getRecvCards().find(r => r.id === recvId);
    if (r) recvName = r.name;
  }

  // 开关电源
  let psuName = psuId === '__custom__' ? `${G.psu_rated}W 5V` : _L({'zh-CN':'开关电源','en':'Switching PSU'});
  if (psuId && psuId !== '__custom__') {
    const p = DBM.getPSUs().find(p => p.id === psuId);
    if (p) psuName = p.name;
  }

  // 线缆规格
  const cableMat = _L({'zh-CN':'铜阻燃','en':'Cu Flame-retardant'});
  const cablePhase = G.cable_phase === 'three' ? _L({'zh-CN':'三相380V','en':'3-Phase 380V'}) : _L({'zh-CN':'单相220V','en':'Single-Phase 220V'});

  // 视频处理器（从视频处理器库选择）
  const vpId = vs('h_vprocessor_type');
  let vpName = '', vpSpec = '';
  if (vpId && vpId !== '__custom__') {
    const vp = DBM.getVProcessors().find(v => v.id === vpId);
    if (vp) { vpName = vp.name; vpSpec = `${vp.resW||'-'}×${vp.resH||'-'}, ${vp.type}`; }
  }

  // 初始BOM数据
  G.bom_items = [
    { name: _L({'zh-CN':'LED模组','en':'LED Module'}), spec: `P${pitch} ${sceneName}, ${G.mod_pixel_w}×${G.mod_pixel_h}px`, unit: 'pcs', qty: G.total_modules, price: modPrice, note: _L({'zh-CN':'LED灯珠/PCB/电子元件','en':'LEDs/PCB/electronics'}) },
    { name: _L({'zh-CN':'LED箱体','en':'LED Cabinet'}), spec: `${_L({'zh-CN':'钣金','en':'Sheet metal'})}, P${pitch}`, unit: 'pcs', qty: G.total_boxes, price: boxPrice, note: _L({'zh-CN':'铝/钢结构','en':'Al/Steel structure'}) },
    { name: _L({'zh-CN':'发送卡','en':'Sender Card'}), spec: senderCap ? `${senderName} (${senderCap})` : senderName, unit: 'pcs', qty: G.senders, price: 1500, note: _L({'zh-CN':'含软件授权','en':'Incl. software license'}) },
    { name: _L({'zh-CN':'接收卡','en':'Receiver Card'}), spec: `${recvName} (${vt('h_recv_load_w')||128}×${vt('h_recv_load_h')||128}px/${_L({'zh-CN':'卡','en':'card'})})`, unit: 'pcs', qty: G.receivers, price: 80, note: _L({'zh-CN':'安装于箱体内','en':'Installed in cabinet'}) },
    { name: _L({'zh-CN':'开关电源','en':'Switching PSU'}), spec: psuName, unit: 'pcs', qty: G.psu_count, price: G.psu_rated === 200 ? 60 : (G.psu_rated >= 300 ? 90 : 45), note: _L({'zh-CN':'N+1冗余','en':'N+1 redundancy'}) },
    { name: _L({'zh-CN':'配电箱','en':'Distribution Panel'}), spec: `${cablePhase}, ${_L({'zh-CN':'含断路器/漏电保护/浪涌','en':'incl. breakers/RCD/surge'})}`, unit: 'set', qty: G.power_cabinets || Math.max(1, Math.ceil(G.max_power_total/30000)), price: 2500, note: _L({'zh-CN':'按总功率选型','en':'Sized by total power'}) },
    { name: _L({'zh-CN':'控制电脑','en':'Control PC'}), spec: 'i5/16GB RAM/Dedicated GPU', unit: 'unit', qty: 1, price: 5000, note: _L({'zh-CN':'含LED控制软件','en':'Incl. LED control software'}) },
    { name: _L({'zh-CN':'视频处理器','en':'Video Processor'}), spec: vpSpec ? `${vpName} (${vpSpec})` : (vpName || ''), unit: 'unit', qty: vpName ? 1 : 0, price: 8000, note: _L({'zh-CN':'视频信号处理','en':'Video signal processing'}) },
    { name: _L({'zh-CN':'散热风扇','en':'Cooling Fan'}), spec: _L({'zh-CN':'轴流风扇 220V','en':'Axial Fan 220V'}), unit: 'pcs', qty: G.fans, price: 120, note: G.fans === 0 ? _L({'zh-CN':'自然冷却，无需','en':'Natural cooling, not required'}) : _L({'zh-CN':'强制风冷','en':'Forced air cooling'}) },
    { name: _L({'zh-CN':'空调','en':'Air Conditioner'}), spec: G.ac_model ? `${G.ac_model}` : `${sceneName} ${_L({'zh-CN':'大屏','en':'large screen'})}`, unit: 'unit', qty: G.ac_units || 0, price: 3000, note: G.ac_units ? _L({'zh-CN':'按热负荷选型','en':'Sized by heat load'}) : '' },
    { name: _L({'zh-CN':'功放','en':'Power Amplifier'}), spec: `${_L({'zh-CN':'总功率≥','en':'Total power ≥'})} ${G.amp_power.toFixed(0)}W`, unit: 'unit', qty: Math.max(1, Math.ceil(G.amp_power/500)), price: 800, note: _L({'zh-CN':'音频系统','en':'Audio system'}) },
    { name: _L({'zh-CN':'音箱','en':'Speaker'}), spec: `${vs('a_speaker_w')}W ${_L({'zh-CN':'全频','en':'Full-range'})}`, unit: 'pcs', qty: G.speakers, price: 400, note: _L({'zh-CN':'含支架','en':'Incl. brackets'}) },
    { name: _L({'zh-CN':'电源线','en':'Power Cable'}), spec: `${G.min_cable_mm}mm² ${cableMat} ${cablePhase}`, unit: 'm', qty: G.cables_needed * 20 || Math.ceil(G.screen_area * 15), price: 8, note: _L({'zh-CN':'主供电','en':'Main power supply'}) },
    { name: _L({'zh-CN':'网线信号线','en':'Network Signal Cable'}), spec: 'CAT6 Shielded', unit: 'm', qty: Math.ceil(G.total_boxes * 2 + 20), price: 3, note: _L({'zh-CN':'控制信号','en':'Control signal'}) },
    { name: _L({'zh-CN':'钢结构','en':'Steel Structure'}), spec: _L({'zh-CN':'镀锌/不锈钢','en':'Galvanized / Stainless'}), unit: 'kg', qty: Math.ceil(G.screen_area * 25), price: 12, note: _L({'zh-CN':'按屏幕面积估算','en':'By screen area estimate'}) },
    { name: _L({'zh-CN':'安装辅材','en':'Installation Materials'}), spec: _L({'zh-CN':'螺丝/扎带/端子/密封胶','en':'Screws, ties, terminals, sealant'}), unit: 'set', qty: 1, price: Math.ceil(G.total_boxes * 5), note: _L({'zh-CN':'耗材','en':'Consumables'}) },
  ];

  // 去除数量为0的项
  G.bom_items = G.bom_items.filter(i => i.qty > 0);
  renderBOM();
}

// 渲染可编辑的BOM表格
function renderBOM() {
  const sym = document.documentElement.lang === 'zh-CN' ? '¥' : (document.documentElement.lang === 'fr' ? '€' : '$');  // 货币符号：中文¥ / 法语€/ 英文$
  const inpStyle = 'width:100%;border:none;background:transparent;padding:4px 2px;text-align:center;font-size:13px;outline:none;border-bottom:1px dashed #90A4AE;';
  const inpTextStyle = 'width:100%;border:none;background:transparent;padding:4px 2px;font-size:12px;color:#546E7A;outline:none;border-bottom:1px dashed #90A4AE;';
  let html = '';
  let total = 0;
  G.bom_items.forEach((item, idx) => {
    const subtotal = (item.qty || 0) * (item.price || 0);
    total += subtotal;
    html += `<tr>
      <td style="text-align:center;padding:4px">${idx+1}</td>
      <td style="padding:2px"><input type="text" value="${item.name}" data-idx="${idx}" data-field="name" onchange="onBomChange(this)" style="${inpTextStyle}"></td>
      <td style="padding:2px"><input type="text" value="${item.spec}" data-idx="${idx}" data-field="spec" onchange="onBomChange(this)" style="${inpTextStyle}"></td>
      <td style="padding:2px"><input type="text" value="${item.unit}" data-idx="${idx}" data-field="unit" onchange="onBomChange(this)" style="${inpStyle}"></td>
      <td style="padding:2px"><input type="number" value="${item.qty}" data-idx="${idx}" data-field="qty" min="0" oninput="onBomChange(this)" style="${inpStyle}"></td>
      <td style="padding:2px"><input type="number" value="${item.price}" data-idx="${idx}" data-field="price" min="0" step="0.01" oninput="onBomChange(this)" style="${inpStyle}"></td>
      <td class="num" id="bom_sub_${idx}" style="padding:4px">${sym}${subtotal.toLocaleString()}</td>
      <td style="padding:2px"><input type="text" value="${item.note}" data-idx="${idx}" data-field="note" onchange="onBomChange(this)" style="${inpTextStyle}"></td>
    </tr>`;
  });
  html += `<tr class="total-row">
    <td colspan="5" style="text-align:right;padding:8px 4px;font-weight:bold;color:var(--primary-dark)">${_L({'zh-CN':'物料合计(不含人工)','en':'Materials Total (excl. labor)'})}</td>
    <td colspan="2" id="bom_total_num" style="text-align:center;padding:8px 4px;font-weight:bold;color:var(--primary-dark)">${sym}${total.toLocaleString()}</td>
    <td></td>
  </tr>`;

  document.getElementById('bom_body').innerHTML = html;
  updateBOMTotalHtml(total);
}

// BOM字段变更处理
function onBomChange(el) {
  const idx = parseInt(el.dataset.idx);
  const field = el.dataset.field;
  let val = el.value;
  if (field === 'qty' || field === 'price') val = parseFloat(val) || 0;
  G.bom_items[idx][field] = val;
  // 重新计算该行小计
  const item = G.bom_items[idx];
  const subtotal = (item.qty || 0) * (item.price || 0);
  const sym = document.documentElement.lang === 'zh-CN' ? '¥' : (document.documentElement.lang === 'fr' ? '€' : '$');
  document.getElementById('bom_sub_' + idx).textContent = sym + subtotal.toLocaleString();
  // 重新计算合计
  const total = G.bom_items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);
  document.getElementById('bom_total_num').textContent = sym + total.toLocaleString();
  updateBOMTotalHtml(total);
}

// ====================================================
//  BOM手动添加物料
// ====================================================
function showAddMaterialModal() {
  document.getElementById('bom_add_modal').style.display = 'flex';
  document.getElementById('bom_add_name').focus();
}
function closeAddMaterialModal() {
  document.getElementById('bom_add_modal').style.display = 'none';
  // 清空表单
  document.getElementById('bom_add_name').value = '';
  document.getElementById('bom_add_spec').value = '';
  document.getElementById('bom_add_unit').value = 'pcs';
  document.getElementById('bom_add_qty').value = '1';
  document.getElementById('bom_add_price').value = '0';
  document.getElementById('bom_add_note').value = '';
}
function confirmAddMaterial() {
  const name = document.getElementById('bom_add_name').value.trim();
  const spec = document.getElementById('bom_add_spec').value.trim();
  const unit = document.getElementById('bom_add_unit').value.trim() || 'pcs';
  const qty = parseFloat(document.getElementById('bom_add_qty').value) || 0;
  const price = parseFloat(document.getElementById('bom_add_price').value) || 0;
  const note = document.getElementById('bom_add_note').value.trim();

  if (!name) {
    alert(_L({'zh-CN':'请输入物料名称！','en':'Please enter item name!'}));
    return;
  }
  if (qty <= 0) {
    alert(_L({'zh-CN':'数量必须大于0！','en':'Quantity must be greater than 0!'}));
    return;
  }

  // 确保bom_items数组存在
  if (!G.bom_items) G.bom_items = [];

  // 添加新物料
  G.bom_items.push({
    name: name,
    spec: spec,
    unit: unit,
    qty: qty,
    price: price,
    note: note
  });

  closeAddMaterialModal();
  renderBOM();
}

// 更新总价汇总区
function updateBOMTotalHtml(total) {
  const sym = document.documentElement.lang === 'zh-CN' ? '¥' : (document.documentElement.lang === 'fr' ? '€' : '$');
  document.getElementById('bom_total').innerHTML =
    `<div class="alert alert-info">
      💰 ${_L({'zh-CN':'物料估算','en':'Materials Estimate'})}: <b style="font-size:18px;color:var(--primary-dark)">${sym}${total.toLocaleString()}</b>
      (${_L({'zh-CN':'参考价格，实际以供应商报价为准','en':'Reference price, actual subject to vendor quote'})})<br>
      ${_L({'zh-CN':'含13%增值税','en':'Incl. 13% VAT'})}: <b>${sym}${Math.ceil(total*1.13).toLocaleString()}</b>
      &nbsp;&nbsp;|&nbsp;&nbsp; ${_L({'zh-CN':'含安装费(+30%)','en':'Incl. installation (+30%)'})}: <b>${sym}${Math.ceil(total*1.43).toLocaleString()}</b>
    </div>`;
}

// ====================================================
//  导出CSV
// ====================================================
function exportBOM() {
  if (!G.bom_items || G.bom_items.length === 0) {
    alert(_L({'zh-CN':'请先生成BOM物料清单！','en':'Please generate the BOM list first!'}));
    return;
  }
  const isZh = document.documentElement.lang === 'zh-CN';
  let csv = isZh
    ? '\uFEFF序号,物料名称,规格型号,单位,数量,单价,小计,备注\n'
    : '\uFEFFNo.,Item Name,Spec/Model,Unit,Qty,Unit Price,Subtotal,Note\n';
  G.bom_items.forEach((item, idx) => {
    const subtotal = (item.qty || 0) * (item.price || 0);
    csv += `${idx+1},"${item.name}","${item.spec}","${item.unit}",${item.qty},${item.price},${subtotal},"${item.note}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = isZh ? 'LED显示屏BOM清单.csv' : 'LED_Display_BOM.csv';
  a.click(); URL.revokeObjectURL(url);
}

function printBOM() {
  window.print();
}

// ====================================================
//  技术方案书生成
// ====================================================
function genReport() {
  calcHardware(); calcPower(); calcAux();
  const today = document.getElementById('rpt_date').value ||
    new Date().toISOString().slice(0,10);
  const projName = vs('rpt_name') || _L({'zh-CN':'XXX项目','en':'XXX Project'});
  const client = vs('rpt_client') || '';
  const company = vs('rpt_company') || '';
  const location = vs('rpt_location') || '';
  const mountMap = {
    wall: _L({'zh-CN':'墙面固定安装','en':'Wall-mounted'}),
    standalone: _L({'zh-CN':'独立立柱','en':'Freestanding'}),
    hanging: _L({'zh-CN':'悬挂吊装','en':'Hanging'}),
    roof: _L({'zh-CN':'屋顶安装','en':'Roof-mounted'}),
    stage: _L({'zh-CN':'舞台弧形屏','en':'Stage Curved Screen'}),
    curved: _L({'zh-CN':'定制弧形屏','en':'Custom Curved Screen'})
  };
  const mount = mountMap[vs('rpt_mount')] || '';
  const sceneMap = {indoor: _L({'zh-CN':'室内','en':'Indoor'}), outdoor: _L({'zh-CN':'室外','en':'Outdoor'}), stage: _L({'zh-CN':'舞台','en':'Stage'}), traffic: _L({'zh-CN':'交通','en':'Traffic'})};
  const scene = sceneMap[vs('h_scene')] || '';
  const pitch = G.pitch;

  const report = `
════════════════════════════════════════════════════════════
         ${_L({'zh-CN':'LED全彩显示屏技术方案书','en':'LED Full-Color Display Technical Proposal'})}
════════════════════════════════════════════════════════════

${_L({'zh-CN':'项目名称','en':'Project'})}:      ${projName}
${_L({'zh-CN':'客户','en':'Client'})}:       ${client}
${_L({'zh-CN':'承包商','en':'Contractor'})}:   ${company}
${_L({'zh-CN':'日期','en':'Date'})}:         ${today}
${_L({'zh-CN':'地点','en':'Location'})}:     ${location}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ${_L({'zh-CN':'项目概述','en':'PROJECT OVERVIEW'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ${_L({'zh-CN':'本方案涵盖','en':'This proposal covers the LED display system for'})} ${projName}。
  ${_L({'zh-CN':'安装地点','en':'Installation location'})}: ${location}。${_L({'zh-CN':'安装方式','en':'Mount type'})}: [${mount}]。
  ${_L({'zh-CN':'应用场景','en':'Application'})}: [${scene}${_L({'zh-CN':'屏','en':' Screen'})}]。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. ${_L({'zh-CN':'屏幕技术规格','en':'SCREEN TECHNICAL SPECIFICATIONS'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ┌─────────────────────────────────────────┐
  │  ${_L({'zh-CN':'屏幕尺寸','en':'Screen Size'})}       │  ${(vt('h_width')/1000).toFixed(2)}m (W) × ${(vt('h_height')/1000).toFixed(2)}m (H)
  │  ${_L({'zh-CN':'屏幕面积','en':'Screen Area'})}       │  ${G.screen_area.toFixed(2)} m²
  │  ${_L({'zh-CN':'像素间距','en':'Pixel Pitch'})}       │  P${pitch}mm
  │  ${_L({'zh-CN':'分辨率','en':'Resolution'})}        │  ${G.pixels_w} × ${G.pixels_h} px
  │  ${_L({'zh-CN':'总像素','en':'Total Pixels'})}      │  ${(G.total_pixels/10000).toFixed(1)} 万px
  │  ${_L({'zh-CN':'像素密度','en':'Pixel Density'})}     │  ${(1000000/pitch/pitch).toFixed(0)} px/m²
  │  ${_L({'zh-CN':'色深','en':'Color Depth'})}       │  16-bit (65536 gray levels)
  │  ${_L({'zh-CN':'刷新率','en':'Refresh Rate'})}      │  ≥ 1920 Hz (no blur)
  │  ${_L({'zh-CN':'帧率','en':'Frame Rate'})}        │  ≥ 60 Hz
  └─────────────────────────────────────────┘

  ◉ ${_L({'zh-CN':'像素结构','en':'Pixel structure'})}: R/G/B LED per pixel. LED type: ${vs('p_led_type').toUpperCase()}.

  ◉ ${_L({'zh-CN':'亮度','en':'Brightness'})}:
    · ${vs('h_scene') === 'indoor' ? _L({'zh-CN':'室内: 800~2000 nits，随环境光自动调节','en':'Indoor: 800~2000 nits, auto-adjust with ambient light'}) :
       vs('h_scene') === 'outdoor' ? _L({'zh-CN':'室外: 最大≥6500 nits，光感自动亮度调节','en':'Outdoor: max ≥ 6500 nits, auto-brightness by light sensor'}) :
       _L({'zh-CN':'舞台: 500~1500 nits，与舞台灯光同步','en':'Stage: 500~1500 nits, synced with stage lighting'})}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. ${_L({'zh-CN':'结构设计','en':'STRUCTURAL DESIGN'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ◉ ${_L({'zh-CN':'模组尺寸','en':'Module Size'})}:   ${G.mod_pixel_w}×${G.mod_pixel_h} px/${_L({'zh-CN':'模组','en':'module'})}
  ◉ ${_L({'zh-CN':'箱体尺寸','en':'Cabinet Size'})}:  ${G.mod_pixel_w * vt('h_box_mw')}×${G.mod_pixel_h * vt('h_box_mh')} px/${_L({'zh-CN':'箱体','en':'cabinet'})}
                   (${vt('h_box_mw')}×${vt('h_box_mh')} ${_L({'zh-CN':'模组/箱体','en':'modules/cabinet'})})
  ◉ ${_L({'zh-CN':'箱体数量(横)','en':'Cabinets (H)'})}:  ${G.box_x} pcs
  ◉ ${_L({'zh-CN':'箱体数量(纵)','en':'Cabinets (V)'})}:  ${G.box_y} pcs
  ◉ ${_L({'zh-CN':'箱体总数','en':'Total Cabinets'})}:${G.total_boxes} pcs
  ◉ ${_L({'zh-CN':'模组总数','en':'Total Modules'})}: ${G.total_modules} pcs
  ◉ ${_L({'zh-CN':'安装方式','en':'Mount Type'})}:    ${mount}

  ◉ ${_L({'zh-CN':'防护等级','en':'IP Rating'})}:   ${vs('h_scene') === 'outdoor' ? _L({'zh-CN':'IP65 (室外防水防尘)','en':'IP65 (outdoor waterproof/dustproof)'}) : _L({'zh-CN':'IP40 (室内标准)','en':'IP40 (indoor standard)'})}
  ◉ ${_L({'zh-CN':'材质','en':'Material'})}:    ${vs('h_scene') === 'outdoor' ? _L({'zh-CN':'高强度铝合金+防锈处理','en':'High-strength aluminum alloy + anti-rust treatment'}) : _L({'zh-CN':'铝合金/钢喷塑','en':'Al alloy / steel powder coat'})}
  ◉ ${_L({'zh-CN':'工作温度','en':'Operating Temp'})}: ${vs('h_scene') === 'outdoor' ? '-20°C ~ +60°C' : '0°C ~ +50°C'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. ${_L({'zh-CN':'最佳观看距离','en':'OPTIMAL VIEWING DISTANCE'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ◉ ${_L({'zh-CN':'最近距离','en':'Min Distance'})}:     ${(pitch * (vt('h_k3')||500) / 1000).toFixed(1)} m
  ◉ ${_L({'zh-CN':'最佳距离','en':'Optimal Distance'})}: ${(pitch * (vt('h_k1')||1000) / 1000).toFixed(1)} m  ← ${_L({'zh-CN':'推荐','en':'Recommended'})}
  ◉ ${_L({'zh-CN':'最远距离','en':'Max Distance'})}:     ${(pitch * (vt('h_k2')||3500) / 1000).toFixed(1)} m

  ${_L({'zh-CN':'公式','en':'Formula'})}: ${_L({'zh-CN':'最佳距离 = 像素间距 ×','en':'Optimal = P ×'})} ${vt('h_k1')||1000} (P = ${_L({'zh-CN':'像素间距(mm)','en':'pixel pitch in mm'})})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. ${_L({'zh-CN':'控制系统','en':'CONTROL SYSTEM'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ◉ ${_L({'zh-CN':'信号流','en':'Signal Flow'})}:  PC → ${_L({'zh-CN':'发送卡','en':'Sender'})} → ${_L({'zh-CN':'接收卡','en':'Receiver'})} → ${_L({'zh-CN':'模组','en':'Module'})}
  ◉ ${_L({'zh-CN':'发送卡型号','en':'Sender Model'})}: ${(() => {
    const s = DBM.getControls().find(c => c.id === vs('h_sender_type') && (c.type === '发送设备' || c.type === 'sender' || c.type === '视频处理器' || c.type === 'vprocessor' || c.type === '异步卡' || c.type === '播放盒' || c.type === '同异步播放盒'));
    return s ? s.name : (vs('h_sender_type') || _L({'zh-CN':'未选择','en':'Not selected'}));
  })()}
    · ${_L({'zh-CN':'数量','en':'Qty'})}: ${G.senders} pcs
    ${G.senders > 1 ? '· ' + _L({'zh-CN':'级联','en':'Cascade'}) + ': ' + G.senders + ' ' + _L({'zh-CN':'张发送卡同步级联','en':'senders in sync cascade'}) : '· ' + _L({'zh-CN':'单卡独立工作','en':'Single card, standalone'})}
  ◉ ${_L({'zh-CN':'接收卡型号','en':'Receiver Model'})}: ${(() => {
    const r = DBM.getRecvCards().find(c => c.id === vs('h_recv_type'));
    return r ? r.name : (vs('h_recv_type') || _L({'zh-CN':'未选择','en':'Not selected'}));
  })()}
    · ${_L({'zh-CN':'数量','en':'Qty'})}: ${G.receivers} pcs (${vt('h_recv_per_box')} ${_L({'zh-CN':'张/箱体','en':'per cabinet'})})
  ◉ ${_L({'zh-CN':'控制电脑','en':'Control PC'})}: 1 ${_L({'zh-CN':'台','en':'unit'})} (${_L({'zh-CN':'含LED控制软件','en':'incl. LED control software'})})
  ◉ ${_L({'zh-CN':'软件功能','en':'Software'})}: ${_L({'zh-CN':'视频播放、分区显示、亮度控制、定时开关、远程监控','en':'Video playback, zone display, brightness control, scheduled on/off, remote monitoring'})}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. ${_L({'zh-CN':'电力与配电系统','en':'POWER & DISTRIBUTION SYSTEM'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  6.1 ${_L({'zh-CN':'电力参数','en':'Power Parameters'})}
  ◉ ${_L({'zh-CN':'最大功率(全白)','en':'Max Power (full white)'})}: ${(G.max_power_total/1000).toFixed(2)} kW
  ◉ ${_L({'zh-CN':'典型功率','en':'Typical Power'})}:          ${(G.avg_power_total/1000).toFixed(2)} kW
  ◉ ${_L({'zh-CN':'最大功耗密度','en':'Max Density'})}:            ${(G.max_power_total/G.screen_area).toFixed(0)} W/m²
  ◉ ${_L({'zh-CN':'配电容量(×1.25)','en':'Distribution Capacity (×1.25)'})}: ${(G.max_power_total/1000*1.25).toFixed(2)} kW

  6.2 ${_L({'zh-CN':'电源配置','en':'PSU Configuration'})}
  ◉ ${_L({'zh-CN':'电源规格','en':'PSU Spec'})}: ${G.psu_rated}W ${_L({'zh-CN':'开关电源，5V直流输出','en':'switching PSU, 5V DC output'})}
  ◉ ${_L({'zh-CN':'电源数量','en':'PSU Qty'})}:  ${G.psu_count} pcs (N+${vs('p_redundancy')} ${_L({'zh-CN':'冗余','en':'redundancy'})})
  ◉ ${_L({'zh-CN':'电源总功率','en':'Total PSU Power'})}: ${(G.psu_count * G.psu_rated / 1000).toFixed(1)} kW

  6.3 ${_L({'zh-CN':'线缆规格','en':'Cable Specifications'})}
  ◉ ${_L({'zh-CN':'主回路电缆','en':'Main Circuit Cable'})}: ≥ ${G.min_cable_mm} mm² (${_L({'zh-CN':'铜阻燃','en':'Cu flame-retardant'})})
  ◉ ${_L({'zh-CN':'控制信号','en':'Control Signal'})}: CAT6 ${_L({'zh-CN':'屏蔽双绞线','en':'shielded twisted pair'})}
  ◉ ${_L({'zh-CN':'配电箱','en':'Distribution'})}: ${_L({'zh-CN':'含断路器、漏电保护、浪涌保护','en':'incl. circuit breakers, RCD, surge protection'})}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. ${_L({'zh-CN':'辅助系统','en':'AUXILIARY SYSTEMS'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  7.1 ${_L({'zh-CN':'散热管理','en':'Thermal Management'})}
  ◉ ${_L({'zh-CN':'总散热量','en':'Total Heat Dissipation'})}: ${(G.heat_watts/1000).toFixed(2)} kW
  ◉ ${_L({'zh-CN':'散热方式','en':'Cooling Method'})}: ${vs('a_cool_type') === 'natural' ? _L({'zh-CN':'自然冷却','en':'Natural cooling'}) : vs('a_cool_type') === 'ac' ? _L({'zh-CN':'空调制冷','en':'Air conditioning'}) : _L({'zh-CN':'强制风冷','en':'Forced air cooling'})}
  ${G.fans > 0 ? '◉ ' + _L({'zh-CN':'散热风扇','en':'Cooling Fans'}) + ': ' + G.fans + ' ' + _L({'zh-CN':'台轴流风扇','en':'axial fan(s)'}) : '◉ ' + _L({'zh-CN':'自然冷却足够，无需风扇','en':'Natural cooling sufficient, no fans required'})}
  ◉ ${_L({'zh-CN':'最高环境温度','en':'Max Ambient Temp'})}: ${vt('a_env_temp')} °C (${_L({'zh-CN':'正常运行','en':'normal operation'})})

  7.2 ${_L({'zh-CN':'音频系统','en':'Audio System'})}
  ◉ ${_L({'zh-CN':'推荐音箱','en':'Recommended Speakers'})}: ${G.speakers} pcs (${vs('a_speaker_w')}W ${_L({'zh-CN':'全频','en':'full-range'})})
  ◉ ${_L({'zh-CN':'功放功率','en':'Amplifier Power'})}:       ≥ ${G.amp_power.toFixed(0)} W
  ◉ ${_L({'zh-CN':'覆盖面积','en':'Coverage Area'})}:         ${vt('a_area')} m²
  ◉ ${_L({'zh-CN':'目标声压级','en':'Target SPL'})}:            ${parseInt(vs('a_noise')) + vt('a_snr')} dB (${vt('a_snr')}dB ${_L({'zh-CN':'高于环境噪声','en':'above ambient'})})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. ${_L({'zh-CN':'物料汇总(BOM)','en':'MATERIALS SUMMARY (BOM)'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ${_L({'zh-CN':'主要部件','en':'Key Components'})}:
  ◉ ${_L({'zh-CN':'LED模组','en':'LED Modules'})}      ${G.total_modules} pcs
  ◉ ${_L({'zh-CN':'LED箱体','en':'LED Cabinets'})}     ${G.total_boxes} pcs
  ◉ ${_L({'zh-CN':'发送卡','en':'Sender Cards'})}     ${G.senders} pcs
  ◉ ${_L({'zh-CN':'接收卡','en':'Receiver Cards'})}   ${G.receivers} pcs
  ◉ ${_L({'zh-CN':'电源','en':'PSUs'})}             ${G.psu_count} pcs (${G.psu_rated}W ${_L({'zh-CN':'每台','en':'each'})})
  ◉ ${_L({'zh-CN':'控制电脑','en':'Control PC'})}       1 ${_L({'zh-CN':'台','en':'unit'})}
  ${G.fans > 0 ? '◉ ' + _L({'zh-CN':'散热风扇','en':'Cooling Fans'}) + '     ' + G.fans + ' pcs' : ''}
  ◉ ${_L({'zh-CN':'音箱','en':'Speakers'})}         ${G.speakers} pcs
  ◉ ${_L({'zh-CN':'详见附件BOM完整物料清单','en':'See attached BOM for full material list'})}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. ${_L({'zh-CN':'安全与认证','en':'SAFETY & CERTIFICATIONS'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ◉ ${_L({'zh-CN':'认证','en':'Certifications'})}: CE / RoHS / 3C / ISO9001
  ◉ ${_L({'zh-CN':'电气安全','en':'Electrical Safety'})}: ${_L({'zh-CN':'符合GB/T 17626.x EMC标准','en':'Compliant with GB/T 17626.x EMC standards'})}
  ◉ ${_L({'zh-CN':'结构安全','en':'Structural Safety'})}: ${_L({'zh-CN':'钢结构符合GB50017，抗风≥10级','en':'Steel structure per GB50017, wind-resistant ≥ Level 10'})}
  ◉ ${_L({'zh-CN':'接地','en':'Grounding'})}: ${_L({'zh-CN':'所有金属部件可靠接地，接地电阻≤4Ω','en':'All metal parts reliably grounded, resistance ≤ 4Ω'})}
  ◉ ${_L({'zh-CN':'防雷保护','en':'Lightning Protection'})}: ${_L({'zh-CN':'电源与信号均安装浪涌保护器','en':'Power and signal surge protectors installed'})}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. ${_L({'zh-CN':'安装与验收','en':'INSTALLATION & ACCEPTANCE'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ◉ ${_L({'zh-CN':'安装','en':'Installation'})}: ${_L({'zh-CN':'由持证技术人员现场安装','en':'By certified technicians on-site'})}
  ◉ ${_L({'zh-CN':'验收标准','en':'Acceptance Standard'})}: SJ/T 11281 ${_L({'zh-CN':'LED显示屏通用规范','en':'LED Display General Specification'})}
  ◉ ${_L({'zh-CN':'培训','en':'Training'})}: ${_L({'zh-CN':'完工后提供操作人员培训','en':'Operator training provided upon completion'})}
  ◉ ${_L({'zh-CN':'质保','en':'Warranty'})}: ${_L({'zh-CN':'系统2年 / 模组3年 / LED灯5年','en':'2yr system / 3yr modules / 5yr LEDs'})}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
11. ${_L({'zh-CN':'免责声明','en':'DISCLAIMER'})}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ${_L({'zh-CN':'本方案基于输入参数自动生成。','en':'This proposal is auto-generated based on the input parameters.'})}
  ${_L({'zh-CN':'所有数据仅供参考。最终工程设计','en':'All figures are for reference only. Final engineering design'})}
  ${_L({'zh-CN':'须经现场勘测和合格工程师确认。','en':'must be confirmed by on-site survey and qualified engineers.'})}
  ${_L({'zh-CN':'数量和价格以正式合同为准。','en':'Quantities and prices are subject to formal contract.'})}

════════════════════════════════════════════════════════════
   ${company}   ·   ${_L({'zh-CN':'技术方案部','en':'Technical Proposal Dept.'})}
   ${_L({'zh-CN':'日期','en':'Date'})}: ${today}
════════════════════════════════════════════════════════════
  `.trim();

  document.getElementById('report_content').textContent = report;
}

// ====================================================
//  下载报告（生成Word文档 .doc）
// ====================================================
function downloadReport() {
  // 先确保数据已计算
  calcHardware(); calcPower(); calcAux();

  const projName = vs('rpt_name') || _L({'zh-CN':'XXX项目','en':'XXX Project'});
  const client = vs('rpt_client') || '';
  const company = vs('rpt_company') || '';
  const location = vs('rpt_location') || '';
  const _mountMap2 = {
    wall: _L({'zh-CN':'墙面固定安装','en':'Wall-mounted'}),
    standalone: _L({'zh-CN':'独立立柱','en':'Freestanding'}),
    hanging: _L({'zh-CN':'悬挂吊装','en':'Hanging'}),
    roof: _L({'zh-CN':'屋顶安装','en':'Roof-mounted'}),
    stage: _L({'zh-CN':'舞台弧形屏','en':'Stage Curved Screen'}),
    curved: _L({'zh-CN':'定制弧形屏','en':'Custom Curved Screen'})
  };
  const mount = _mountMap2[vs('rpt_mount')] || '';
  const _sceneMap2 = {indoor: _L({'zh-CN':'室内','en':'Indoor'}), outdoor: _L({'zh-CN':'室外','en':'Outdoor'}), stage: _L({'zh-CN':'舞台','en':'Stage'}), traffic: _L({'zh-CN':'交通','en':'Traffic'})};
  const scene = _sceneMap2[vs('h_scene')] || '';
  const pitch = G.pitch;
  const today = document.getElementById('rpt_date').value || new Date().toISOString().slice(0,10);
  const projNameClean = (projName || 'LED_Project').replace(/[<>]/g,'');

  // Sender name
  const senderId = vs('h_sender_type');
  let senderName = _L({'zh-CN':'未选择','en':'Not selected'});
  if (senderId && senderId !== '__custom__') {
    const s = DBM.getControls().find(c => c.id === senderId);
    if (s) senderName = s.name;
  }

  // Receiver name
  const recvId = vs('h_recv_type');
  let recvName = _L({'zh-CN':'未选择','en':'Not selected'});
  if (recvId && recvId !== '__custom__') {
    const r = DBM.getRecvCards().find(r => r.id === recvId);
    if (r) recvName = r.name;
  }

  // Video processor
  const vpId = vs('h_vprocessor_type');
  let vpName = '';
  if (vpId && vpId !== '__custom__') {
    const vp = DBM.getVProcessors().find(v => v.id === vpId);
    if (vp) vpName = vp.name;
  }

  // Build HTML document
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style>
body{font-family:Arial,sans-serif;font-size:12pt;color:#333;padding:60px 60px;max-width:1000px;margin:0 auto;line-height:1.6}
h1{text-align:center;font-size:24pt;color:#1a3a5c;letter-spacing:4px;margin-top:80px;margin-bottom:50px;border-top:3px double #1a3a5c;border-bottom:3px double #1a3a5c;padding:20px 0}
h2{font-size:16pt;color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:6px;margin-top:40px}
h3{font-size:13pt;color:#2a5a8c;margin-top:24px;margin-bottom:8px}
table.info{width:100%;border-collapse:collapse;margin:8px 0}
table.info td{padding:4px 8px;border:1px solid #ddd}
table.info td:first-child{background:#f5f7fa;font-weight:bold;width:220px}
.tag{display:inline-block;background:#e8f0fe;color:#1a3a5c;padding:2px 10px;border-radius:3px;font-size:10pt}
.footer{text-align:center;margin-top:60px;padding-top:20px;border-top:2px solid #ccc;color:#888;font-size:10pt}
.page-break{page-break-before:always}
ul{margin:4px 0;padding-left:20px}
li{margin:2px 0}
</style>
</head>
<body>

<h1>${_L({'zh-CN':'LED全彩显示屏技术方案书','en':'LED Full-Color Display Technical Proposal'})}</h1>

<table class="info">
<tr><td>${_L({'zh-CN':'项目名称','en':'Project'})}</td><td>${projName}</td></tr>
<tr><td>${_L({'zh-CN':'客户','en':'Client'})}</td><td>${client}</td></tr>
<tr><td>${_L({'zh-CN':'承包商','en':'Contractor'})}</td><td>${company}</td></tr>
<tr><td>${_L({'zh-CN':'日期','en':'Date'})}</td><td>${today}</td></tr>
<tr><td>${_L({'zh-CN':'地点','en':'Location'})}</td><td>${location}</td></tr>
</table>

<h2>1. ${_L({'zh-CN':'项目概述','en':'Project Overview'})}</h2>
<p>${_L({'zh-CN':'本方案涵盖','en':'This proposal covers the LED display system for'})} ${projName}。${_L({'zh-CN':'安装地点','en':'Installation location'})}: ${location}。${_L({'zh-CN':'安装方式','en':'Mount type'})}: [${mount}]。${_L({'zh-CN':'应用场景','en':'Application'})}: [${scene}${_L({'zh-CN':'屏','en':' Screen'})}]。</p>

<h2>2. ${_L({'zh-CN':'屏幕技术规格','en':'Screen Technical Specifications'})}</h2>
<table class="info">
<tr><td>${_L({'zh-CN':'屏幕尺寸','en':'Screen Size'})}</td><td>${(vt('h_width')/1000).toFixed(2)}m (W) × ${(vt('h_height')/1000).toFixed(2)}m (H)</td></tr>
<tr><td>${_L({'zh-CN':'屏幕面积','en':'Screen Area'})}</td><td>${G.screen_area.toFixed(2)} m²</td></tr>
<tr><td>${_L({'zh-CN':'像素间距','en':'Pixel Pitch'})}</td><td>P${pitch}mm</td></tr>
<tr><td>${_L({'zh-CN':'分辨率','en':'Resolution'})}</td><td>${G.pixels_w} × ${G.pixels_h} px</td></tr>
<tr><td>${_L({'zh-CN':'总像素','en':'Total Pixels'})}</td><td>${(G.total_pixels/10000).toFixed(1)} 万px</td></tr>
<tr><td>${_L({'zh-CN':'像素密度','en':'Pixel Density'})}</td><td>${(1000000/pitch/pitch).toFixed(0)} px/m²</td></tr>
<tr><td>${_L({'zh-CN':'色深','en':'Color Depth'})}</td><td>16-bit (65536 gray levels)</td></tr>
<tr><td>${_L({'zh-CN':'刷新率','en':'Refresh Rate'})}</td><td>≥ 1920 Hz (no blur)</td></tr>
<tr><td>${_L({'zh-CN':'帧率','en':'Frame Rate'})}</td><td>≥ 60 Hz</td></tr>
</table>
<p>◉ ${_L({'zh-CN':'像素结构','en':'Pixel structure'})}: R/G/B LED per pixel.</p>
<p>◉ ${_L({'zh-CN':'亮度','en':'Brightness'})}: ${vs('h_scene') === 'indoor' ? _L({'zh-CN':'室内: 800~2000 nits，随环境光自动调节','en':'Indoor: 800~2000 nits, auto-adjust'}) : vs('h_scene') === 'outdoor' ? _L({'zh-CN':'室外: 最大≥6500 nits，光感自动亮度调节','en':'Outdoor: max ≥ 6500 nits, auto-brightness'}) : _L({'zh-CN':'舞台: 500~1500 nits','en':'Stage: 500~1500 nits'})}</p>

<h2>3. ${_L({'zh-CN':'结构设计','en':'Structural Design'})}</h2>
<table class="info">
<tr><td>${_L({'zh-CN':'模组尺寸','en':'Module Size'})}</td><td>${G.mod_pixel_w}×${G.mod_pixel_h} px/${_L({'zh-CN':'模组','en':'module'})}</td></tr>
<tr><td>${_L({'zh-CN':'箱体尺寸','en':'Cabinet Size'})}</td><td>${G.mod_pixel_w * vt('h_box_mw')}×${G.mod_pixel_h * vt('h_box_mh')} px/${_L({'zh-CN':'箱体','en':'cabinet'})} (${vt('h_box_mw')}×${vt('h_box_mh')} ${_L({'zh-CN':'模组/箱体','en':'modules/cabinet'})})</td></tr>
<tr><td>${_L({'zh-CN':'箱体数量(横)','en':'Cabinets (H)'})}</td><td>${G.box_x} pcs</td></tr>
<tr><td>${_L({'zh-CN':'箱体数量(纵)','en':'Cabinets (V)'})}</td><td>${G.box_y} pcs</td></tr>
<tr><td>${_L({'zh-CN':'箱体总数','en':'Total Cabinets'})}</td><td>${G.total_boxes} pcs</td></tr>
<tr><td>${_L({'zh-CN':'模组总数','en':'Total Modules'})}</td><td>${G.total_modules} pcs</td></tr>
<tr><td>${_L({'zh-CN':'安装方式','en':'Mount Type'})}</td><td>${mount}</td></tr>
<tr><td>${_L({'zh-CN':'防护等级','en':'IP Rating'})}</td><td>${vs('h_scene') === 'outdoor' ? _L({'zh-CN':'IP65 (室外防水)','en':'IP65 (outdoor waterproof)'}) : _L({'zh-CN':'IP40 (室内标准)','en':'IP40 (indoor standard)'})}</td></tr>
<tr><td>${_L({'zh-CN':'材质','en':'Material'})}</td><td>${vs('h_scene') === 'outdoor' ? _L({'zh-CN':'高强度铝合金+防锈处理','en':'High-strength aluminum alloy + anti-rust'}) : _L({'zh-CN':'铝合金/钢喷塑','en':'Al alloy / steel powder coat'})}</td></tr>
<tr><td>${_L({'zh-CN':'工作温度','en':'Operating Temp'})}</td><td>${vs('h_scene') === 'outdoor' ? '-20°C ~ +60°C' : '0°C ~ +50°C'}</td></tr>
</table>

<h2>4. ${_L({'zh-CN':'最佳观看距离','en':'Optimal Viewing Distance'})}</h2>
<table class="info">
<tr><td>${_L({'zh-CN':'最近距离','en':'Min Distance'})}</td><td>${(pitch * (vt('h_k3')||500) / 1000).toFixed(1)} m</td></tr>
<tr><td>${_L({'zh-CN':'最佳距离','en':'Optimal Distance'})}</td><td>${(pitch * (vt('h_k1')||1000) / 1000).toFixed(1)} m (${_L({'zh-CN':'推荐','en':'Recommended'})})</td></tr>
<tr><td>${_L({'zh-CN':'最远距离','en':'Max Distance'})}</td><td>${(pitch * (vt('h_k2')||3500) / 1000).toFixed(1)} m</td></tr>
</table>
<p>${_L({'zh-CN':'公式','en':'Formula'})}: ${_L({'zh-CN':'最佳距离 = 像素间距 ×','en':'Optimal = P ×'})} ${vt('h_k1')||1000} (P = ${_L({'zh-CN':'像素间距(mm)','en':'pixel pitch in mm'})})</p>

<h2>5. ${_L({'zh-CN':'控制系统','en':'Control System'})}</h2>
<table class="info">
<tr><td>${_L({'zh-CN':'信号流','en':'Signal Flow'})}</td><td>PC → ${_L({'zh-CN':'发送卡','en':'Sender'})} → ${_L({'zh-CN':'接收卡','en':'Receiver'})} → ${_L({'zh-CN':'模组','en':'Module'})}</td></tr>
<tr><td>${_L({'zh-CN':'发送卡型号','en':'Sender Model'})}</td><td>${senderName}</td></tr>
<tr><td>${_L({'zh-CN':'发送卡数量','en':'Sender Qty'})}</td><td>${G.senders} pcs${G.senders > 1 ? ' (' + _L({'zh-CN':'级联','en':'Cascade'}) + ': ' + G.senders + ' ' + _L({'zh-CN':'同步级联','en':'in sync'}) + ')' : ' (' + _L({'zh-CN':'单卡','en':'Single card'}) + ')'}</td></tr>
<tr><td>${_L({'zh-CN':'接收卡型号','en':'Receiver Model'})}</td><td>${recvName}</td></tr>
<tr><td>${_L({'zh-CN':'接收卡数量','en':'Receiver Qty'})}</td><td>${G.receivers} pcs</td></tr>
<tr><td>${_L({'zh-CN':'视频处理器','en':'Video Processor'})}</td><td>${vpName || _L({'zh-CN':'未配置','en':'Not configured'})}</td></tr>
<tr><td>${_L({'zh-CN':'控制电脑','en':'Control PC'})}</td><td>1 ${_L({'zh-CN':'台','en':'unit'})} (${_L({'zh-CN':'含LED控制软件','en':'incl. LED control software'})})</td></tr>
</table>

<h2>6. ${_L({'zh-CN':'电力与配电系统','en':'Power & Distribution System'})}</h2>
<h3>6.1 ${_L({'zh-CN':'电力参数','en':'Power Parameters'})}</h3>
<table class="info">
<tr><td>${_L({'zh-CN':'最大功率(全白)','en':'Max Power (full white)'})}</td><td>${(G.max_power_total/1000).toFixed(2)} kW</td></tr>
<tr><td>${_L({'zh-CN':'典型功率','en':'Typical Power'})}</td><td>${(G.avg_power_total/1000).toFixed(2)} kW</td></tr>
<tr><td>${_L({'zh-CN':'最大功耗密度','en':'Max Power Density'})}</td><td>${(G.max_power_total/G.screen_area).toFixed(0)} W/m²</td></tr>
<tr><td>${_L({'zh-CN':'配电容量(×1.25)','en':'Distribution Capacity (×1.25)'})}</td><td>${(G.max_power_total/1000*1.25).toFixed(2)} kW</td></tr>
</table>

<h3>6.2 ${_L({'zh-CN':'电源配置','en':'PSU Configuration'})}</h3>
<table class="info">
<tr><td>${_L({'zh-CN':'电源规格','en':'PSU Spec'})}</td><td>${G.psu_rated}W ${_L({'zh-CN':'开关电源，5V直流输出','en':'switching PSU, 5V DC'})}</td></tr>
<tr><td>${_L({'zh-CN':'电源数量','en':'PSU Qty'})}</td><td>${G.psu_count} pcs (N+${vs('p_redundancy')} ${_L({'zh-CN':'冗余','en':'redundancy'})})</td></tr>
<tr><td>${_L({'zh-CN':'电源总功率','en':'Total PSU Power'})}</td><td>${(G.psu_count * G.psu_rated / 1000).toFixed(1)} kW</td></tr>
</table>

<h3>6.3 ${_L({'zh-CN':'线缆规格','en':'Cable Specifications'})}</h3>
<p>◉ ${_L({'zh-CN':'主回路电缆','en':'Main Circuit Cable'})}: ≥ ${G.min_cable_mm} mm² (${_L({'zh-CN':'铜阻燃','en':'Cu flame-retardant'})})<br>
◉ ${_L({'zh-CN':'控制信号','en':'Control Signal'})}: CAT6 ${_L({'zh-CN':'屏蔽双绞线','en':'shielded twisted pair'})}<br>
◉ ${_L({'zh-CN':'配电箱','en':'Distribution Panel'})}: ${_L({'zh-CN':'含断路器、漏电保护、浪涌保护','en':'incl. circuit breakers, RCD, surge protection'})}</p>

<h2>7. ${_L({'zh-CN':'辅助系统','en':'Auxiliary Systems'})}</h2>
<h3>7.1 ${_L({'zh-CN':'散热管理','en':'Thermal Management'})}</h3>
<table class="info">
<tr><td>${_L({'zh-CN':'散热量','en':'Heat Dissipation'})}</td><td>${(G.heat_watts/1000).toFixed(2)} kW</td></tr>
<tr><td>${_L({'zh-CN':'散热方式','en':'Cooling Method'})}</td><td>${G.cool_type_name || (vs('a_cool_type') === 'natural' ? _L({'zh-CN':'自然冷却','en':'Natural cooling'}) : vs('a_cool_type') === 'forced' ? _L({'zh-CN':'强制风冷','en':'Forced air'}) : vs('a_cool_type') === 'ac' ? _L({'zh-CN':'空调制冷','en':'Air conditioning'}) : _L({'zh-CN':'自然冷却','en':'Natural cooling'}))}</td></tr>
${G.fans > 0 ? '<tr><td>' + _L({'zh-CN':'散热风扇','en':'Cooling Fans'}) + '</td><td>' + G.fans + ' ' + _L({'zh-CN':'台轴流风扇','en':'axial fan(s)'}) + '</td></tr>' : ''}
${G.ac_units > 0 ? '<tr><td>' + _L({'zh-CN':'空调','en':'AC Units'}) + '</td><td>' + G.ac_units + ' ' + _L({'zh-CN':'台','en':'unit(s)'}) + ' (' + (G.ac_model || '') + ')</td></tr>' : ''}
<tr><td>${_L({'zh-CN':'最高环境温度','en':'Max Ambient Temp'})}</td><td>${vt('a_env_temp')} °C</td></tr>
</table>

<h3>7.2 ${_L({'zh-CN':'音频系统','en':'Audio System'})}</h3>
<table class="info">
<tr><td>${_L({'zh-CN':'音箱','en':'Speakers'})}</td><td>${G.speakers} pcs (${vs('a_speaker_w')}W ${_L({'zh-CN':'全频','en':'full-range'})})</td></tr>
<tr><td>${_L({'zh-CN':'功放功率','en':'Amplifier Power'})}</td><td>≥ ${G.amp_power.toFixed(0)} W</td></tr>
<tr><td>${_L({'zh-CN':'覆盖面积','en':'Coverage Area'})}</td><td>${vt('a_area')} m²</td></tr>
<tr><td>${_L({'zh-CN':'目标声压级','en':'Target SPL'})}</td><td>${parseInt(vs('a_noise')) + vt('a_snr')} dB</td></tr>
</table>

<h2>8. ${_L({'zh-CN':'物料汇总(BOM)','en':'Materials Summary (BOM)'})}</h2>
<table class="info">
<tr><td>${_L({'zh-CN':'LED模组','en':'LED Modules'})}</td><td>${G.total_modules} pcs</td></tr>
<tr><td>${_L({'zh-CN':'LED箱体','en':'LED Cabinets'})}</td><td>${G.total_boxes} pcs</td></tr>
<tr><td>${_L({'zh-CN':'发送卡','en':'Sender Cards'})}</td><td>${G.senders} pcs</td></tr>
<tr><td>${_L({'zh-CN':'接收卡','en':'Receiver Cards'})}</td><td>${G.receivers} pcs</td></tr>
<tr><td>${_L({'zh-CN':'开关电源','en':'Switching PSUs'})}</td><td>${G.psu_count} pcs (${G.psu_rated}W ${_L({'zh-CN':'每台','en':'each'})})</td></tr>
${vpName ? '<tr><td>' + _L({'zh-CN':'视频处理器','en':'Video Processor'}) + '</td><td>' + vpName + '</td></tr>' : ''}
<tr><td>${_L({'zh-CN':'控制电脑','en':'Control PC'})}</td><td>1 ${_L({'zh-CN':'台','en':'unit'})}</td></tr>
${G.fans > 0 ? '<tr><td>' + _L({'zh-CN':'散热风扇','en':'Cooling Fans'}) + '</td><td>' + G.fans + ' pcs</td></tr>' : ''}
${G.ac_units > 0 ? '<tr><td>' + _L({'zh-CN':'空调','en':'Air Conditioner'}) + '</td><td>' + G.ac_units + ' ' + _L({'zh-CN':'台','en':'unit(s)'}) + '</td></tr>' : ''}
<tr><td>${_L({'zh-CN':'音箱','en':'Speakers'})}</td><td>${G.speakers} pcs</td></tr>
</table>
<p>${_L({'zh-CN':'详见附件BOM完整物料清单','en':'See attached BOM for full material list'})}</p>

<h2>9. ${_L({'zh-CN':'安全与认证','en':'Safety & Certifications'})}</h2>
<ul>
<li>${_L({'zh-CN':'认证','en':'Certifications'})}: CE / RoHS / 3C / ISO9001</li>
<li>${_L({'zh-CN':'电气安全','en':'Electrical Safety'})}: ${_L({'zh-CN':'符合GB/T 17626.x EMC标准','en':'Compliant with GB/T 17626.x EMC standards'})}</li>
<li>${_L({'zh-CN':'结构安全','en':'Structural Safety'})}: ${_L({'zh-CN':'钢结构符合GB50017，抗风≥10级','en':'Steel structure per GB50017, wind-resistant ≥ Level 10'})}</li>
<li>${_L({'zh-CN':'接地','en':'Grounding'})}: ${_L({'zh-CN':'所有金属部件可靠接地，接地电阻≤4Ω','en':'All metal parts reliably grounded, resistance ≤ 4Ω'})}</li>
<li>${_L({'zh-CN':'防雷保护','en':'Lightning Protection'})}: ${_L({'zh-CN':'电源与信号均安装浪涌保护器','en':'Power and signal surge protectors installed'})}</li>
</ul>

<h2>10. ${_L({'zh-CN':'安装与验收','en':'Installation & Acceptance'})}</h2>
<ul>
<li>${_L({'zh-CN':'安装','en':'Installation'})}: ${_L({'zh-CN':'由持证技术人员现场安装','en':'By certified technicians on-site'})}</li>
<li>${_L({'zh-CN':'验收标准','en':'Acceptance Standard'})}: SJ/T 11281 ${_L({'zh-CN':'LED显示屏通用规范','en':'LED Display General Specification'})}</li>
<li>${_L({'zh-CN':'培训','en':'Training'})}: ${_L({'zh-CN':'完工后提供操作人员培训','en':'Operator training provided upon completion'})}</li>
<li>${_L({'zh-CN':'质保','en':'Warranty'})}: ${_L({'zh-CN':'系统2年 / 模组3年 / LED灯5年','en':'2yr system / 3yr modules / 5yr LEDs'})}</li>
</ul>

<h2>11. ${_L({'zh-CN':'免责声明','en':'Disclaimer'})}</h2>
<p>${_L({'zh-CN':'本方案基于输入参数自动生成。所有数据仅供参考。最终工程设计须经现场勘测和合格工程师确认。数量和价格以正式合同为准。','en':'This proposal is auto-generated based on the input parameters. All figures are for reference only. Final engineering design must be confirmed by on-site survey and qualified engineers. Quantities and prices are subject to formal contract.'})}</p>

<div class="footer">
${company} · ${_L({'zh-CN':'技术方案部','en':'Technical Proposal Dept.'})}<br>
${_L({'zh-CN':'日期','en':'Date'})}: ${today}
</div>

</body>
</html>`;

  const blob = new Blob(['\uFEFF' + html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const isZh2 = document.documentElement.lang === 'zh-CN';
  a.download = isZh2 ? `LED显示屏技术方案书_${projNameClean}.doc` : `LED_Display_Proposal_${projNameClean}.doc`;
  a.click(); URL.revokeObjectURL(url);
}

// ====================================================
//  视频处理器输出像素自动计算
// ====================================================
function calcVpOutputPx() {
  const w = parseFloat(document.getElementById('dbmf_resW')?.value) || 0;
  const h = parseFloat(document.getElementById('dbmf_resH')?.value) || 0;
  const el = document.getElementById('dbmf_outputPx');
  if (el) el.value = w > 0 && h > 0 ? (w * h).toLocaleString() : '';
}

// ====================================================
//  数据管理模块 (DBM - Database Management)
// ====================================================
const DBM = {
  STORAGE_KEY: 'led_proj_db_v1',

  // ---- 默认数据 ----
  DEFAULTS: {
    cabinet: [
      { id:'c01', name:'室外标准箱 960×960', width_mm:960, height_mm:960, category:'室外常规', remark:'最常用户外箱体' },
      { id:'c02', name:'室外半箱 960×480', width_mm:960, height_mm:480, category:'室外常规', remark:'上下拼接屏下半屏' },
      { id:'c03', name:'室外宽箱 1280×960', width_mm:1280, height_mm:960, category:'室外大型', remark:'大型户外传媒屏' },
      { id:'c04', name:'室外宽箱 1920×960', width_mm:1920, height_mm:960, category:'室外大型', remark:'大型户外传媒屏' },
      { id:'c05', name:'室外中箱 768×768', width_mm:768, height_mm:768, category:'室外常规', remark:'中小型户外屏' },
      { id:'c06', name:'室外小箱 640×640', width_mm:640, height_mm:640, category:'室外常规', remark:'小型项目' },
      { id:'c07', name:'室外小箱 512×512', width_mm:512, height_mm:512, category:'室外常规', remark:'小间距项目' },
      { id:'c08', name:'室内精细箱 576×576', width_mm:576, height_mm:576, category:'室内精细', remark:'P3以下室内屏' },
      { id:'c09', name:'室内标准箱 480×480', width_mm:480, height_mm:480, category:'室内标准', remark:'室内常规屏' },
      { id:'c10', name:'室内小箱 400×400', width_mm:400, height_mm:400, category:'室内标准', remark:'小尺寸室内屏' },
      { id:'c11', name:'租赁箱 500×500', width_mm:500, height_mm:500, category:'舞台租赁', remark:'舞台演出/展会最常用' },
      { id:'c12', name:'租赁箱 500×1000竖版', width_mm:500, height_mm:1000, category:'舞台租赁', remark:'竖版租赁屏主规格' },
      { id:'c13', name:'租赁箱 1000×500横版', width_mm:1000, height_mm:500, category:'舞台租赁', remark:'横版租赁屏' },
      { id:'c14', name:'交通诱导箱 640×640', width_mm:640, height_mm:640, category:'交通诱导', remark:'交通诱导屏专用' },
      { id:'c15', name:'交通诱导箱 960×960', width_mm:960, height_mm:960, category:'交通诱导', remark:'大型交通屏' },
    ],
    module: [
      { id:'m01', name:'室内模组 64×64', pixelW:64, pixelH:64, width_mm:160, height_mm:160, ledType:'SMD2121', power:10, remark:'P2.5室内常用' },
      { id:'m02', name:'室内模组 64×32', pixelW:64, pixelH:32, width_mm:160, height_mm:80, ledType:'SMD2121', power:10, remark:'P2.5室内标准' },
      { id:'m03', name:'半户外模组 64×32', pixelW:64, pixelH:32, width_mm:160, height_mm:80, ledType:'SMD3528', power:12, remark:'半户外P5/P6' },
      { id:'m04', name:'户外模组 32×16', pixelW:32, pixelH:16, width_mm:160, height_mm:80, ledType:'SMD2727', power:15, remark:'户外P4/P5最常用' },
      { id:'m05', name:'户外模组 32×16加大', pixelW:32, pixelH:16, width_mm:200, height_mm:100, ledType:'SMD2727', power:18, remark:'高亮户外P5/P6' },
      { id:'m06', name:'户外模组 64×32', pixelW:64, pixelH:32, width_mm:320, height_mm:160, ledType:'SMD2727', power:30, remark:'户外P5大模组' },
      { id:'m07', name:'P10户外模组 32×16', pixelW:32, pixelH:16, width_mm:160, height_mm:80, ledType:'DIP346', power:20, remark:'P10单红/全彩' },
      { id:'m08', name:'P16户外模组 32×16', pixelW:32, pixelH:16, width_mm:256, height_mm:128, ledType:'DIP346', power:25, remark:'P16户外标贴' },
      { id:'m09', name:'舞台租赁 64×64', pixelW:64, pixelH:64, width_mm:256, height_mm:256, ledType:'SMD2121', power:20, remark:'舞台高清屏' },
      { id:'m10', name:'超小间距 80×45', pixelW:80, pixelH:45, width_mm:150, height_mm:84, ledType:'SMD1515', power:8, remark:'P1.875超高清屏' },
    ],
    control: [
      { id:'ctrl01', name:'诺瓦 MSD600发送卡', type:'发送设备', capacity:130, capacityUnit:'万px', ports:2, remark:'入门级，130万像素' },
      { id:'ctrl02', name:'诺瓦 H2发送卡', type:'发送设备', capacity:260, capacityUnit:'万px', ports:2, remark:'2路输出，高端项目' },
      { id:'ctrl03', name:'诺瓦 H5发送卡', type:'发送设备', capacity:230, capacityUnit:'万px', ports:4, remark:'H系列新平台' },
      { id:'ctrl04', name:'科彩 E2发送卡', type:'发送设备', capacity:170, capacityUnit:'万px', ports:4, remark:'高性价比' },
      { id:'ctrl05', name:'领信 TS802发送卡', type:'发送设备', capacity:192, capacityUnit:'万px', ports:4, remark:'4网口输出' },
      { id:'ctrl06', name:'诺瓦 MRV328接收卡', type:'接收卡', capacity:8, capacityUnit:'模组', remark:'最常用，8模组带载' },
      { id:'ctrl07', name:'诺瓦 MRV416接收卡', type:'接收卡', capacity:16, capacityUnit:'模组', remark:'16模组长带载' },
      { id:'ctrl08', name:'科彩 5A-75接收卡', type:'接收卡', capacity:8, capacityUnit:'模组', remark:'高刷新版' },
      { id:'ctrl09', name:'领信 RV908接收卡', type:'接收卡', capacity:8, capacityUnit:'模组', remark:'稳定可靠' },
      { id:'ctrl10', name:'诺瓦 MX40发送卡', type:'发送设备', capacity:400, capacityUnit:'万px', ports:8, remark:'旗舰级4K发送' },
      { id:'ctrl11', name:'诺瓦 VP880视频处理器', type:'视频处理器', capacity:800, capacityUnit:'万px', remark:'大型活动现场' },
      { id:'ctrl12', name:'兆光辉 4K视频处理器', type:'视频处理器', capacity:1200, capacityUnit:'万px', remark:'4K超高清' },
      { id:'ctrl13', name:'唯奥 8路视频处理器', type:'视频处理器', capacity:600, capacityUnit:'万px', remark:'多信号切换' },
    ],
    vprocessor: [
      { id:'vp01', name:'视诚 VSP 4K视频处理器', type:'视频处理器', resW:3840, resH:2160, outputType:'DVI', outputCount:4, sendOutputs:4, remark:'4路DVI输出，支持4K输入' },
      { id:'vp02', name:'迈普视通 LED-550D视频拼接器', type:'视频拼接器', resW:1920, resH:1080, outputType:'网口', outputCount:8, sendOutputs:8, remark:'8路网口输出，需外接发送卡' },
      { id:'vp03', name:'唯奥 LVP605视频处理器', type:'视频处理器', resW:1920, resH:1080, outputType:'DVI', outputCount:2, sendOutputs:2, remark:'双DVI输出，支持画中画' },
      { id:'vp04', name:'凯莱 VH4视频拼接器', type:'视频拼接器', resW:1920, resH:1200, outputType:'HDMI', outputCount:4, sendOutputs:4, remark:'4画面拼接，支持异形拼接' },
      { id:'vp05', name:'迈普视通 V6切换台', type:'切换台', resW:1920, resH:1080, outputType:'SDI', outputCount:2, sendOutputs:2, remark:'广电级切换台，SDI输出' },
    ],
    recvcard: [
      { id:'rc01', name:'诺瓦 MRV338接收卡', interfaceType:'HUB75E', interfaceCount:12, capW:512, capH:512, remark:'室内常用，12个HUB75E接口' },
      { id:'rc02', name:'诺瓦 MRV416接收卡', interfaceType:'HUB75E', interfaceCount:16, capW:512, capH:640, remark:'16接口，高密度屏' },
      { id:'rc03', name:'诺瓦 MRV3Pro接收卡', interfaceType:'HUB75', interfaceCount:24, capW:512, capH:768, remark:'24接口，超大带载' },
      { id:'rc04', name:'科彩 C5接收卡', interfaceType:'HUB75E', interfaceCount:12, capW:512, capH:512, remark:'高性价比室内卡' },
      { id:'rc05', name:'科彩 C5L接收卡', interfaceType:'HUB75E', interfaceCount:16, capW:640, capH:512, remark:'宽屏适配' },
      { id:'rc06', name:'领信 RV908M接收卡', interfaceType:'HUB75E', interfaceCount:12, capW:512, capH:512, remark:'稳定可靠，户外常用' },
      { id:'rc07', name:'领信 RV908N接收卡', interfaceType:'HUB75', interfaceCount:20, capW:512, capH:640, remark:'新平台，高刷新' },
      { id:'rc08', name:'灵信 LS-S5接收卡', interfaceType:'HUB75E', interfaceCount:12, capW:512, capH:512, remark:'入门级，高性价比' },
    ],
    psu: [
      { id:'psu01', name:'LED电源 200W 5V', ratedW:200, outputV:5, remark:'最常用规格' },
      { id:'psu02', name:'LED电源 300W 5V', ratedW:300, outputV:5, remark:'高功率户外箱体' },
      { id:'psu03', name:'LED电源 400W 5V', ratedW:400, outputV:5, remark:'大功率户外箱体' },
      { id:'psu04', name:'LED电源 150W 5V', ratedW:150, outputV:5, remark:'小功率室内模组' },
      { id:'psu05', name:'LED电源 100W 5V', ratedW:100, outputV:5, remark:'小间距精细模组' },
    ],
  },

  // ---- 存储读写 ----
  _load() {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    if(raw) {
      try { return JSON.parse(raw); } catch(e) { return null; }
    }
    return null;
  },
  _save(data) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  },
  _getDB() {
    const d = this._load();
    return d || JSON.parse(JSON.stringify(this.DEFAULTS));
  },

  // ---- 初始化 ----
  init() {
    let d = this._load();
    if(!d) {
      // 首次使用，写入默认数据
      d = JSON.parse(JSON.stringify(this.DEFAULTS));
      this._save(d);
    } else {
      // 确保新字段存在（兼容旧数据）
      const defaults = this.DEFAULTS;
      Object.keys(defaults).forEach(key => {
        if(!d[key]) d[key] = JSON.parse(JSON.stringify(defaults[key]));
      });
      this._save(d);
    }
    this._renderAll();
  },

  // ---- 渲染全部表格 ----
  _renderAll() {
    ['cabinet','module','control','psu','vprocessor','recvcard'].forEach(t => this._renderTable(t));
  },

  // ---- 渲染单个表 ----
  _renderTable(type) {
    const data = this._getDB()[type] || [];
    const tbody = document.getElementById('dbm_tbody_' + type);
    const countEl = document.getElementById('dbm_count_' + type);
    if(!tbody) return;
    if(data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="20" class="dbm-empty">${_L({'zh-CN':'暂无数据。点击工具栏中的"添加"按钮进行添加。','en':'No data. Click "Add" button in the toolbar to add.'})}</td></tr>`;
      if(countEl) countEl.textContent = '';
      return;
    }
    if(countEl) countEl.textContent = data.length + ' ' + _L({'zh-CN':'条','en':'items'});
    let html = '';
    data.forEach(item => {
      try {
        html += `<tr>${this._renderRow(type, item)}</tr>`;
      } catch(e) {
        console.error('Render error for item:', item, e);
        html += `<tr><td colspan="20" style="color:red">Render error: ${e.message}</td></tr>`;
      }
    });
    tbody.innerHTML = html;
  },

  _renderRow(type, item) {
    const id = item.id;
const editBtn = `<button class="btn-edit" onclick="DBM.editItem('${type}','${id}')">✏️ ${_L({'zh-CN':'编辑','en':'Edit'})}</button>`;
const delBtn  = `<button class="btn-del" onclick="DBM.confirmDelete('${type}','${id}')">🗑️ ${_L({'zh-CN':'删除','en':'Delete'})}</button>`;
    switch(type) {
      case 'cabinet':
        return `<td>${item.name}</td>
          <td>${item.width_mm}×${item.height_mm}</td>
          <td>${item.category||''}</td>
          <td style="font-size:12px;color:#546E7A">${item.remark||''}</td>
          <td>${editBtn}${delBtn}</td>`;
      case 'module':
        return `<td>${item.name}</td>
          <td>${item.pixelW}×${item.pixelH}</td>
          <td>${item.width_mm}×${item.height_mm}</td>
          <td>${item.ledType||''}</td>
          <td>${item.power||10}W</td>
          <td style="font-size:12px;color:#546E7A">${item.remark||''}</td>
          <td>${editBtn}${delBtn}</td>`;
      case 'control':
        // 类型名称兼容映射（旧数据兼容）
        const typeMap = { 'sender':'Sender','receiver':'Receiver','异步卡':'Async Card','播放盒':'Play Box','同异步播放盒':'Sync/Async Box','视频处理器':'Video Processor','发送设备':'Sender','接收卡':'Receiver' };
        const displayType = typeMap[item.type] || item.type || '';
        const portsDisplay = (item.ports || item.ports === 0) ? item.ports + ' ports' : '-';
        return `<td>${item.name}</td>
          <td>${displayType}</td>
          <td>${item.capacity} ${item.capacityUnit||''}</td>
          <td>${portsDisplay}</td>
          <td style="font-size:12px;color:#546E7A">${item.remark||''}</td>
          <td>${editBtn}${delBtn}</td>`;
      case 'psu':
        return `<td>${item.name}</td>
          <td>${item.ratedW}W</td>
          <td>${item.outputV}V</td>
          <td style="font-size:12px;color:#546E7A">${item.remark||''}</td>
          <td>${editBtn}${delBtn}</td>`;
      case 'vprocessor':
        return `<td>${item.name}</td>
          <td>${item.type||''}</td>
          <td>${item.resW||'-'} × ${item.resH||'-'}</td>
          <td>${((item.resW||0)*(item.resH||0)).toLocaleString()}</td>
          <td>${item.sendOutputs||item.outputCount||1} outputs</td>
          <td>${item.outputType||''} × ${item.outputCount||1}</td>
          <td style="font-size:12px;color:#546E7A">${item.remark||''}</td>
          <td>${editBtn}${delBtn}</td>`;
      case 'recvcard':
        return `<td>${item.name}</td>
          <td>${item.interfaceType||''}</td>
          <td>${item.interfaceCount||0}</td>
          <td>${item.capW||0} × ${item.capH||0}</td>
          <td style="font-size:12px;color:#546E7A">${item.remark||''}</td>
          <td>${editBtn}${delBtn}</td>`;
      default: return '';
    }
  },

  // ---- 子Tab切换 ----
  currentSub: 'cabinet',
  switchSub(type) {
    this.currentSub = type;
    document.querySelectorAll('.dbm-panel').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.dbm-subtab').forEach(b => b.classList.remove('active'));
    document.getElementById('dbm-panel-' + type).style.display = 'block';
    document.getElementById('dbm_btn_' + type).classList.add('active');
  },

  // ---- 新增/编辑 ----
  editItem(type, id) {
    const db = this._getDB();
    const item = id ? db[type].find(x => x.id === id) : null;
    const isEdit = !!item;
    const titles = {
      cabinet: _L({'zh-CN':'箱体规格','en':'Cabinet Spec'}),
      module: _L({'zh-CN':'模组规格','en':'Module Spec'}),
      control: _L({'zh-CN':'控制系统','en':'Control System'}),
      led: _L({'zh-CN':'LED规格','en':'LED Spec'}),
      psu: _L({'zh-CN':'电源规格','en':'PSU Spec'}),
      vprocessor: _L({'zh-CN':'视频处理器','en':'Video Processor'}),
      recvcard: _L({'zh-CN':'接收卡','en':'Receiver Card'}),
    };
    document.getElementById('dbm_modal_title').textContent = isEdit ? `✏️ ${_L({'zh-CN':'编辑','en':'Edit'})} ${titles[type]}` : `➕ ${_L({'zh-CN':'添加','en':'Add'})} ${titles[type]}`;

    let form = '';
    switch(type) {
      case 'cabinet':
        form = `<div class="dbm-form-grid">
          <div class="dbm-form-group dbm-form-full">
            <label>Name *</label>
            <input type="text" id="dbmf_name" value="${item?.name||''}" placeholder="e.g. Outdoor Standard 960×960">
          </div>
          <div class="dbm-form-group">
            <label>Cabinet Width (mm)</label>
            <input type="number" id="dbmf_w" value="${item?.width_mm||960}">
          </div>
          <div class="dbm-form-group">
            <label>Cabinet Height (mm)</label>
            <input type="number" id="dbmf_h" value="${item?.height_mm||960}">
          </div>
          <div class="dbm-form-group">
            <label>Category</label>
            <select id="dbmf_cat">
              <option value="室外常规" ${item?.category==='室外常规'?'selected':''}>Outdoor Standard</option>
              <option value="室外大型" ${item?.category==='室外大型'?'selected':''}>Outdoor Large</option>
              <option value="室内标准" ${item?.category==='室内标准'?'selected':''}>Indoor Standard</option>
              <option value="室内精细" ${item?.category==='室内精细'?'selected':''}>Indoor Fine Pitch</option>
              <option value="舞台租赁" ${item?.category==='舞台租赁'?'selected':''}>Stage Rental</option>
              <option value="交通诱导" ${item?.category==='交通诱导'?'selected':''}>Traffic Guide</option>
              <option value="其他" ${item?.category==='其他'?'selected':''}>Other</option>
            </select>
          </div>
          <div class="dbm-form-group dbm-form-full">
            <label>Note</label>
            <input type="text" id="dbmf_remark" value="${item?.remark||''}" placeholder="Optional">
          </div>
        </div>`;
        break;
      case 'module':
        form = `<div class="dbm-form-grid">
          <div class="dbm-form-group dbm-form-full">
            <label>Name *</label>
            <input type="text" id="dbmf_name" value="${item?.name||''}" placeholder="e.g. Outdoor Module 32×16">
          </div>
          <div class="dbm-form-group">
            <label>Pixel Width (px)</label>
            <input type="number" id="dbmf_pw" value="${item?.pixelW||32}">
          </div>
          <div class="dbm-form-group">
            <label>Pixel Height (px)</label>
            <input type="number" id="dbmf_ph" value="${item?.pixelH||16}">
          </div>
          <div class="dbm-form-group">
            <label>Physical Width (mm)</label>
            <input type="number" id="dbmf_w" value="${item?.width_mm||160}">
          </div>
          <div class="dbm-form-group">
            <label>Physical Height (mm)</label>
            <input type="number" id="dbmf_h" value="${item?.height_mm||80}">
          </div>
          <div class="dbm-form-group">
            <label>LED Type</label>
            <input type="text" id="dbmf_led" value="${item?.ledType||''}" placeholder="e.g. SMD2121">
          </div>
          <div class="dbm-form-group">
            <label>Power per Module (W)</label>
            <input type="number" id="dbmf_pow" value="${item?.power||10}" step="0.1">
          </div>
          <div class="dbm-form-group dbm-form-full">
            <label>Note</label>
            <input type="text" id="dbmf_remark" value="${item?.remark||''}" placeholder="Optional">
          </div>
        </div>`;
        break;
      case 'control':
        const _defUnit = item?.capacityUnit || '万px';
        form = `<div class="dbm-form-grid">
          <div class="dbm-form-group dbm-form-full">
            <label>Name *</label>
            <input type="text" id="dbmf_name" value="${item?.name||''}" placeholder="e.g. Nova MSD600 Sender">
          </div>
          <div class="dbm-form-group">
            <label>Type</label>
            <select id="dbmf_type" onchange="DBM._onTypeChange(this.value)">
              <option value="发送设备" ${item?.type==='发送设备'?'selected':''}>Sender</option>
              <option value="异步卡" ${item?.type==='异步卡'?'selected':''}>Async Card</option>
              <option value="播放盒" ${item?.type==='播放盒'?'selected':''}>Play Box</option>
              <option value="同异步播放盒" ${item?.type==='同异步播放盒'?'selected':''}>Sync/Async Box</option>
              <option value="视频处理器" ${item?.type==='视频处理器'?'selected':''}>Video Processor</option>
            </select>
          </div>
          <div class="dbm-form-group">
            <label>Capacity *</label>
            <input type="number" id="dbmf_cap" value="${item?.capacity||8}">
          </div>
          <div class="dbm-form-group">
            <label>Unit</label>
            <select id="dbmf_capunit">
              <option value="万px" ${_defUnit==='万px'?'selected':''}>万px</option>
              <option value="px" ${_defUnit==='px'?'selected':''}>px</option>
            </select>
          </div>
          <div class="dbm-form-group">
            <label>Network Ports</label>
            <input type="number" id="dbmf_ports" value="${item?.ports||4}" min="1" max="16">
          </div>
          <div class="dbm-form-group dbm-form-full">
            <label>Note</label>
            <input type="text" id="dbmf_remark" value="${item?.remark||''}" placeholder="Optional">
          </div>
        </div>`;
        break;
      case 'psu':
        form = `<div class="dbm-form-grid">
          <div class="dbm-form-group dbm-form-full">
            <label>Name *</label>
            <input type="text" id="dbmf_name" value="${item?.name||''}" placeholder="e.g. LED PSU 200W 5V">
          </div>
          <div class="dbm-form-group">
            <label>Rated Power (W)</label>
            <input type="number" id="dbmf_w" value="${item?.ratedW||200}">
          </div>
          <div class="dbm-form-group">
            <label>Output Voltage (V)</label>
            <select id="dbmf_v">
              <option value="5" ${item?.outputV==5?'selected':''}>5V</option>
              <option value="3.8" ${item?.outputV==3.8?'selected':''}>3.8V</option>
              <option value="4.2" ${item?.outputV==4.2?'selected':''}>4.2V</option>
              <option value="12" ${item?.outputV==12?'selected':''}>12V</option>
            </select>
          </div>
          <div class="dbm-form-group dbm-form-full">
            <label>Note</label>
            <input type="text" id="dbmf_remark" value="${item?.remark||''}" placeholder="Optional">
          </div>
        </div>`;
        break;
      case 'vprocessor':
        form = `<div class="dbm-form-grid">
          <div class="dbm-form-group dbm-form-full">
            <label>Name *</label>
            <input type="text" id="dbmf_name" value="${item?.name||''}" placeholder="e.g. Xtrill VSP 4K Processor">
          </div>
          <div class="dbm-form-group">
            <label>Type</label>
            <select id="dbmf_vtype">
              <option value="视频处理器" ${item?.type==='视频处理器'?'selected':''}>Video Processor</option>
              <option value="视频拼接器" ${item?.type==='视频拼接器'?'selected':''}>Video Wall Controller</option>
              <option value="切换台" ${item?.type==='切换台'?'selected':''}>Switcher</option>
            </select>
          </div>
          <div class="dbm-form-group">
            <label>Max Output Width (px)</label>
            <input type="number" id="dbmf_resW" value="${item?.resW||1920}" placeholder="e.g. 1920" oninput="calcVpOutputPx()">
          </div>
          <div class="dbm-form-group">
            <label>Max Output Height (px)</label>
            <input type="number" id="dbmf_resH" value="${item?.resH||1080}" placeholder="e.g. 1080" oninput="calcVpOutputPx()">
          </div>
          <div class="dbm-form-group">
            <label>Output Pixels</label>
            <input type="number" id="dbmf_outputPx" value="${item?.resW && item?.resH ? item.resW*item.resH : ''}" placeholder="Auto-calculated" readonly style="background:#F0F7FF;color:var(--primary);font-weight:600">
          </div>
          <div class="dbm-form-group">
            <label>Output Interface</label>
            <select id="dbmf_outputType">
              <option value="DVI" ${item?.outputType==='DVI'?'selected':''}>DVI</option>
              <option value="HDMI" ${item?.outputType==='HDMI'?'selected':''}>HDMI</option>
              <option value="SDI" ${item?.outputType==='SDI'?'selected':''}>SDI</option>
              <option value="DP" ${item?.outputType==='DP'?'selected':''}>DP (DisplayPort)</option>
              <option value="网口" ${item?.outputType==='网口'?'selected':''}>RJ45 Network Port</option>
              <option value="光纤" ${item?.outputType==='光纤'?'selected':''}>Fiber Optic</option>
            </select>
          </div>
          <div class="dbm-form-group">
            <label>Output Port Count</label>
            <input type="number" id="dbmf_outputCount" value="${item?.outputCount||1}" min="1" max="32">
          </div>
          <div class="dbm-form-group">
            <label>Send Output Count</label>
            <input type="number" id="dbmf_sendOutputs" value="${item?.sendOutputs||1}" min="1" max="32" placeholder="Max sender cards it can drive">
          </div>
          <div class="dbm-form-group dbm-form-full">
            <label>Note</label>
            <input type="text" id="dbmf_remark" value="${item?.remark||''}" placeholder="Optional">
          </div>
        </div>`;
        break;
      case 'recvcard':
        form = `<div class="dbm-form-grid">
          <div class="dbm-form-group dbm-form-full">
            <label>Name *</label>
            <input type="text" id="dbmf_name" value="${item?.name||''}" placeholder="e.g. Nova MRV338 Receiver">
          </div>
          <div class="dbm-form-group">
            <label>Interface Type</label>
            <select id="dbmf_interfaceType">
              <option value="HUB75E" ${item?.interfaceType==='HUB75E'?'selected':''}>HUB75E</option>
              <option value="HUB75" ${item?.interfaceType==='HUB75'?'selected':''}>HUB75</option>
              <option value="HUB320" ${item?.interfaceType==='HUB320'?'selected':''}>HUB320</option>
              <option value="HUB128" ${item?.interfaceType==='HUB128'?'selected':''}>HUB128</option>
              <option value="自定义" ${item?.interfaceType==='自定义'?'selected':''}>Custom</option>
            </select>
          </div>
          <div class="dbm-form-group">
            <label>Interface Count</label>
            <input type="number" id="dbmf_interfaceCount" value="${item?.interfaceCount||12}" min="1" max="64">
          </div>
          <div class="dbm-form-group">
            <label>Load Width (px)</label>
            <input type="number" id="dbmf_capW" value="${item?.capW||512}" placeholder="e.g. 512">
          </div>
          <div class="dbm-form-group">
            <label>Load Height (px)</label>
            <input type="number" id="dbmf_capH" value="${item?.capH||512}" placeholder="e.g. 512">
          </div>
          <div class="dbm-form-group dbm-form-full">
            <label>Note</label>
            <input type="text" id="dbmf_remark" value="${item?.remark||''}" placeholder="Optional">
          </div>
        </div>`;
        break;
    }
    document.getElementById('dbm_modal_body').innerHTML = form;
    document.getElementById('dbm_modal').style.display = 'flex';
    // 记住当前编辑类型和ID
    this._modalType = type;
    this._modalId = id || null;
  },

  saveItem() {
    const type = this._modalType;
    const id = this._modalId;
    const db = this._getDB();
    // 收集表单数据
    const get = id => document.getElementById('dbmf_' + id)?.value || '';
    const getN = id => parseFloat(document.getElementById('dbmf_' + id)?.value) || 0;

    let newItem = {};
    switch(type) {
      case 'cabinet':
        if(!get('name').trim()) { alert('Please enter a name.'); return; }
        newItem = {
          id: id || 'c' + Date.now(),
          name: get('name'),
          width_mm: getN('w'), height_mm: getN('h'),
          category: get('cat'),
          remark: get('remark'),
        };
        break;
      case 'module':
        if(!get('name').trim()) { alert('Please enter a name.'); return; }
        newItem = {
          id: id || 'm' + Date.now(),
          name: get('name'),
          pixelW: getN('pw'), pixelH: getN('ph'),
          width_mm: getN('w'), height_mm: getN('h'),
          ledType: get('led'),
          power: getN('pow'),
          remark: get('remark'),
        };
        break;
      case 'control':
        if(!get('name').trim()) { alert('Please enter a name.'); return; }
        newItem = {
          id: id || 'ctrl' + Date.now(),
          name: get('name'),
          type: get('type'),
          capacity: getN('cap'),
          capacityUnit: get('capunit'),
          ports: getN('ports'),
          remark: get('remark'),
        };
        break;
      case 'psu':
        if(!get('name').trim()) { alert('Please enter a name.'); return; }
        newItem = {
          id: id || 'psu' + Date.now(),
          name: get('name'),
          ratedW: getN('w'),
          outputV: parseFloat(get('v')) || 5,
          remark: get('remark'),
        };
        break;
      case 'vprocessor':
        if(!get('name').trim()) { alert('Please enter a name.'); return; }
        newItem = {
          id: id || 'vp' + Date.now(),
          name: get('name'),
          type: get('vtype'),
          resW: getN('resW'),
          resH: getN('resH'),
          outputType: get('outputType'),
          outputCount: getN('outputCount'),
          sendOutputs: getN('sendOutputs'),
          remark: get('remark'),
        };
        break;
      case 'recvcard':
        if(!get('name').trim()) { alert('Please enter a name.'); return; }
        newItem = {
          id: id || 'rc' + Date.now(),
          name: get('name'),
          interfaceType: get('interfaceType'),
          interfaceCount: getN('interfaceCount'),
          capW: getN('capW'),
          capH: getN('capH'),
          remark: get('remark'),
        };
        break;
    }
    if(id) {
      const idx = db[type].findIndex(x => x.id === id);
      if(idx >= 0) db[type][idx] = newItem;
    } else {
      db[type].push(newItem);
    }
    this._save(db);
    this.closeModal();
    this._renderTable(type);
    // 保存后刷新硬件配置页下拉（发送卡/接收卡独立刷新）
    if(type === 'control') _populateCtrlSelects();
    if(type === 'recvcard') _populateCtrlSelects();
  },

  confirmDelete(type, id) {
    if(!confirm('Delete this item? This cannot be undone.')) return;
    const db = this._getDB();
    db[type] = db[type].filter(x => x.id !== id);
    this._save(db);
    this._renderTable(type);
  },

  closeModal() {
    document.getElementById('dbm_modal').style.display = 'none';
    this._modalType = null;
    this._modalId = null;
  },

  // 类型切换时自动切换单位为"万px"（发送设备/视频处理器用万px更灵活）
  _onTypeChange(type) {
    const unitSel = document.getElementById('dbmf_capunit');
    if(unitSel) unitSel.value = '万px';
  },

  // ---- 导出全部 ----
  exportAll() {
    const data = this._getDB();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LED_Project_Database_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  },

  // ---- 导入 ----
  importAll() {
    document.getElementById('dbm_import_file').click();
  },
  handleImport(input) {
    const file = input.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        // 简单校验
        if(!data.cabinet || !data.module || !data.control) {
          alert('Invalid JSON format: missing required fields.'); return;
        }
        if(confirm(`Import data?\nCabinets: ${data.cabinet?.length||0} | Modules: ${data.module?.length||0} | Controls: ${data.control?.length||0}\n\nWarning: This will overwrite all current data!`)) {
          this._save(data);
          this._renderAll();
          alert('Import successful!');
        }
      } catch(err) {
        alert('JSON parse failed: ' + err.message);
      }
    };
    reader.readAsText(file);
    input.value = ''; // 重置，可重复导入同一文件
  },

  // ---- 恢复默认 ----
  resetAll() {
    if(!confirm('Reset all data to defaults? Current changes will be overwritten.')) return;
    this._save(JSON.parse(JSON.stringify(this.DEFAULTS)));
    this._renderAll();
    alert('Reset to defaults complete.');
  },

  // ---- 导出 Excel ----
  exportExcel() {
    if(typeof XLSX === 'undefined') { alert('Excel library is loading. Please try again later (requires internet).'); return; }
    const db = this._getDB();
    const wb = XLSX.utils.book_new();

    // Sheet1: Cabinets
    const cabinetHeaders = ['Name','Width (mm)','Height (mm)','Category','Note'];
    const cabinetRows = (db.cabinet||[]).map(c => [
      c.name||'', c.width_mm||'', c.height_mm||'', c.category||'', c.remark||''
    ]);
    const wsC = XLSX.utils.aoa_to_sheet([cabinetHeaders, ...cabinetRows]);
    wsC['!cols'] = [20,10,10,14,20].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsC, 'Cabinets');

    // Sheet2: 模组库
    const moduleHeaders = ['Name','Pixel Width (px)','Pixel Height (px)','Phys Width (mm)','Phys Height (mm)','LED Type','Power (W)','Note'];
    const moduleRows = (db.module||[]).map(m => [
      m.name||'', m.pixelW||'', m.pixelH||'', m.width_mm||'', m.height_mm||'',
      m.ledType||'', m.power||'', m.remark||''
    ]);
    const wsM = XLSX.utils.aoa_to_sheet([moduleHeaders, ...moduleRows]);
    wsM['!cols'] = [20,10,10,10,10,14,12,20].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsM, 'Modules');

    // Sheet3: 控制系统库
    const controlHeaders = ['Name','Type','Capacity','Unit','Note'];
    const controlRows = (db.control||[]).map(c => [
      c.name||'', c.type||'', c.capacity||'', c.capacityUnit||'', c.remark||''
    ]);
    const wsCtrl = XLSX.utils.aoa_to_sheet([controlHeaders, ...controlRows]);
    wsCtrl['!cols'] = [22,14,12,10,20].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsCtrl, 'Controls');

    // Sheet4: 电源库
    const psuHeaders = ['Name','Rated Power (W)','Output Voltage (V)','Note'];
    const psuRows = (db.psu||[]).map(p => [
      p.name||'', p.ratedW||'', p.outputV||'', p.remark||''
    ]);
    const wsPsu = XLSX.utils.aoa_to_sheet([psuHeaders, ...psuRows]);
    wsPsu['!cols'] = [22,12,12,20].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsPsu, 'PSUs');

    // Sheet5: 视频处理器库
    const vpHeaders = ['Name','Type','Max Res W','Max Res H','Output Pixels','Send Outputs','Output Interface','Output Count','Note'];
    const vpRows = (db.vprocessor||[]).map(v => [
      v.name||'', v.type||'', v.resW||'', v.resH||'',
      ((v.resW||0)*(v.resH||0))||'', v.sendOutputs||v.outputCount||1,
      v.outputType||'', v.outputCount||1, v.remark||''
    ]);
    const wsVp = XLSX.utils.aoa_to_sheet([vpHeaders, ...vpRows]);
    wsVp['!cols'] = [22,14,10,10,14,12,16,10,20].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsVp, 'Video Processors');

    // Sheet6: 接收卡库
    const recvHeaders = ['Name','Interface Type','Interface Count','Load Width (px)','Load Height (px)','Note'];
    const recvRows = (db.recvcard||[]).map(r => [
      r.name||'', r.interfaceType||'', r.interfaceCount||'', r.capW||'', r.capH||'', r.remark||''
    ]);
    const wsRecv = XLSX.utils.aoa_to_sheet([recvHeaders, ...recvRows]);
    wsRecv['!cols'] = [22,14,12,12,12,20].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsRecv, 'Receiver Cards');

    const filename = `LED_Project_Database_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
  },

  // ---- 导入 Excel ----
  importExcel() {
    document.getElementById('dbm_import_excel_file').click();
  },
  handleImportExcel(input) {
    const file = input.files[0];
    if(!file) return;
    if(typeof XLSX === 'undefined') { alert('Excel library is loading. Please try again later (requires internet).'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const db = this._getDB();

        // 解析箱体库 (兼容旧中文和新英文sheet名)
        const wsC = wb.Sheets['Cabinets'] || wb.Sheets['箱体库'];
        if(wsC) {
          const rows = XLSX.utils.sheet_to_json(wsC, { header: 1 });
          const items = [];
          for(let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if(!r[0]) continue; // skip empty rows
            items.push({
              id: 'c_xl_' + Date.now() + '_' + i,
              name: String(r[0]||''),
              width_mm: Number(r[1])||0,
              height_mm: Number(r[2])||0,
              category: String(r[3]||'Other'),
              remark: String(r[4]||'')
            });
          }
          if(items.length > 0) db.cabinet = items;
        }

        // 解析模组库
        const wsM = wb.Sheets['Modules'] || wb.Sheets['模组库'];
        if(wsM) {
          const rows = XLSX.utils.sheet_to_json(wsM, { header: 1 });
          const items = [];
          for(let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if(!r[0]) continue;
            items.push({
              id: 'm_xl_' + Date.now() + '_' + i,
              name: String(r[0]||''),
              pixelW: Number(r[1])||0,
              pixelH: Number(r[2])||0,
              width_mm: Number(r[3])||0,
              height_mm: Number(r[4])||0,
              ledType: String(r[5]||''),
              power: Number(r[6])||0,
              remark: String(r[7]||'')
            });
          }
          if(items.length > 0) db.module = items;
        }

        // 解析控制系统库
        const wsCtrl = wb.Sheets['Controls'] || wb.Sheets['控制系统库'];
        if(wsCtrl) {
          const rows = XLSX.utils.sheet_to_json(wsCtrl, { header: 1 });
          const items = [];
          for(let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if(!r[0]) continue;
            items.push({
              id: 'ctrl_xl_' + Date.now() + '_' + i,
              name: String(r[0]||''),
              type: String(r[1]||'Sender'),
              capacity: Number(r[2])||0,
              capacityUnit: String(r[3]||'万px'),
              remark: String(r[4]||'')
            });
          }
          if(items.length > 0) db.control = items;
        }

        // 解析电源库
        const wsPsu = wb.Sheets['PSUs'] || wb.Sheets['电源库'];
        if(wsPsu) {
          const rows = XLSX.utils.sheet_to_json(wsPsu, { header: 1 });
          const items = [];
          for(let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if(!r[0]) continue;
            items.push({
              id: 'psu_xl_' + Date.now() + '_' + i,
              name: String(r[0]||''),
              ratedW: Number(r[1])||0,
              outputV: Number(r[2])||5,
              remark: String(r[3]||'')
            });
          }
          if(items.length > 0) db.psu = items;
        }

        // 解析视频处理器库
        const wsVp = wb.Sheets['Video Processors'] || wb.Sheets['视频处理器库'];
        if(wsVp) {
          const rows = XLSX.utils.sheet_to_json(wsVp, { header: 1 });
          const items = [];
          for(let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if(!r[0]) continue;
            items.push({
              id: 'vp_xl_' + Date.now() + '_' + i,
              name: String(r[0]||''),
              type: String(r[1]||'Video Processor'),
              resW: Number(r[2])||1920,
              resH: Number(r[3])||1080,
              outputType: String(r[4]||'DVI'),
              outputCount: Number(r[5])||1,
              remark: String(r[6]||'')
            });
          }
          if(items.length > 0) db.vprocessor = items;
        }

        // 解析接收卡库
        const wsRc = wb.Sheets['Receiver Cards'] || wb.Sheets['接收卡库'];
        if(wsRc) {
          const rows = XLSX.utils.sheet_to_json(wsRc, { header: 1 });
          const items = [];
          for(let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if(!r[0]) continue;
            items.push({
              id: 'rc_xl_' + Date.now() + '_' + i,
              name: String(r[0]||''),
              interfaceType: String(r[1]||'HUB75E'),
              interfaceCount: Number(r[2])||12,
              capW: Number(r[3])||512,
              capH: Number(r[4])||512,
              remark: String(r[5]||'')
            });
          }
          if(items.length > 0) db.recvcard = items;
        }

        const total = (db.cabinet||[]).length + (db.module||[]).length + (db.control||[]).length + (db.psu||[]).length + (db.vprocessor||[]).length + (db.recvcard||[]).length;
        if(confirm(`Parse complete: ${total} records total:\nCabinets: ${(db.cabinet||[]).length} | Modules: ${(db.module||[]).length}\nControls: ${(db.control||[]).length} | PSUs: ${(db.psu||[]).length}\nVideo Processors: ${(db.vprocessor||[]).length} | Receivers: ${(db.recvcard||[]).length}\n\nConfirm import? (will overwrite current data)`)) {
          this._save(db);
          this._renderAll();
          alert('Excel import successful!');
        }
      } catch(err) {
        alert('Excel parse failed: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
  },

  // ---- 供外部读取的接口 ----
  getCabinets() { return this._getDB().cabinet || []; },
  getModules()  { return this._getDB().module || []; },
  getControls() { return this._getDB().control || []; },
  getPSUs()     { return this._getDB().psu || []; },
  getVProcessors() { return this._getDB().vprocessor || []; },
  getRecvCards() { return this._getDB().recvcard || []; },
};

// ====================================================
//  初始化（使用 addEventListener 避免被覆盖）
// ====================================================
function _initApp() {
  DBM.init();  // Initialize database management
  // Populate dropdowns from database
  _populateBoxSelect();
  _populatePitchSelect();
  _populateCtrlSelects();
  _populatePSUSelect();
  _populateVProcessorSelect();
  // Show/hide custom input for sender (with null checks)
  const senderSel = document.getElementById('h_sender_type');
  if (senderSel) {
    senderSel.addEventListener('change', function() {
      const customGroup = document.getElementById('sender_custom_group');
      if (customGroup) customGroup.style.display = this.value === '__custom__' ? 'flex' : 'none';
      calcHardware();
    });
  }
  const psuSel = document.getElementById('p_psu_rated');
  if (psuSel) {
    psuSel.addEventListener('change', function() {
      const customGroup = document.getElementById('psu_custom_group');
      if (customGroup) customGroup.style.display = this.value === '__custom__' ? 'flex' : 'none';
      calcPower();
    });
  }
  // Set default date
  const dateEl = document.getElementById('rpt_date');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0,10);
  // Initialize "has cabinet" state (default: no cabinet)
  onBoxRadioChange();
  // Initial calculation
  calcHardware();
  calcPower();
  calcAux();
}

// 同时支持两种初始化方式
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initApp);
} else {
  _initApp();
}
