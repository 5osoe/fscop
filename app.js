const App = (function () {
    
    const STATE = {
        dbName: 'FontScopeDB',
        storeName: 'fonts',
        db: null,
        fonts: [],
        previewText: 'سبحان الله وبحمده',
        previewSize: 32,
        previewColor: '#000000',
        searchQuery: '',
        loadedFonts: new Set()
    };

    const DOM = {};

    function cacheDOM() {
        DOM.grid = document.getElementById('fontGrid');
        DOM.empty = document.getElementById('emptyState');
        DOM.count = document.getElementById('countDisplay');
        DOM.search = document.getElementById('searchInput');
        DOM.preview = document.getElementById('previewInput');
        DOM.color = document.getElementById('colorPicker');
        DOM.sizeVal = document.getElementById('sizeValue');
        
        // Mobile Drawers
        DOM.overlay = document.getElementById('overlay');
        DOM.panelTune = document.getElementById('panelCustomize');
        DOM.panelSettings = document.getElementById('panelSettings');
    }

    /* ─── Database ─── */
    function initDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(STATE.dbName, 1);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STATE.storeName))
                    db.createObjectStore(STATE.storeName, { keyPath: 'id', autoIncrement: true });
            };
            req.onsuccess = e => { STATE.db = e.target.result; resolve(); };
            req.onerror = reject;
        });
    }

    async function loadFonts() {
        const tx = STATE.db.transaction(STATE.storeName, 'readonly');
        const req = tx.objectStore(STATE.storeName).getAll();
        req.onsuccess = () => {
            STATE.fonts = req.result || [];
            updateStats();
            renderGrid();
        };
    }

    async function addFonts(files) {
        if (STATE.fonts.length >= 750) return showToast('المكتبة ممتلئة (750 خط)');
        
        const tx = STATE.db.transaction(STATE.storeName, 'readwrite');
        const store = tx.objectStore(STATE.storeName);
        let added = 0;

        Array.from(files).forEach(file => {
            if (file.name.match(/\.(ttf|otf|woff|woff2)$/i)) {
                store.add({
                    name: file.name.replace(/\.[^/.]+$/, ""),
                    blob: file,
                    tag: '',
                    date: Date.now()
                });
                added++;
            }
        });

        tx.oncomplete = () => {
            if (added) {
                showToast(`تمت إضافة ${added} خط`);
                loadFonts();
            }
        };
    }

    function deleteFont(id) {
        if(!confirm('حذف هذا الخط؟')) return;
        const tx = STATE.db.transaction(STATE.storeName, 'readwrite');
        tx.objectStore(STATE.storeName).delete(id);
        tx.oncomplete = () => {
            STATE.fonts = STATE.fonts.filter(f => f.id !== id);
            renderGrid();
            updateStats();
            showToast('تم الحذف');
        };
    }

    function clearAll() {
        if(!confirm('هل أنت متأكد من حذف جميع الخطوط؟')) return;
        const tx = STATE.db.transaction(STATE.storeName, 'readwrite');
        tx.objectStore(STATE.storeName).clear();
        tx.oncomplete = () => window.location.reload();
    }

    function updateTag(id, val) {
        const font = STATE.fonts.find(f => f.id === id);
        if(font) {
            font.tag = val;
            const tx = STATE.db.transaction(STATE.storeName, 'readwrite');
            tx.objectStore(STATE.storeName).put(font);
        }
    }

    /* ─── Font Loading ─── */
    async function activateFont(font) {
        const family = `f_${font.id}`;
        if (STATE.loadedFonts.has(family)) return family;
        
        try {
            const buff = await font.blob.arrayBuffer();
            const face = new FontFace(family, buff);
            await face.load();
            document.fonts.add(face);
            STATE.loadedFonts.add(family);
            return family;
        } catch(e) { return 'sans-serif'; }
    }

    /* ─── Rendering ─── */
    function renderGrid() {
        const q = STATE.searchQuery.toLowerCase();
        const list = STATE.fonts.filter(f => f.name.toLowerCase().includes(q));
        
        DOM.grid.style.display = list.length ? 'grid' : 'none';
        DOM.empty.style.display = list.length ? 'none' : 'flex';
        DOM.grid.innerHTML = '';

        const frag = document.createDocumentFragment();
        
        list.forEach(font => {
            const card = document.createElement('div');
            card.className = 'font-card';
            
            // تحميل الخط
            activateFont(font).then(fam => {
                const el = card.querySelector('.preview-text');
                if(el) el.style.fontFamily = `"${fam}"`;
            });

            card.innerHTML = `
                <div class="card-top">
                    <button class="font-name-btn" title="نسخ الاسم" onclick="App.copyName('${font.name}')">
                        ${font.name}
                    </button>
                    <button class="card-del-btn" onclick="App.deleteFont(${font.id})">
                        <i data-lucide="x" width="16"></i>
                    </button>
                </div>
                <div class="card-preview" style="color:${STATE.previewColor}">
                    <span class="preview-text" style="font-size:${STATE.previewSize}px">
                        ${STATE.previewText}
                    </span>
                </div>
                <div class="card-bottom">
                    <input type="text" class="card-tag" placeholder="+ وسم" 
                           value="${font.tag||''}" onchange="App.updateTag(${font.id}, this.value)">
                </div>
            `;
            frag.appendChild(card);
        });
        
        DOM.grid.appendChild(frag);
        if(window.lucide) lucide.createIcons();
    }

    function updateVisuals() {
        const txts = document.querySelectorAll('.preview-text');
        const wins = document.querySelectorAll('.card-preview');
        
        requestAnimationFrame(() => {
            wins.forEach(d => d.style.color = STATE.previewColor);
            txts.forEach(t => {
                t.style.fontSize = STATE.previewSize + 'px';
                t.textContent = STATE.previewText;
            });
            DOM.sizeVal.textContent = STATE.previewSize;
        });
    }

    function updateStats() {
        DOM.count.textContent = STATE.fonts.length;
    }

    function copyName(text) {
        navigator.clipboard.writeText(text).then(() => showToast('تم نسخ اسم الخط'));
    }

    /* ─── Export ─── */
    async function exportPDF() {
        if(!STATE.fonts.length) return;
        showToast('جاري التحضير...');
        
        const body = document.getElementById('printBody');
        body.innerHTML = '';
        document.getElementById('printDate').textContent = new Date().toLocaleDateString('ar');

        await Promise.all(STATE.fonts.map(activateFont));

        STATE.fonts.forEach(f => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${f.name}</td>
                <td style="font-family:'f_${f.id}'; direction:rtl; font-size:24px;">${STATE.previewText}</td>
                <td>${f.tag||''}</td>
            `;
            body.appendChild(tr);
        });
        setTimeout(() => window.print(), 500);
    }

    /* ─── Mobile Logic ─── */
    function toggleDrawer(drawerId, show) {
        const drawer = document.getElementById(drawerId);
        if(show) {
            // Close others first
            DOM.panelTune.classList.remove('active');
            DOM.panelSettings.classList.remove('active');
            
            drawer.classList.add('active');
            DOM.overlay.classList.add('active');
        } else {
            drawer.classList.remove('active');
            DOM.overlay.classList.remove('active');
        }
    }

    function showToast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    }

    function init() {
        cacheDOM();
        initDB().then(loadFonts);
        
        // Events
        DOM.search.oninput = e => { STATE.searchQuery = e.target.value; renderGrid(); };
        DOM.preview.oninput = e => { STATE.previewText = e.target.value||' '; updateVisuals(); };
        DOM.color.oninput = e => { STATE.previewColor = e.target.value; updateVisuals(); };
        
        document.getElementById('sizeInc').onclick = () => { STATE.previewSize+=4; updateVisuals(); };
        document.getElementById('sizeDec').onclick = () => { if(STATE.previewSize>12) STATE.previewSize-=4; updateVisuals(); };
        
        // Buttons
        document.getElementById('fileUploadDesktop').onchange = e => addFonts(e.target.files);
        document.getElementById('fileUploadMobile').onchange = e => addFonts(e.target.files);
        document.getElementById('btnClear').onclick = clearAll;
        document.getElementById('btnExport').onclick = exportPDF;

        // Mobile Drawers
        document.getElementById('btnOpenTune').onclick = () => toggleDrawer('panelCustomize', true);
        document.getElementById('btnOpenMenu').onclick = () => toggleDrawer('panelSettings', true);
        
        DOM.overlay.onclick = () => {
            toggleDrawer('panelCustomize', false);
            toggleDrawer('panelSettings', false);
        };
        
        document.querySelectorAll('.close-panel').forEach(btn => {
            btn.onclick = () => {
                toggleDrawer('panelCustomize', false);
                toggleDrawer('panelSettings', false);
            };
        });

        if(window.lucide) lucide.createIcons();
    }

    return { init, deleteFont, updateTag, copyName };
})();

window.addEventListener('DOMContentLoaded', App.init);