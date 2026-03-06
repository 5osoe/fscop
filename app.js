/* ═══════════════════════════════════════
   Font Scope Pro — V4.1
   All logic preserved · New UI wired
═══════════════════════════════════════ */

const App = (function () {

  /* ── State ── */
  const STATE = {
    db:           null,
    fonts:        [],
    filtered:     [],
    previewText:  'سبحان الله وبحمده',
    previewSize:  32,
    previewColor: '#F0F0F2',
    search:       '',
    loadedFonts:  new Set(),
    objectUrls:   new Map(),
    renderedMap:  new Map(),
    previewNodes: [],        // spans inside .card-preview — for text updates
    isProcessing: false
  };

  const MAX_FONTS     = 750;
  const MAX_FILE_SIZE = 75 * 1024 * 1024; // 75 MB

  Object.seal(STATE);
  Object.freeze(STATE.objectUrls);
  Object.freeze(STATE.loadedFonts);

  /* ── DOM cache ── */
  const D = () => ({
    grid:          document.getElementById('fontGrid'),
    // Desktop controls
    previewInput:  document.getElementById('previewInput'),
    searchInput:   document.getElementById('searchInput'),
    fileInput:     document.getElementById('fileInput'),
    sizeVal:       document.getElementById('sizeVal'),
    colorInput:    document.getElementById('colorInput'),
    colorDot:      document.getElementById('colorDot'),
    btnSizeUp:     document.getElementById('btnSizeUp'),
    btnSizeDown:   document.getElementById('btnSizeDown'),
    btnExport:     document.getElementById('btnExport'),
    btnTheme:      document.getElementById('btnTheme'),
    themeIcon:     document.getElementById('themeIcon'),
    btnClear:      document.getElementById('btnClear'),
    // Mobile controls
    previewInputM: document.getElementById('previewInputMobile'),
    searchInputM:  document.getElementById('searchInputMobile'),
    fileInputM:    document.getElementById('fileInputMobile'),
    sizeValM:      document.getElementById('sizeValM'),
    colorInputM:   document.getElementById('colorInputM'),
    colorDotM:     document.getElementById('colorDotM'),
    btnSizeUpM:    document.getElementById('btnSizeUpM'),
    btnSizeDownM:  document.getElementById('btnSizeDownM'),
    btnClearM:     document.getElementById('btnClearM'),
    // UI
    totalFonts:    document.getElementById('totalFonts'),
    totalFontsM:   document.getElementById('totalFontsM'),
    capFill:       document.getElementById('capFill'),
    capFillM:      document.getElementById('capFillM'),
    capLabel:      document.getElementById('capLabel'),
    progressBar:   document.getElementById('progressBar'),
    loaderLabel:   document.getElementById('loaderLabel'),
    mobilePanel:   document.getElementById('mobilePanel'),
    btnMenu:       document.getElementById('btnMenu'),
    btnPanelClose: document.getElementById('btnPanelClose'),
    dropOverlay:   document.getElementById('dropOverlay'),
    pwaSection:    document.getElementById('pwaSectionM'),
    pwaBtn:        document.getElementById('pwaInstallBtnM'),
    toast:         document.getElementById('toast'),
    toastMsg:      document.getElementById('toastMsg'),
    toastIcon:     document.getElementById('toastIcon'),
    printBody:     document.getElementById('printBody')
  });

  let DOM = null;

  /* ════════════════════════════════
     IndexedDB Layer
  ════════════════════════════════ */
  const DB = {
    init: () => new Promise((resolve, reject) => {
      const req = indexedDB.open('FontScope_V8', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('fonts'))
          db.createObjectStore('fonts', { keyPath: 'fileName' });
      };
      req.onsuccess = e => { STATE.db = e.target.result; resolve(); };
      req.onerror   = e => { console.warn('DB init error', e); reject(e); };
    }),

    getAll: () => new Promise((resolve, reject) => {
      if (!STATE.db) return resolve([]);
      const tx  = STATE.db.transaction('fonts', 'readonly');
      const req = tx.objectStore('fonts').getAll();
      req.onerror     = e => reject(e);
      tx.oncomplete   = () => resolve(Array.isArray(req.result) ? req.result : []);
    }),

    put: item => new Promise((resolve, reject) => {
      const tx  = STATE.db.transaction('fonts', 'readwrite');
      const req = tx.objectStore('fonts').put(item);
      req.onsuccess = resolve;
      req.onerror   = reject;
    }),

    delete: key => new Promise((resolve, reject) => {
      if (!STATE.db) return reject('DB not ready');
      const tx = STATE.db.transaction('fonts', 'readwrite');
      tx.objectStore('fonts').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e);
    }),

    clear: () => new Promise((resolve, reject) => {
      if (!STATE.db) return reject('DB not ready');
      const tx = STATE.db.transaction('fonts', 'readwrite');
      tx.objectStore('fonts').clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e);
    })
  };

  /* ════════════════════════════════
     Font Face Injection
  ════════════════════════════════ */
  const StyleSheet = (() => {
    let sheet = null;
    return {
      init () {
        if (document.getElementById('fsp-fonts')) return;
        const s = document.createElement('style');
        s.id = 'fsp-fonts';
        document.head.appendChild(s);
        sheet = s.sheet;
      },
      insert (rule) {
        try { sheet.insertRule(rule, sheet.cssRules.length); }
        catch (e) { console.warn('CSS rule error', e); }
      },
      clear () {
        while (sheet && sheet.cssRules.length > 0)
          sheet.deleteRule(0);
      }
    };
  })();

  /* ════════════════════════════════
     Security
  ════════════════════════════════ */
  const Sec = {
    fontId (fileName, blob) {
      const size    = blob instanceof Blob ? blob.size : 0;
      const type    = blob instanceof Blob ? (blob.type || 'na') : 'na';
      const raw     = fileName + '_' + size + '_' + type;
      const safe    = fileName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
      const hash    = btoa(unescape(encodeURIComponent(raw))).replace(/=/g, '').slice(0, 8);
      return 'f_' + safe + '_' + hash;
    },
    sanitizeTag (str) {
      if (!str) return '';
      return str.trim().slice(0, 40)
        .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E]/g, '');
    },
    el (tag, cls, text) {
      const e = document.createElement(tag);
      if (cls)  e.className   = cls;
      if (text) e.textContent = text;
      return e;
    },
    checkSig (file) {
      return new Promise(resolve => {
        const r = new FileReader();
        r.onload = e => {
          try {
            const v = new DataView(e.target.result);
            if (v.byteLength < 4) return resolve(false);
            const m = v.getUint32(0, false);
            resolve([0x00010000, 0x4F54544F, 0x774F4646, 0x774F4632].includes(m));
          } catch { resolve(false); }
        };
        r.onerror = () => resolve(false);
        r.readAsArrayBuffer(file.slice(0, 4));
      });
    }
  };

  /* ════════════════════════════════
     Init
  ════════════════════════════════ */
  async function init () {
    DOM = D();
    StyleSheet.init();

    // Apply saved theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);

    // Sync UI controls to state
    syncSizeUI();
    syncColorUI();

    // Init DB and load fonts
    try {
      await DB.init();
      'requestIdleCallback' in window
        ? requestIdleCallback(loadFonts)
        : setTimeout(loadFonts, 10);
    } catch (e) {
      console.error('DB init failed', e);
      toast('فشل تحميل البيانات', true);
    }

    bindEvents();

    // Wait for lucide then create icons
    if (window.lucide) lucide.createIcons();
    else document.querySelector('script[src*="lucide"]')?.addEventListener('load', () => lucide.createIcons());
  }

  /* ════════════════════════════════
     Load & Filter & Render
  ════════════════════════════════ */
  async function loadFonts () {
    STATE.fonts = await DB.getAll();
    DOM.grid.innerHTML = '';
    STATE.renderedMap.clear();
    STATE.previewNodes.length = 0;
    StyleSheet.clear();
    STATE.loadedFonts.clear();
    filter();
  }

  function filter () {
    const q = STATE.search.toLowerCase().trim();
    STATE.filtered = STATE.fonts.filter(f =>
      !q ||
      (f.fileName && f.fileName.toLowerCase().includes(q)) ||
      (f.userTag  && f.userTag.toLowerCase().includes(q))
    );
    render();
  }

  function render () {
    // Update counters
    updateCounters();

    // Remove cards no longer in filtered set
    const validKeys = new Set(STATE.filtered.map(f => f.fileName));
    for (const [key, entry] of STATE.renderedMap) {
      if (!validKeys.has(key)) {
        entry.card.remove();
        STATE.renderedMap.delete(key);
      }
    }

    // Empty state
    const existingEmpty = document.getElementById('emptyState');
    if (STATE.filtered.length === 0) {
      if (!existingEmpty) DOM.grid.appendChild(buildEmptyState());
    } else {
      if (existingEmpty) existingEmpty.remove();
    }

    STATE.previewNodes.length = 0;
    let iconsDirty = false;

    STATE.filtered.forEach((font, i) => {
      let entry = STATE.renderedMap.get(font.fileName);

      if (!entry) {
        // Inject font face
        const fontId = injectFont(font.fileName, font.data);
        if (!fontId) return;

        // Build card
        const card = Sec.el('div', 'font-card');
        card.setAttribute('role', 'listitem');

        // Delete button
        const btnDel = Sec.el('button', 'btn-del');
        btnDel.title = 'حذف';
        btnDel.setAttribute('aria-label', `حذف خط ${font.fileName.replace(/\.[^/.]+$/, '')}`);
        const iDel = document.createElement('i');
        iDel.setAttribute('data-lucide', 'x');
        iDel.setAttribute('width', '12'); iDel.setAttribute('height', '12');
        btnDel.appendChild(iDel);
        btnDel.onclick = e => { e.stopPropagation(); confirmDelete(font.fileName); };
        card.appendChild(btnDel);

        // Preview zone
        const prev = Sec.el('div', 'card-preview');
        prev.style.fontFamily = `"${fontId}"`;
        prev.style.fontSize   = STATE.previewSize + 'px';
        prev.style.color      = STATE.previewColor;
        const span = Sec.el('span', 'preview-text', STATE.previewText);
        prev.appendChild(span);
        card.appendChild(prev);

        // Footer
        const footer = Sec.el('div', 'card-footer');

        const info    = Sec.el('div', 'font-info');
        const nameEl  = Sec.el('div', 'font-name', font.fileName.replace(/\.[^/.]+$/, ''));
        nameEl.title  = font.fileName;
        nameEl.onclick = () => copyName(nameEl.textContent);
        const tagEl   = Sec.el('input', 'tag-field');
        tagEl.type        = 'text';
        tagEl.placeholder = '+ وسم';
        tagEl.value       = font.userTag || '';
        tagEl.setAttribute('aria-label', 'وسم الخط');
        tagEl.onchange    = e => saveTag(font.fileName, e.target.value);
        info.appendChild(nameEl);
        info.appendChild(tagEl);

        // Format badge
        const ext = font.fileName.split('.').pop()?.toUpperCase() || 'FONT';
        const badge = Sec.el('span', 'fmt-badge', ext);

        footer.appendChild(info);
        footer.appendChild(badge);
        card.appendChild(footer);

        entry = { card, preview: prev, span };
        STATE.renderedMap.set(font.fileName, entry);
        iconsDirty = true;
      }

      // Position card in DOM
      const current = DOM.grid.children[i];
      if (current !== entry.card) {
        i >= DOM.grid.children.length
          ? DOM.grid.appendChild(entry.card)
          : DOM.grid.insertBefore(entry.card, current);
      }

      STATE.previewNodes.push(entry.span);
    });

    if (iconsDirty) lucide.createIcons({ root: DOM.grid });
  }

  function buildEmptyState () {
    const wrap = Sec.el('div', '');
    wrap.id = 'emptyState';
    wrap.className = 'empty-state';
    wrap.style.gridColumn = '1 / -1';

    const iconWrap = Sec.el('div', 'empty-icon-wrap');
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'type');
    icon.setAttribute('width', '32'); icon.setAttribute('height', '32');
    iconWrap.appendChild(icon);

    const title = Sec.el('div', 'empty-title', 'لا توجد خطوط');
    const sub   = Sec.el('p', 'empty-sub', 'ارفع خطوطك لمعاينتها فوراً — TTF وOTF وWOFF وWOFF2 مدعومة. خصوصيتك محفوظة، الملفات تبقى على جهازك.');

    const uploadBtn = Sec.el('label', 'empty-upload-btn');
    const iUp = document.createElement('i');
    iUp.setAttribute('data-lucide', 'upload-cloud');
    iUp.setAttribute('width', '16'); iUp.setAttribute('height', '16');
    const uploadText = Sec.el('span', '', 'رفع الخطوط');
    const fileInput2 = document.createElement('input');
    fileInput2.type = 'file'; fileInput2.multiple = true;
    fileInput2.accept = '.ttf,.otf,.woff2,.woff';
    fileInput2.onchange = e => handleUpload(e.target.files);
    uploadBtn.appendChild(iUp);
    uploadBtn.appendChild(uploadText);
    uploadBtn.appendChild(fileInput2);

    wrap.appendChild(iconWrap);
    wrap.appendChild(title);
    wrap.appendChild(sub);
    wrap.appendChild(uploadBtn);

    return wrap;
  }

  /* ════════════════════════════════
     Font Injection
  ════════════════════════════════ */
  function injectFont (fileName, data) {
    const id = Sec.fontId(fileName, data);
    if (STATE.loadedFonts.has(id)) return id;

    let url;
    if (STATE.objectUrls.has(fileName)) {
      url = STATE.objectUrls.get(fileName);
    } else if (data instanceof Blob) {
      url = URL.createObjectURL(data);
      STATE.objectUrls.set(fileName, url);
    } else if (typeof data === 'string') {
      url = data;
      STATE.objectUrls.set(fileName, url);
    } else {
      return null;
    }

    StyleSheet.insert(`@font-face{font-family:"${id}";src:url("${url}");font-display:swap;}`);
    STATE.loadedFonts.add(id);
    return id;
  }

  /* ════════════════════════════════
     Upload Handler
  ════════════════════════════════ */
  async function handleUpload (files) {
    if (STATE.isProcessing) return;

    const validExts  = ['.ttf', '.otf', '.woff', '.woff2'];
    const validFiles = Array.from(files).filter(f =>
      validExts.some(ext => f.name.toLowerCase().endsWith(ext)));

    if (!validFiles.length) return toast('صيغة غير مدعومة', true);

    if (STATE.fonts.length + validFiles.length > MAX_FONTS)
      return toast(`الحد الأقصى ${MAX_FONTS} خط`, true);

    if (navigator.storage?.estimate) {
      try {
        const { quota, usage } = await navigator.storage.estimate();
        const totalSize = validFiles.reduce((s, f) => s + f.size, 0);
        if ((quota - usage) < totalSize) return toast('لا توجد مساحة كافية', true);
      } catch {}
    }

    STATE.isProcessing = true;
    progress(0, true);

    let ok = 0;
    const total = validFiles.length;

    for (let i = 0; i < total; i++) {
      const file = validFiles[i];

      if (file.size > MAX_FILE_SIZE) {
        toast(`تجاوز 75MB: ${truncate(file.name)}`, true);
        progress(((i + 1) / total) * 100, true);
        continue;
      }

      try {
        const valid = await Sec.checkSig(file);
        if (!valid) {
          toast(`ملف غير صالح: ${truncate(file.name)}`, true);
          progress(((i + 1) / total) * 100, true);
          continue;
        }
        const existing = STATE.fonts.find(f => f.fileName === file.name);
        const tag = existing ? existing.userTag : '';
        const buf = await readBuf(file);
        const blob = new Blob([buf], { type: file.type || 'application/octet-stream' });
        await DB.put({ fileName: file.name, data: blob, userTag: tag });
        ok++;
      } catch (e) {
        console.warn('Upload error', e);
        toast(`فشل: ${truncate(file.name)}`, true);
      }

      progress(((i + 1) / total) * 100, true);
      await raf();
    }

    setTimeout(() => {
      progress(100, false);
      STATE.isProcessing = false;
      loadFonts();
      if (ok > 0) toast(`تم رفع ${ok} خط${ok === 1 ? '' : ''}`);
    }, 500);
  }

  function readBuf (file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result);
      r.onerror = rej;
      r.readAsArrayBuffer(file);
    });
  }

  function raf () {
    return new Promise(r => requestAnimationFrame(r));
  }

  function truncate (str, len = 25) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  /* ════════════════════════════════
     Delete & Clear
  ════════════════════════════════ */
  function confirmDelete (fileName) {
    if (!confirm(`حذف "${fileName.replace(/\.[^/.]+$/, '')}"؟`)) return;

    DB.delete(fileName).then(() => {
      STATE.fonts    = STATE.fonts.filter(f => f.fileName !== fileName);
      STATE.filtered = STATE.filtered.filter(f => f.fileName !== fileName);

      if (STATE.objectUrls.has(fileName)) {
        URL.revokeObjectURL(STATE.objectUrls.get(fileName));
        STATE.objectUrls.delete(fileName);
      }

      const entry = STATE.renderedMap.get(fileName);
      if (entry) { entry.card.remove(); STATE.renderedMap.delete(fileName); }

      filter();
      toast('تم حذف الخط');
    }).catch(e => { toast('فشل الحذف', true); console.warn(e); });
  }

  function clearAll () {
    if (!STATE.fonts.length) return toast('المكتبة فارغة');
    if (!confirm('حذف جميع الخطوط نهائياً؟')) return;
    if (STATE.isProcessing) return;

    STATE.isProcessing = true;
    DB.clear()
      .then(() => {
        STATE.objectUrls.forEach(u => URL.revokeObjectURL(u));
        STATE.objectUrls.clear();
        return loadFonts();
      })
      .then(() => toast('تم مسح المكتبة'))
      .catch(e => { toast('فشل الحذف', true); console.warn(e); })
      .finally(() => { STATE.isProcessing = false; });
  }

  function saveTag (fileName, rawTag) {
    const tag  = Sec.sanitizeTag(rawTag);
    const font = STATE.fonts.find(f => f.fileName === fileName);
    if (font) { font.userTag = tag; DB.put(font); }
  }

  /* ════════════════════════════════
     Export PDF
  ════════════════════════════════ */
  async function exportPDF () {
    if (!STATE.fonts.length) return toast('لا توجد خطوط للتصدير', true);

    STATE.isProcessing = true;
    progress(0, true);

    const tbody = DOM.printBody;
    tbody.innerHTML = '';
    const list  = STATE.filtered.length ? STATE.filtered : STATE.fonts;
    const CHUNK = 20;

    for (let i = 0; i < list.length; i += CHUNK) {
      const frag = document.createDocumentFragment();
      list.slice(i, i + CHUNK).forEach(font => {
        const id = injectFont(font.fileName, font.data);
        if (!id) return;
        const tr = document.createElement('tr');
        const tdP = document.createElement('td');
        tdP.textContent    = STATE.previewText;
        tdP.style.fontFamily = `"${id}"`;
        tdP.style.fontSize   = '18px';
        const tdN = document.createElement('td');
        tdN.textContent = font.fileName;
        const tdT = document.createElement('td');
        tdT.textContent = font.userTag || '—';
        tr.append(tdP, tdN, tdT);
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);
      progress(Math.min(((i + CHUNK) / list.length) * 100, 100), true);
      await raf();
    }

    setTimeout(() => {
      progress(100, false);
      STATE.isProcessing = false;
      window.print();
    }, 400);
  }

  /* ════════════════════════════════
     Preview Controls
  ════════════════════════════════ */
  function changeSize (delta) {
    STATE.previewSize = Math.min(96, Math.max(12, STATE.previewSize + delta));
    syncSizeUI();
    for (const [, e] of STATE.renderedMap)
      e.preview.style.fontSize = STATE.previewSize + 'px';
  }

  function syncSizeUI () {
    if (DOM.sizeVal)  DOM.sizeVal.textContent  = STATE.previewSize;
    if (DOM.sizeValM) DOM.sizeValM.textContent = STATE.previewSize;
  }

  function changeColor (hex) {
    STATE.previewColor = hex;
    syncColorUI();
    for (const [, e] of STATE.renderedMap)
      e.preview.style.color = STATE.previewColor;
  }

  function syncColorUI () {
    if (DOM.colorInput) DOM.colorInput.value = STATE.previewColor;
    if (DOM.colorDot)   DOM.colorDot.style.background = STATE.previewColor;
    if (DOM.colorInputM) DOM.colorInputM.value = STATE.previewColor;
    if (DOM.colorDotM)   DOM.colorDotM.style.background = STATE.previewColor;
  }

  function changeText (val) {
    STATE.previewText = val || 'نص افتراضي';
    for (let i = 0; i < STATE.previewNodes.length; i++)
      STATE.previewNodes[i].textContent = STATE.previewText;
  }

  /* ════════════════════════════════
     Theme
  ════════════════════════════════ */
  function applyTheme (t) {
    document.body.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
    // Update theme icon
    const icon = document.getElementById('themeIcon');
    if (icon) {
      icon.setAttribute('data-lucide', t === 'dark' ? 'sun' : 'moon');
      if (window.lucide) lucide.createIcons({ root: icon.parentElement || document.body });
    }
    // Update default preview color for light mode
    if (t === 'light' && STATE.previewColor === '#F0F0F2') {
      changeColor('#111116');
    } else if (t === 'dark' && STATE.previewColor === '#111116') {
      changeColor('#F0F0F2');
    }
  }

  function toggleTheme () {
    const current = localStorage.getItem('theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  /* ════════════════════════════════
     Helpers
  ════════════════════════════════ */
  function updateCounters () {
    const count = STATE.fonts.length;
    const pct   = Math.min((count / MAX_FONTS) * 100, 100);

    if (DOM.totalFonts)  DOM.totalFonts.textContent  = count;
    if (DOM.totalFontsM) DOM.totalFontsM.textContent = count;
    if (DOM.capFill)     DOM.capFill.style.width   = pct + '%';
    if (DOM.capFillM)    DOM.capFillM.style.width  = pct + '%';
    if (DOM.capLabel)    DOM.capLabel.textContent   = count + ' / ' + MAX_FONTS;
  }

  function progress (pct, show) {
    if (DOM.progressBar) DOM.progressBar.style.width = show ? pct + '%' : '0%';
    if (DOM.loaderLabel) {
      if (show) {
        DOM.loaderLabel.textContent = Math.floor(pct) + '%';
        DOM.loaderLabel.classList.add('visible');
      } else {
        setTimeout(() => DOM.loaderLabel.classList.remove('visible'), 250);
      }
    }
  }

  let toastTimer = null;
  function toast (msg, isError = false) {
    const t = DOM.toast;
    if (!t) return;
    DOM.toastMsg.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    if (DOM.toastIcon) {
      DOM.toastIcon.innerHTML = '';
      const ic = document.createElement('i');
      ic.setAttribute('data-lucide', isError ? 'alert-circle' : 'check-circle');
      ic.setAttribute('width', '14'); ic.setAttribute('height', '14');
      DOM.toastIcon.appendChild(ic);
      lucide.createIcons({ root: DOM.toastIcon });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3000);
  }

  function copyName (text) {
    navigator.clipboard.writeText(text)
      .then(() => toast('تم نسخ الاسم'))
      .catch(() => {});
  }

  /* ════════════════════════════════
     Mobile Panel
  ════════════════════════════════ */
  function openPanel ()  {
    DOM.mobilePanel.classList.add('open');
  }
  function closePanel () {
    DOM.mobilePanel.classList.remove('open');
  }

  /* ════════════════════════════════
     Drag & Drop (whole page)
  ════════════════════════════════ */
  function setupDragDrop () {
    let dragCounter = 0;

    document.addEventListener('dragenter', e => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) DOM.dropOverlay.classList.add('active');
    });

    document.addEventListener('dragleave', e => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        DOM.dropOverlay.classList.remove('active');
      }
    });

    document.addEventListener('dragover', e => e.preventDefault());

    document.addEventListener('drop', e => {
      e.preventDefault();
      dragCounter = 0;
      DOM.dropOverlay.classList.remove('active');
      if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
    });
  }

  /* ════════════════════════════════
     PWA Install
  ════════════════════════════════ */
  let deferredPrompt = null;

  function setupPWA () {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      if (DOM.pwaSection) {
        DOM.pwaSection.style.display = 'block';
        if (window.lucide) lucide.createIcons({ root: DOM.pwaSection });
      }
    });

    if (DOM.pwaBtn) {
      DOM.pwaBtn.onclick = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted' && DOM.pwaSection)
          DOM.pwaSection.style.display = 'none';
        deferredPrompt = null;
      };
    }

    window.addEventListener('appinstalled', () => {
      if (DOM.pwaSection) DOM.pwaSection.style.display = 'none';
      deferredPrompt = null;
    });
  }

  /* ════════════════════════════════
     Service Worker
  ════════════════════════════════ */
  function setupSW () {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
      });
    }
  }

  /* ════════════════════════════════
     Event Bindings
  ════════════════════════════════ */
  function bindEvents () {

    // ── Preview text — desktop + mobile synced
    let ptTimer;
    const onPreviewInput = e => {
      clearTimeout(ptTimer);
      ptTimer = setTimeout(() => {
        changeText(e.target.value);
        // Sync the other input
        if (e.target === DOM.previewInput  && DOM.previewInputM) DOM.previewInputM.value = e.target.value;
        if (e.target === DOM.previewInputM && DOM.previewInput)  DOM.previewInput.value  = e.target.value;
      }, 80);
    };
    DOM.previewInput?.addEventListener('input',  onPreviewInput);
    DOM.previewInputM?.addEventListener('input', onPreviewInput);

    // ── Search — desktop + mobile synced
    let sTimer;
    const onSearch = e => {
      clearTimeout(sTimer);
      sTimer = setTimeout(() => {
        STATE.search = e.target.value;
        filter();
        if (e.target === DOM.searchInput  && DOM.searchInputM) DOM.searchInputM.value = e.target.value;
        if (e.target === DOM.searchInputM && DOM.searchInput)  DOM.searchInput.value  = e.target.value;
      }, 100);
    };
    DOM.searchInput?.addEventListener('input',  onSearch);
    DOM.searchInputM?.addEventListener('input', onSearch);

    // ── Size
    DOM.btnSizeUp?.addEventListener('click',    () => changeSize(+4));
    DOM.btnSizeDown?.addEventListener('click',  () => changeSize(-4));
    DOM.btnSizeUpM?.addEventListener('click',   () => changeSize(+4));
    DOM.btnSizeDownM?.addEventListener('click', () => changeSize(-4));

    // ── Color — desktop + mobile
    const onColor = e => changeColor(e.target.value);
    DOM.colorInput?.addEventListener('input',  onColor);
    DOM.colorInputM?.addEventListener('input', onColor);

    // ── File upload
    DOM.fileInput?.addEventListener('change',  e => handleUpload(e.target.files));
    document.getElementById('fileInputMobile')?.addEventListener('change', e => handleUpload(e.target.files));

    // ── Export
    DOM.btnExport?.addEventListener('click', exportPDF);

    // ── Theme
    DOM.btnTheme?.addEventListener('click', toggleTheme);

    // ── Clear
    DOM.btnClear?.addEventListener('click',  clearAll);
    DOM.btnClearM?.addEventListener('click', () => { closePanel(); clearAll(); });

    // ── Mobile panel
    DOM.btnMenu?.addEventListener('click',       openPanel);
    DOM.btnPanelClose?.addEventListener('click', closePanel);

    // ── Setup drag & drop and PWA
    setupDragDrop();
    setupPWA();
    setupSW();
  }

  /* ════════════════════════════════
     Public API
  ════════════════════════════════ */
  return {
    init,
    exportPDF,
    clearAll,
    sizeUp:        () => changeSize(+4),
    sizeDown:      () => changeSize(-4),
    toggleTheme,
    toggleSidebar: openPanel   // legacy alias
  };

})();

window.addEventListener('DOMContentLoaded', App.init);
