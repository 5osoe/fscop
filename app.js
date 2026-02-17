/**
 * Font Scope Pro - V4.0 Stable (Secured)
 * Limited to 500 Fonts
 * Production Refactor
 */

const App = (function() {
    // --- State & Optimization ---
    const STATE = {
        db: null,
        fonts: [],
        filtered: [],
        previewText: "سبحان الله وبحمده",
        search: "",
        loadedFonts: new Set(),
        objectUrls: new Map(),
        renderedMap: new Map(),
        previewNodes: [],
        isProcessing: false
    };

    // HARD LIMITS
    const MAX_FONTS = 500;
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

    // State Hardening
    Object.seal(STATE);
    Object.freeze(STATE.objectUrls);
    Object.freeze(STATE.loadedFonts);

    // --- DOM Cache ---
    const DOM = {
        grid: document.getElementById('fontGrid'),
        preview: document.getElementById('previewInput'),
        search: document.getElementById('searchInput'),
        total: document.getElementById('totalFonts'),
        shown: document.getElementById('pageFonts'),
        progress: document.getElementById('progressFill'),
        loaderText: document.getElementById('loaderText'),
        sidebar: document.getElementById('sidebar'),
        overlay: document.getElementById('overlay'),
        fileInput: document.getElementById('fileInput'),
        dropZone: document.getElementById('dropZone')
    };

    // --- 1. Storage Layer ---
    const DB = {
        init: () => new Promise((resolve, reject) => {
            const req = indexedDB.open("FontScope_V8", 1);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("fonts")) {
                    db.createObjectStore("fonts", { keyPath: "fileName" });
                }
            };
            req.onsuccess = e => { STATE.db = e.target.result; resolve(); };
            req.onerror = e => { console.warn("DB Error", e); reject(e); };
        }),
        getAll: () => new Promise((resolve, reject) => {
            if (!STATE.db) return resolve([]);
            const tx = STATE.db.transaction("fonts", "readonly");
            const store = tx.objectStore("fonts");
            const req = store.getAll();
            req.onerror = (e) => { console.warn("DB getAll error", e); reject(e); };
            tx.oncomplete = () => { resolve(Array.isArray(req.result) ? req.result : []); };
        }),
        put: (item) => new Promise((resolve, reject) => {
            const tx = STATE.db.transaction("fonts", "readwrite");
            const req = tx.objectStore("fonts").put(item);
            req.onsuccess = resolve;
            req.onerror = reject;
        }),
        delete: (key) => new Promise((resolve, reject) => {
            if (!STATE.db) { reject("DB not init"); return; }
            const tx = STATE.db.transaction("fonts", "readwrite");
            const store = tx.objectStore("fonts");
            const req = store.delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
            req.onerror = (e) => reject(e);
        }),
        clear: () => new Promise((resolve, reject) => {
            if (!STATE.db) { reject("DB not init"); return; }
            const tx = STATE.db.transaction("fonts", "readwrite");
            const store = tx.objectStore("fonts");
            const req = store.clear();
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
            req.onerror = (e) => reject(e);
        })
    };

    // --- 2. Security & Single Style System ---
    const MasterStyle = {
        sheet: null,
        init: () => {
            if (document.getElementById('fsp-styles')) return;
            const style = document.createElement('style');
            style.id = 'fsp-styles';
            document.head.appendChild(style);
            MasterStyle.sheet = style.sheet;
        },
        insert: (rule) => {
            try {
                MasterStyle.sheet.insertRule(rule, MasterStyle.sheet.cssRules.length);
            } catch (e) { console.warn("CSS Inject Warn", e); }
        },
        remove: (fontId) => {
            const rules = MasterStyle.sheet.cssRules;
            for (let i = 0; i < rules.length; i++) {
                if (rules[i].cssText.includes(`font-family: "${fontId}"`)) {
                    MasterStyle.sheet.deleteRule(i);
                    return; 
                }
            }
        },
        clear: () => {
            while (MasterStyle.sheet.cssRules.length > 0) {
                MasterStyle.sheet.deleteRule(0);
            }
        }
    };

    const Security = {
        safeFontId: (fileName, blob) => {
            const size = blob instanceof Blob ? blob.size : 0;
            const type = blob instanceof Blob ? (blob.type || 'na') : 'na';
            const base = fileName + "_" + size + "_" + type;
            const encodedBase = unescape(encodeURIComponent(base));
            const safeStr = fileName.replace(/[^a-zA-Z0-9]/g, '_');
            const hash = btoa(encodedBase).replace(/=/g, '').slice(0, 8);
            return "f_" + safeStr.slice(0, 20) + "_" + hash;
        },
        sanitizeTag: (str) => {
            if (!str) return '';
            return str.trim().slice(0, 40)
                      .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E]/g, '');
        },
        create: (tag, className, textContent) => {
            const el = document.createElement(tag);
            if (className) el.className = className;
            if (textContent) el.textContent = textContent;
            return el;
        },
        // --- Added: Magic Bytes Check ---
        checkSignature: (file) => {
            return new Promise((resolve) => {
                const slice = file.slice(0, 4);
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const view = new DataView(e.target.result);
                        if (view.byteLength < 4) return resolve(false);
                        const magic = view.getUint32(0, false); // Big-endian
                        // TTF=00010000, OTF=4F54544F, WOFF=774F4646, WOFF2=774F4632
                        const valid = [0x00010000, 0x4F54544F, 0x774F4646, 0x774F4632].includes(magic);
                        resolve(valid);
                    } catch (err) { resolve(false); }
                };
                reader.onerror = () => resolve(false);
                reader.readAsArrayBuffer(slice);
            });
        }
    };

    // --- 3. Core Logic ---
    async function init() {
        MasterStyle.init();
        const theme = localStorage.getItem('theme') || 'light';
        setTheme(theme);

        try {
            await DB.init();
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => loadFonts());
            } else {
                setTimeout(loadFonts, 10);
            }
        } catch (e) {
            console.error(e);
            toast("فشل تحميل البيانات", "error");
        }
        
        setupListeners();
        lucide.createIcons();
    }

    async function loadFonts() {
        STATE.fonts = await DB.getAll();

        DOM.grid.innerHTML = '';
        STATE.renderedMap.clear();
        STATE.previewNodes = [];
        
        MasterStyle.clear();
        STATE.loadedFonts.clear();

        filter();
    }

    function getFontUrl(fileName, data) {
        if (STATE.objectUrls.has(fileName)) return STATE.objectUrls.get(fileName);
        let url;
        if (data instanceof Blob) url = URL.createObjectURL(data);
        else if (typeof data === 'string') url = data;
        else return null;
        STATE.objectUrls.set(fileName, url);
        return url;
    }

    function injectFontFace(fileName, data) {
        const fontId = Security.safeFontId(fileName, data);
        if (STATE.loadedFonts.has(fontId)) return fontId;

        const url = getFontUrl(fileName, data);
        if (!url) return null;

        const rule = `@font-face { font-family: "${fontId}"; src: url("${url}"); font-display: swap; }`;
        MasterStyle.insert(rule);
        
        STATE.loadedFonts.add(fontId);
        return fontId;
    }

    function filter() {
        const q = STATE.search.toLowerCase();
        STATE.filtered = STATE.fonts.filter(f => 
            (f.fileName && f.fileName.toLowerCase().includes(q)) || 
            (f.userTag && f.userTag.toLowerCase().includes(q))
        );
        render();
    }

    // --- 4. Rendering ---
    function render() {
        DOM.total.textContent = STATE.fonts.length;
        DOM.shown.textContent = STATE.filtered.length;

        const validKeys = new Set(STATE.filtered.map(f => f.fileName));

        // Cleanup DOM
        for (const [fileName, entry] of STATE.renderedMap) {
            if (!validKeys.has(fileName)) {
                entry.card.remove();
                STATE.renderedMap.delete(fileName);
            }
        }

        let iconsDirty = false;

        if (STATE.filtered.length === 0) {
            if (!document.getElementById('emptyState')) {
                const empty = Security.create('div', '', '');
                empty.id = 'emptyState';
                empty.style.cssText = "grid-column:1/-1; text-align:center; padding:4rem; color:var(--text-tertiary);";
                
                const icon = Security.create('i');
                icon.setAttribute('data-lucide', 'ghost');
                icon.setAttribute('width', '32');
                icon.style.cssText = "opacity:0.5; margin-bottom:1rem;";
                
                const text = Security.create('p', '', 'لا توجد خطوط');
                
                empty.appendChild(icon);
                empty.appendChild(text);
                DOM.grid.appendChild(empty);
                iconsDirty = true;
            }
        } else {
            const empty = document.getElementById('emptyState');
            if (empty) empty.remove();
        }

        // Reset previewNodes
        STATE.previewNodes.length = 0;

        STATE.filtered.forEach((font, index) => {
            let entry = STATE.renderedMap.get(font.fileName);

            if (!entry) {
                const fontId = injectFontFace(font.fileName, font.data);
                if (!fontId) return;

                const card = Security.create('div', 'font-card');
                
                // --- Single Delete Button Implementation ---
                const btnDelete = Security.create('button', 'btn-delete-card');
                btnDelete.title = "حذف الخط";
                const iconDel = Security.create('i');
                iconDel.setAttribute('data-lucide', 'trash-2');
                iconDel.setAttribute('width', '14');
                btnDelete.appendChild(iconDel);
                
                btnDelete.onclick = (e) => {
                    e.stopPropagation(); // Stop card click
                    deleteSingleFont(font.fileName);
                };
                card.appendChild(btnDelete);
                // -------------------------------------------

                const preview = Security.create('div', 'card-preview', STATE.previewText);
                preview.style.fontFamily = `"${fontId}"`;
                card.appendChild(preview);

                const meta = Security.create('div', 'card-meta');
                const nameEl = Security.create('div', 'font-name', font.fileName.replace(/\.[^/.]+$/, ""));
                nameEl.onclick = () => copyText(nameEl.textContent);
                nameEl.title = font.fileName;

                const tagInput = Security.create('input', 'tag-input');
                tagInput.placeholder = "+وسم";
                tagInput.value = font.userTag || '';
                tagInput.onchange = (e) => updateTag(font.fileName, e.target.value);

                meta.appendChild(nameEl);
                meta.appendChild(tagInput);
                card.appendChild(meta);

                entry = { card, preview };
                STATE.renderedMap.set(font.fileName, entry);
                
                iconsDirty = true; 
            }

            const currentChild = DOM.grid.children[index];
            if (currentChild !== entry.card) {
                if (index >= DOM.grid.children.length) {
                    DOM.grid.appendChild(entry.card);
                } else {
                    DOM.grid.insertBefore(entry.card, currentChild);
                }
            }
            
            STATE.previewNodes.push(entry.preview);
        });

        if (iconsDirty) {
            lucide.createIcons({ root: DOM.grid });
        }
    }

    // --- 5. Actions (Secured) ---
    async function handleUpload(files) {
        if (STATE.isProcessing) return;
        const validExtensions = ['.ttf', '.otf', '.woff', '.woff2'];
        const validFiles = Array.from(files).filter(f => validExtensions.some(ext => f.name.toLowerCase().endsWith(ext)));

        if (!validFiles.length) return toast("صيغة الملف غير مدعومة", "error");

        // --- LIMIT CHECK ---
        if (STATE.fonts.length + validFiles.length > MAX_FONTS) {
            return toast(`الحد الأقصى ${MAX_FONTS} خط. يرجى حذف بعض الخطوط أولاً.`, "error");
        }

        // --- STORAGE OVERFLOW PROTECTION ---
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const { quota, usage } = await navigator.storage.estimate();
                const totalUploadSize = validFiles.reduce((acc, f) => acc + f.size, 0);
                if ((quota - usage) < totalUploadSize) {
                    return toast("لا توجد مساحة تخزين كافية", "error");
                }
            } catch (err) { console.warn("Storage estimate failed", err); }
        }

        STATE.isProcessing = true;
        updateProgress(0, true);

        let successCount = 0;
        const total = validFiles.length;

        for (let i = 0; i < total; i++) {
            const file = validFiles[i];
            
            // 1. Check Size
            if (file.size > MAX_FILE_SIZE) {
                toast(`تجاوز الحجم المسموح (50MB): ${file.name}`, "error");
                updateProgress(((i + 1) / total) * 100, true);
                continue;
            }

            try {
                // 2. Check Magic Bytes (Signature)
                const isValidSignature = await Security.checkSignature(file);
                if (!isValidSignature) {
                    toast(`ملف غير صالح كخط: ${file.name}`, "error");
                    updateProgress(((i + 1) / total) * 100, true);
                    continue;
                }

                // 3. Read & Save
                const exists = STATE.fonts.find(f => f.fileName === file.name);
                const tag = exists ? exists.userTag : '';
                const buffer = await readFileBuffer(file); // Wrapped in try/catch
                const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });
                
                await DB.put({ fileName: file.name, data: blob, userTag: tag });
                successCount++;

            } catch (e) { 
                console.warn(e);
                toast(`فشل قراءة الملف: ${file.name}`, "error");
            }

            updateProgress(((i + 1) / total) * 100, true);
            
            // 4. Anti-Freeze
            await new Promise(r => requestAnimationFrame(r));
        }

        setTimeout(() => {
            updateProgress(100, false);
            STATE.isProcessing = false;
            loadFonts();
            if (successCount > 0) toast(`تم رفع ${successCount} خط بنجاح`);
        }, 600);
    }

    function readFileBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // --- Single Font Deletion ---
    function deleteSingleFont(fileName) {
        if (!confirm(`حذف الخط "${fileName}"؟`)) return;

        DB.delete(fileName).then(() => {
            // Update State
            STATE.fonts = STATE.fonts.filter(f => f.fileName !== fileName);
            STATE.filtered = STATE.filtered.filter(f => f.fileName !== fileName);

            // Memory Clean
            if (STATE.objectUrls.has(fileName)) {
                URL.revokeObjectURL(STATE.objectUrls.get(fileName));
                STATE.objectUrls.delete(fileName);
            }

            // DOM Cleanup (Fast removal)
            const entry = STATE.renderedMap.get(fileName);
            if (entry) {
                entry.card.remove();
                STATE.renderedMap.delete(fileName);
            }

            // Re-sync
            filter();
            toast("تم حذف الخط");

        }).catch(e => {
            toast("فشل الحذف", "error");
            console.warn(e);
        });
    }

    // --- Clear All ---
    function clearAll() {
        if (!confirm("حذف المكتبة بالكامل؟")) return;
        if (STATE.isProcessing) return;

        STATE.isProcessing = true;
        
        DB.clear()
            .then(() => {
                STATE.objectUrls.forEach(url => URL.revokeObjectURL(url));
                STATE.objectUrls.clear();
                return loadFonts();
            })
            .then(() => {
                toast("تم تنظيف المكتبة");
            })
            .catch(e => {
                console.warn("Clear failed", e);
                toast("فشل التنظيف", "error");
            })
            .finally(() => {
                STATE.isProcessing = false;
            });
    }

    function updateTag(fileName, rawTag) {
        const tag = Security.sanitizeTag(rawTag);
        const font = STATE.fonts.find(f => f.fileName === fileName);
        if (font) { font.userTag = tag; DB.put(font); }
    }

    // --- 6. Export ---
    async function exportPDF() {
        if (STATE.search && STATE.filtered.length === 0) {
            return toast("لا توجد نتائج للتصدير", "error");
        }
        if (!STATE.fonts.length) return toast("لا توجد بيانات", "error");

        STATE.isProcessing = true;
        updateProgress(0, true);

        const tbody = document.getElementById('printBody');
        tbody.innerHTML = '';
        const list = STATE.filtered.length ? STATE.filtered : STATE.fonts;
        const total = list.length;
        const CHUNK_SIZE = 20;

        for (let i = 0; i < total; i += CHUNK_SIZE) {
            const chunk = list.slice(i, i + CHUNK_SIZE);
            const fragment = document.createDocumentFragment();

            chunk.forEach(font => {
                const fontId = injectFontFace(font.fileName, font.data);
                if (!fontId) return;
                const tr = document.createElement('tr');
                const tdPrev = document.createElement('td');
                tdPrev.textContent = STATE.previewText;
                tdPrev.style.fontFamily = `"${fontId}"`;
                tdPrev.style.fontSize = "20px";
                const tdName = document.createElement('td');
                tdName.textContent = font.fileName;
                const tdTag = document.createElement('td');
                tdTag.textContent = font.userTag || '-';
                tr.append(tdPrev, tdName, tdTag);
                fragment.appendChild(tr);
            });

            tbody.appendChild(fragment);
            updateProgress(Math.min(((i + CHUNK_SIZE) / total) * 100, 100), true);
            await new Promise(r => requestAnimationFrame(r));
        }

        setTimeout(() => {
            updateProgress(100, false);
            STATE.isProcessing = false;
            window.print();
        }, 500);
    }

    // --- 7. Utils & Events ---
    function updateProgress(pct, show) {
        DOM.progress.style.width = show ? `${pct}%` : '0';
        if (show) { DOM.loaderText.textContent = `${Math.floor(pct)}%`; DOM.loaderText.classList.add('active'); }
        else { setTimeout(() => DOM.loaderText.classList.remove('active'), 300); }
    }

    function toast(msg, type = 'success') {
        document.getElementById('toastMsg').textContent = msg;
        const t = document.getElementById('toast');
        t.classList.add('active');
        t.style.backgroundColor = type === 'error' ? 'var(--danger)' : 'var(--accent)';
        setTimeout(() => t.classList.remove('active'), 3000);
    }

    function copyText(text) { 
        navigator.clipboard.writeText(text)
            .then(() => toast("تم نسخ الاسم"))
            .catch(e => console.warn("Clipboard failed", e)); 
    }
    
    function setTheme(t) {
        document.body.setAttribute('data-theme', t);
        localStorage.setItem('theme', t);
        document.getElementById('themeIcon').setAttribute('data-lucide', t === 'dark' ? 'sun' : 'moon');
        lucide.createIcons();
    }

    function setupListeners() {
        let searchTimeout;
        DOM.search.addEventListener('input', e => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                STATE.search = e.target.value;
                filter();
            }, 100);
        });
        
        let previewTimeout;
        DOM.preview.addEventListener('input', e => {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(() => {
                STATE.previewText = e.target.value || "نص افتراضي";
                for (let i = 0, len = STATE.previewNodes.length; i < len; i++) {
                    STATE.previewNodes[i].textContent = STATE.previewText;
                }
            }, 100);
        });

        DOM.fileInput.onchange = e => handleUpload(e.target.files);
        DOM.dropZone.ondragover = e => { e.preventDefault(); DOM.dropZone.classList.add('active'); };
        DOM.dropZone.ondragleave = e => { e.preventDefault(); DOM.dropZone.classList.remove('active'); };
        DOM.dropZone.ondrop = e => { e.preventDefault(); DOM.dropZone.classList.remove('active'); handleUpload(e.dataTransfer.files); };
    }

    return {
        init, exportPDF, clearAll,
        toggleTheme: () => setTheme(localStorage.getItem('theme') === 'dark' ? 'light' : 'dark'),
        toggleSidebar: () => { DOM.sidebar.classList.toggle('active'); DOM.overlay.classList.toggle('active'); }
    };
})();

// Initialize App
window.addEventListener('DOMContentLoaded', App.init);

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW Registered'))
            .catch(err => console.warn('SW Fail', err));
    });
}