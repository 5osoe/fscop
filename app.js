const App = (function () {

    const STATE = {
        db: null,
        fonts: [],
        filtered: [],
        previewText: 'سبحان الله وبحمده',
        previewSize: 32,
        previewColor: '#FFFFFF',
        search: '',
        loadedFonts: new Set(),
        objectUrls: new Map(),
        renderedMap: new Map(),
        previewNodes: [],
        isProcessing: false
    };

    const MAX_FONTS     = 750;
    const MAX_FILE_SIZE = 75 * 1024 * 1024;

    Object.seal(STATE);
    Object.freeze(STATE.objectUrls);
    Object.freeze(STATE.loadedFonts);

    const DOM = {
        grid:       document.getElementById('fontGrid'),
        preview:    document.getElementById('previewInput'),
        search:     document.getElementById('searchInput'),
        total:      document.getElementById('totalFonts'),
        progress:   document.getElementById('progressFill'),
        loaderText: document.getElementById('loaderText'),
        sidebar:    document.getElementById('sidebar'),
        overlay:    document.getElementById('overlay'),
        fileInput:  document.getElementById('fileInput'),
        dropZone:   document.getElementById('dropZone'),
        sizeVal:    document.getElementById('sizeVal'),
        colorSwatch:document.getElementById('colorSwatch'),
        colorInput: document.getElementById('colorInput')
    };

    /* ── Storage ── */
    const DB = {
        init: () => new Promise((resolve, reject) => {
            const req = indexedDB.open('FontScope_V8', 1);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('fonts'))
                    db.createObjectStore('fonts', { keyPath: 'fileName' });
            };
            req.onsuccess = e => { STATE.db = e.target.result; resolve(); };
            req.onerror   = e => { console.warn('DB Error', e); reject(e); };
        }),
        getAll: () => new Promise((resolve, reject) => {
            if (!STATE.db) return resolve([]);
            const tx    = STATE.db.transaction('fonts', 'readonly');
            const store = tx.objectStore('fonts');
            const req   = store.getAll();
            req.onerror      = e => { console.warn('DB getAll error', e); reject(e); };
            tx.oncomplete    = () => resolve(Array.isArray(req.result) ? req.result : []);
        }),
        put: item => new Promise((resolve, reject) => {
            const tx  = STATE.db.transaction('fonts', 'readwrite');
            const req = tx.objectStore('fonts').put(item);
            req.onsuccess = resolve;
            req.onerror   = reject;
        }),
        delete: key => new Promise((resolve, reject) => {
            if (!STATE.db) { reject('DB not init'); return; }
            const tx    = STATE.db.transaction('fonts', 'readwrite');
            const store = tx.objectStore('fonts');
            const req   = store.delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror    = e => reject(e);
            req.onerror   = e => reject(e);
        }),
        clear: () => new Promise((resolve, reject) => {
            if (!STATE.db) { reject('DB not init'); return; }
            const tx    = STATE.db.transaction('fonts', 'readwrite');
            const store = tx.objectStore('fonts');
            const req   = store.clear();
            tx.oncomplete = () => resolve();
            tx.onerror    = e => reject(e);
            req.onerror   = e => reject(e);
        })
    };

    /* ── Style injection ── */
    const MasterStyle = {
        sheet: null,
        init () {
            if (document.getElementById('fsp-styles')) return;
            const style = document.createElement('style');
            style.id = 'fsp-styles';
            document.head.appendChild(style);
            MasterStyle.sheet = style.sheet;
        },
        insert (rule) {
            try { MasterStyle.sheet.insertRule(rule, MasterStyle.sheet.cssRules.length); }
            catch (e) { console.warn('CSS Inject Warn', e); }
        },
        clear () {
            while (MasterStyle.sheet.cssRules.length > 0) MasterStyle.sheet.deleteRule(0);
        }
    };

    /* ── Security ── */
    const Security = {
        safeFontId (fileName, blob) {
            const size = blob instanceof Blob ? blob.size : 0;
            const type = blob instanceof Blob ? (blob.type || 'na') : 'na';
            const base = fileName + '_' + size + '_' + type;
            const encoded = unescape(encodeURIComponent(base));
            const safe    = fileName.replace(/[^a-zA-Z0-9]/g, '_');
            const hash    = btoa(encoded).replace(/=/g, '').slice(0, 8);
            return 'f_' + safe.slice(0, 20) + '_' + hash;
        },
        sanitizeTag (str) {
            if (!str) return '';
            return str.trim().slice(0, 40)
                .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E]/g, '');
        },
        create (tag, className, textContent) {
            const el = document.createElement(tag);
            if (className)   el.className   = className;
            if (textContent) el.textContent = textContent;
            return el;
        },
        checkSignature (file) {
            return new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = e => {
                    try {
                        const view = new DataView(e.target.result);
                        if (view.byteLength < 4) return resolve(false);
                        const magic = view.getUint32(0, false);
                        resolve([0x00010000, 0x4F54544F, 0x774F4646, 0x774F4632].includes(magic));
                    } catch { resolve(false); }
                };
                reader.onerror = () => resolve(false);
                reader.readAsArrayBuffer(file.slice(0, 4));
            });
        }
    };

    /* ── Init ── */
    async function init () {
        MasterStyle.init();
        const theme = localStorage.getItem('theme') || 'dark';
        setTheme(theme);
        syncSizeUI();
        syncColorUI();

        try {
            await DB.init();
            'requestIdleCallback' in window
                ? requestIdleCallback(loadFonts)
                : setTimeout(loadFonts, 10);
        } catch (e) {
            console.error(e);
            toast('فشل تحميل البيانات', 'error');
        }

        setupListeners();
        lucide.createIcons();
    }

    async function loadFonts () {
        STATE.fonts = await DB.getAll();
        DOM.grid.innerHTML = '';
        STATE.renderedMap.clear();
        STATE.previewNodes = [];
        MasterStyle.clear();
        STATE.loadedFonts.clear();
        filter();
    }

    function getFontUrl (fileName, data) {
        if (STATE.objectUrls.has(fileName)) return STATE.objectUrls.get(fileName);
        let url;
        if (data instanceof Blob) url = URL.createObjectURL(data);
        else if (typeof data === 'string') url = data;
        else return null;
        STATE.objectUrls.set(fileName, url);
        return url;
    }

    function injectFontFace (fileName, data) {
        const fontId = Security.safeFontId(fileName, data);
        if (STATE.loadedFonts.has(fontId)) return fontId;
        const url = getFontUrl(fileName, data);
        if (!url) return null;
        MasterStyle.insert(`@font-face{font-family:"${fontId}";src:url("${url}");font-display:swap;}`);
        STATE.loadedFonts.add(fontId);
        return fontId;
    }

    function filter () {
        const q = STATE.search.toLowerCase();
        STATE.filtered = STATE.fonts.filter(f =>
            (f.fileName && f.fileName.toLowerCase().includes(q)) ||
            (f.userTag  && f.userTag.toLowerCase().includes(q))
        );
        render();
    }

    /* ── Render ── */
    function render () {
        if (DOM.total) DOM.total.textContent = STATE.fonts.length;

        const validKeys = new Set(STATE.filtered.map(f => f.fileName));
        for (const [fileName, entry] of STATE.renderedMap) {
            if (!validKeys.has(fileName)) {
                entry.card.remove();
                STATE.renderedMap.delete(fileName);
            }
        }

        let iconsDirty = false;

        if (STATE.filtered.length === 0) {
            if (!document.getElementById('emptyState')) {
                const empty = Security.create('div', 'empty-state');
                empty.id = 'emptyState';
                const ico = Security.create('i');
                ico.setAttribute('data-lucide', 'layers');
                ico.setAttribute('width', '28');
                const txt = Security.create('p', '', 'لا توجد خطوط · اسحب ملفاتك هنا');
                empty.appendChild(ico);
                empty.appendChild(txt);
                DOM.grid.appendChild(empty);
                iconsDirty = true;
            }
        } else {
            const empty = document.getElementById('emptyState');
            if (empty) empty.remove();
        }

        STATE.previewNodes.length = 0;

        STATE.filtered.forEach((font, index) => {
            let entry = STATE.renderedMap.get(font.fileName);

            if (!entry) {
                const fontId = injectFontFace(font.fileName, font.data);
                if (!fontId) return;

                const card = Security.create('div', 'font-card');

                /* delete btn */
                const btnDel = Security.create('button', 'btn-delete');
                btnDel.title = 'حذف الخط';
                const iDel = Security.create('i');
                iDel.setAttribute('data-lucide', 'x');
                iDel.setAttribute('width', '12');
                btnDel.appendChild(iDel);
                btnDel.onclick = e => { e.stopPropagation(); deleteSingleFont(font.fileName); };
                card.appendChild(btnDel);

                /* preview */
                const prev = Security.create('div', 'card-preview');
                const prevSpan = Security.create('span', '', STATE.previewText);
                prev.appendChild(prevSpan);
                prev.style.fontFamily = `"${fontId}"`;
                prev.style.fontSize   = STATE.previewSize + 'px';
                prev.style.color      = STATE.previewColor;
                card.appendChild(prev);

                /* meta */
                const meta  = Security.create('div', 'card-meta');
                const nameWrap = Security.create('div', 'font-name-wrap');
                const nameEl = Security.create('div', 'font-name',
                    font.fileName.replace(/\.[^/.]+$/, ''));
                nameEl.onclick = () => copyText(nameEl.textContent);
                nameEl.title   = font.fileName;
                const tagInput = Security.create('input', 'tag-input');
                tagInput.placeholder = '+ tag';
                tagInput.value       = font.userTag || '';
                tagInput.onchange    = e => updateTag(font.fileName, e.target.value);
                nameWrap.appendChild(nameEl);
                nameWrap.appendChild(tagInput);
                meta.appendChild(nameWrap);
                card.appendChild(meta);

                entry = { card, preview: prev, text: prevSpan };
                STATE.renderedMap.set(font.fileName, entry);
                iconsDirty = true;
            }

            const currentChild = DOM.grid.children[index];
            if (currentChild !== entry.card) {
                index >= DOM.grid.children.length
                    ? DOM.grid.appendChild(entry.card)
                    : DOM.grid.insertBefore(entry.card, currentChild);
            }

            STATE.previewNodes.push(entry.text || entry.preview);
        });

        if (iconsDirty) lucide.createIcons({ root: DOM.grid });
    }

    /* ── Upload ── */
    async function handleUpload (files) {
        if (STATE.isProcessing) return;
        const validExts  = ['.ttf', '.otf', '.woff', '.woff2'];
        const validFiles = Array.from(files).filter(f =>
            validExts.some(ext => f.name.toLowerCase().endsWith(ext)));

        if (!validFiles.length) return toast('صيغة الملف غير مدعومة', 'error');

        if (STATE.fonts.length + validFiles.length > MAX_FONTS)
            return toast(`الحد الأقصى ${MAX_FONTS} خط`, 'error');

        if (navigator.storage?.estimate) {
            try {
                const { quota, usage } = await navigator.storage.estimate();
                const totalSize = validFiles.reduce((a, f) => a + f.size, 0);
                if ((quota - usage) < totalSize)
                    return toast('لا توجد مساحة كافية', 'error');
            } catch {}
        }

        STATE.isProcessing = true;
        updateProgress(0, true);

        let ok = 0;
        const total = validFiles.length;

        for (let i = 0; i < total; i++) {
            const file = validFiles[i];

            if (file.size > MAX_FILE_SIZE) {
                toast(`تجاوز 75MB: ${file.name}`, 'error');
                updateProgress(((i + 1) / total) * 100, true);
                continue;
            }

            try {
                const valid = await Security.checkSignature(file);
                if (!valid) {
                    toast(`ملف غير صالح: ${file.name}`, 'error');
                    updateProgress(((i + 1) / total) * 100, true);
                    continue;
                }
                const exists = STATE.fonts.find(f => f.fileName === file.name);
                const tag    = exists ? exists.userTag : '';
                const buffer = await readFileBuffer(file);
                const blob   = new Blob([buffer], { type: file.type || 'application/octet-stream' });
                await DB.put({ fileName: file.name, data: blob, userTag: tag });
                ok++;
            } catch (e) {
                console.warn(e);
                toast(`فشل: ${file.name}`, 'error');
            }

            updateProgress(((i + 1) / total) * 100, true);
            await new Promise(r => requestAnimationFrame(r));
        }

        setTimeout(() => {
            updateProgress(100, false);
            STATE.isProcessing = false;
            loadFonts();
            if (ok > 0) toast(`تم رفع ${ok} خط`);
        }, 600);
    }

    function readFileBuffer (file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = e => resolve(e.target.result);
            r.onerror = reject;
            r.readAsArrayBuffer(file);
        });
    }

    function deleteSingleFont (fileName) {
        if (!confirm(`حذف "${fileName}"؟`)) return;
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
        }).catch(e => { toast('فشل الحذف', 'error'); console.warn(e); });
    }

    function clearAll () {
        if (!confirm('حذف المكتبة بالكامل؟')) return;
        if (STATE.isProcessing) return;
        STATE.isProcessing = true;
        DB.clear()
            .then(() => { STATE.objectUrls.forEach(u => URL.revokeObjectURL(u)); STATE.objectUrls.clear(); return loadFonts(); })
            .then(() => toast('تم التنظيف'))
            .catch(e => { console.warn(e); toast('فشل التنظيف', 'error'); })
            .finally(() => { STATE.isProcessing = false; });
    }

    function updateTag (fileName, rawTag) {
        const tag  = Security.sanitizeTag(rawTag);
        const font = STATE.fonts.find(f => f.fileName === fileName);
        if (font) { font.userTag = tag; DB.put(font); }
    }

    /* ── Export ── */
    async function exportPDF () {
        if (STATE.search && STATE.filtered.length === 0)
            return toast('لا توجد نتائج للتصدير', 'error');
        if (!STATE.fonts.length) return toast('لا توجد بيانات', 'error');

        STATE.isProcessing = true;
        updateProgress(0, true);

        const tbody = document.getElementById('printBody');
        tbody.innerHTML = '';
        const list  = STATE.filtered.length ? STATE.filtered : STATE.fonts;
        const total = list.length;
        const CHUNK = 20;

        for (let i = 0; i < total; i += CHUNK) {
            const fragment = document.createDocumentFragment();
            list.slice(i, i + CHUNK).forEach(font => {
                const fontId = injectFontFace(font.fileName, font.data);
                if (!fontId) return;
                const tr = document.createElement('tr');
                const tdP = document.createElement('td');
                tdP.textContent = STATE.previewText;
                tdP.style.fontFamily = `"${fontId}"`;
                tdP.style.fontSize   = '20px';
                const tdN = document.createElement('td');
                tdN.textContent = font.fileName;
                const tdT = document.createElement('td');
                tdT.textContent = font.userTag || '-';
                tr.append(tdP, tdN, tdT);
                fragment.appendChild(tr);
            });
            tbody.appendChild(fragment);
            updateProgress(Math.min(((i + CHUNK) / total) * 100, 100), true);
            await new Promise(r => requestAnimationFrame(r));
        }

        setTimeout(() => {
            updateProgress(100, false);
            STATE.isProcessing = false;
            window.print();
        }, 500);
    }

    /* ── Helpers ── */
    function updateProgress (pct, show) {
        DOM.progress.style.width = show ? `${pct}%` : '0';
        if (show) {
            DOM.loaderText.textContent = `${Math.floor(pct)}%`;
            DOM.loaderText.classList.add('active');
        } else {
            setTimeout(() => DOM.loaderText.classList.remove('active'), 300);
        }
    }

    function toast (msg, type = 'success') {
        document.getElementById('toastMsg').textContent = msg;
        const t = document.getElementById('toast');
        t.className = 'toast active ' + (type === 'error' ? 'toast-error' : '');
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
    }

    function copyText (text) {
        navigator.clipboard.writeText(text)
            .then(() => toast('تم نسخ الاسم'))
            .catch(() => {});
    }

    function setTheme (t) {
        document.body.setAttribute('data-theme', t);
        localStorage.setItem('theme', t);
        const icon = document.getElementById('themeIcon');
        if (icon) icon.setAttribute('data-lucide', t === 'dark' ? 'sun' : 'moon');
        lucide.createIcons();
    }

    /* ── Preview size & color ── */
    function changeSize (delta) {
        STATE.previewSize = Math.min(80, Math.max(14, STATE.previewSize + delta));
        syncSizeUI();
        for (const [, entry] of STATE.renderedMap)
            entry.preview.style.fontSize = STATE.previewSize + 'px';
    }

    function syncSizeUI () {
        if (DOM.sizeVal) DOM.sizeVal.textContent = STATE.previewSize + 'px';
    }

    function syncColorUI () {
        if (DOM.colorInput) DOM.colorInput.value = STATE.previewColor;
        if (DOM.colorSwatch) DOM.colorSwatch.style.background = STATE.previewColor;
    }

    function changeColor (hex) {
        STATE.previewColor = hex;
        syncColorUI();
        for (const [, entry] of STATE.renderedMap)
            entry.preview.style.color = STATE.previewColor;
    }

    /* ── Listeners ── */
    function setupListeners () {
        let sT;
        DOM.search.addEventListener('input', e => {
            clearTimeout(sT);
            sT = setTimeout(() => { STATE.search = e.target.value; filter(); }, 100);
        });

        let pT;
        DOM.preview.addEventListener('input', e => {
            clearTimeout(pT);
            pT = setTimeout(() => {
                STATE.previewText = e.target.value || 'نص افتراضي';
                for (let i = 0; i < STATE.previewNodes.length; i++)
                    STATE.previewNodes[i].textContent = STATE.previewText;
            }, 100);
        });

        DOM.fileInput.onchange  = e => handleUpload(e.target.files);
        DOM.dropZone.ondragover = e => { e.preventDefault(); DOM.dropZone.classList.add('drag'); };
        DOM.dropZone.ondragleave= e => { e.preventDefault(); DOM.dropZone.classList.remove('drag'); };
        DOM.dropZone.ondrop     = e => { e.preventDefault(); DOM.dropZone.classList.remove('drag'); handleUpload(e.dataTransfer.files); };

        if (DOM.colorInput) {
            DOM.colorInput.addEventListener('input', e => changeColor(e.target.value));
        }
    }

    return {
        init, exportPDF, clearAll,
        sizeUp:   () => changeSize(+4),
        sizeDown: () => changeSize(-4),
        toggleTheme: () => setTheme(localStorage.getItem('theme') === 'dark' ? 'light' : 'dark'),
        toggleSidebar: () => {
            DOM.sidebar.classList.toggle('active');
            DOM.overlay.classList.toggle('active');
        }
    };
})();

window.addEventListener('DOMContentLoaded', App.init);

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('SW registered'))
            .catch(e => console.warn('SW failed', e));
    });
}
