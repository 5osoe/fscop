/* ═══════════════════════════════════════
   Font Pro Logic - Performance Optimized
   ═══════════════════════════════════════ */

const App = (function () {
    
    // إعدادات الحالة
    const STATE = {
        dbName: 'FontProDB',
        dbVersion: 1,
        storeName: 'fonts',
        db: null,
        fonts: [],
        previewText: 'سبحان الله وبحمده',
        previewSize: 32,
        previewColor: '#000000',
        searchQuery: '',
        loadedFonts: new Set(), // لتجنب إعادة تحميل الخط للمتصفح
        maxFonts: 750,
        maxSizeMB: 75 // 75 ميجابايت تقريبياً
    };

    const DOM = {
        grid: document.getElementById('fontGrid'),
        empty: document.getElementById('emptyState'),
        count: document.getElementById('countDisplay'),
        fill: document.getElementById('storageFill'),
        search: document.getElementById('searchInput'),
        preview: document.getElementById('previewInput'),
        color: document.getElementById('colorPicker'),
        sizeVal: document.getElementById('sizeValue')
    };

    // ─── 1. تهيئة قاعدة البيانات (IndexedDB) ───
    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(STATE.dbName, STATE.dbVersion);
            
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STATE.storeName)) {
                    db.createObjectStore(STATE.storeName, { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (e) => {
                STATE.db = e.target.result;
                resolve();
            };

            request.onerror = (e) => {
                showToast("خطأ في قاعدة البيانات", true);
                reject(e);
            };
        });
    }

    // ─── 2. وظائف البيانات (CRUD) ───
    async function loadFonts() {
        const tx = STATE.db.transaction(STATE.storeName, 'readonly');
        const store = tx.objectStore(STATE.storeName);
        const request = store.getAll();

        request.onsuccess = () => {
            STATE.fonts = request.result || [];
            updateStats();
            renderGrid();
        };
    }

    async function addFonts(files) {
        if (STATE.fonts.length >= STATE.maxFonts) {
            return showToast(`تم الوصول للحد الأقصى (${STATE.maxFonts} خط)`);
        }

        let addedCount = 0;
        const tx = STATE.db.transaction(STATE.storeName, 'readwrite');
        const store = tx.objectStore(STATE.storeName);

        Array.from(files).forEach(file => {
            // التحقق من الامتداد
            if (!file.name.match(/\.(ttf|otf|woff|woff2)$/i)) return;
            
            // التحقق من حجم الملفات الكلي (تبسيط: نتحقق من العدد هنا، الحجم يعتمد على المتصفح)
            // الحفظ
            const fontData = {
                name: file.name.replace(/\.[^/.]+$/, ""), // إزالة الامتداد
                type: file.type,
                blob: file,
                tag: '',
                date: Date.now()
            };
            store.add(fontData);
            addedCount++;
        });

        tx.oncomplete = () => {
            if (addedCount > 0) {
                showToast(`تمت إضافة ${addedCount} خط بنجاح`);
                loadFonts(); // إعادة التحميل
            }
        };
    }

    function deleteFont(id) {
        if(!confirm('هل أنت متأكد من حذف هذا الخط؟')) return;
        
        const tx = STATE.db.transaction(STATE.storeName, 'readwrite');
        tx.objectStore(STATE.storeName).delete(id);
        tx.oncomplete = () => {
            STATE.fonts = STATE.fonts.filter(f => f.id !== id);
            // إزالة الخط من الذاكرة إذا أمكن (CSS Font Loading API لا يدعم الحذف المباشر بسهولة، لكنه لن يظهر)
            renderGrid();
            updateStats();
            showToast('تم الحذف');
        };
    }

    function clearAll() {
        if(!confirm('تحذير: سيتم حذف جميع الخطوط من المكتبة!')) return;
        
        const tx = STATE.db.transaction(STATE.storeName, 'readwrite');
        tx.objectStore(STATE.storeName).clear();
        tx.oncomplete = () => {
            STATE.fonts = [];
            window.location.reload(); // أسهل طريقة لتنظيف الذاكرة
        };
    }

    function updateTag(id, newTag) {
        const font = STATE.fonts.find(f => f.id === id);
        if (font) {
            font.tag = newTag;
            const tx = STATE.db.transaction(STATE.storeName, 'readwrite');
            tx.objectStore(STATE.storeName).put(font);
        }
    }

    // ─── 3. إدارة تحميل الخطوط (Font Loading API) ───
    async function activateFont(fontObj) {
        // إنشاء اسم فريد CSS Safe
        const familyName = `font_${fontObj.id}`;
        
        if (STATE.loadedFonts.has(familyName)) return familyName;

        try {
            const buffer = await fontObj.blob.arrayBuffer();
            const fontFace = new FontFace(familyName, buffer);
            await fontFace.load();
            document.fonts.add(fontFace);
            STATE.loadedFonts.add(familyName);
            return familyName;
        } catch (err) {
            console.error('فشل تحميل الخط:', fontObj.name);
            return 'sans-serif'; // Fallback
        }
    }

    // ─── 4. العرض (Rendering) ───
    function renderGrid() {
        const query = STATE.searchQuery.toLowerCase();
        const filtered = STATE.fonts.filter(f => f.name.toLowerCase().includes(query));

        // حالة فارغة
        if (STATE.fonts.length === 0) {
            DOM.grid.style.display = 'none';
            DOM.empty.style.display = 'flex';
            return;
        } else {
            DOM.grid.style.display = 'grid';
            DOM.empty.style.display = 'none';
        }

        DOM.grid.innerHTML = '';
        
        // استخدام DocumentFragment للأداء
        const frag = document.createDocumentFragment();

        filtered.forEach(font => {
            const card = document.createElement('div');
            card.className = 'font-card';
            
            // سنقوم بتحميل الخط فقط عند إنشاء البطاقة
            // ملاحظة: لتحسين الأداء أكثر يمكن استخدام IntersectionObserver لتحميل الخطوط فقط عند ظهورها
            activateFont(font).then(family => {
                const previewEl = card.querySelector('.card-preview-text');
                if(previewEl) previewEl.style.fontFamily = `"${family}", sans-serif`;
            });

            card.innerHTML = `
                <div class="card-header">
                    <span class="font-name" title="${font.name}">${font.name}</span>
                    <button class="btn-delete" onclick="App.deleteFont(${font.id})">
                        <i data-lucide="x" width="16"></i>
                    </button>
                </div>
                <div class="card-preview" style="color: ${STATE.previewColor}">
                    <span class="card-preview-text" style="font-size: ${STATE.previewSize}px;">
                        ${STATE.previewText}
                    </span>
                </div>
                <div class="card-footer">
                    <input type="text" class="tag-input" 
                           placeholder="أضف وسم..." 
                           value="${font.tag || ''}"
                           onchange="App.updateTag(${font.id}, this.value)">
                </div>
            `;
            frag.appendChild(card);
        });

        DOM.grid.appendChild(frag);
        if (window.lucide) lucide.createIcons();
    }

    // تحديثات خفيفة (تغيير الحجم/اللون/النص) دون إعادة بناء DOM
    function updateVisuals() {
        const previews = document.querySelectorAll('.card-preview-text');
        const containers = document.querySelectorAll('.card-preview');
        
        requestAnimationFrame(() => {
            containers.forEach(el => el.style.color = STATE.previewColor);
            previews.forEach(el => {
                el.style.fontSize = `${STATE.previewSize}px`;
                el.textContent = STATE.previewText;
            });
        });
        
        DOM.sizeVal.textContent = STATE.previewSize;
    }

    function updateStats() {
        const count = STATE.fonts.length;
        DOM.count.textContent = count;
        const pct = (count / STATE.maxFonts) * 100;
        DOM.fill.style.width = `${pct}%`;
        
        // تغيير لون البار إذا اقترب من الامتلاء
        DOM.fill.style.background = pct > 90 ? '#d32f2f' : 'var(--primary)';
    }

    // ─── 5. التصدير (PDF) ───
    async function exportPDF() {
        if (STATE.fonts.length === 0) return showToast('لا توجد خطوط للتصدير', true);
        
        showToast('جاري تحضير المستند...');
        const tbody = document.getElementById('printBody');
        tbody.innerHTML = '';
        document.getElementById('printDate').textContent = new Date().toLocaleDateString('ar-EG');

        // ننتظر تحميل جميع الخطوط لضمان ظهورها في الطباعة
        const loadPromises = STATE.fonts.map(f => activateFont(f));
        await Promise.all(loadPromises);

        STATE.fonts.forEach(font => {
            const family = `font_${font.id}`;
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${font.name}</strong></td>
                <td class="preview-cell" style="font-family: '${family}';">${STATE.previewText}</td>
                <td>${font.tag || '-'}</td>
            `;
            tbody.appendChild(row);
        });

        // تأخير بسيط لضمان الريندر
        setTimeout(() => window.print(), 500);
    }

    // ─── 6. الأدوات المساعدة ───
    function showToast(msg, isError = false) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.style.background = isError ? '#D32F2F' : '#333';
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    // ─── 7. التهيئة والربط ───
    function init() {
        initDB().then(loadFonts);

        // Events
        document.getElementById('fileUpload').onchange = (e) => addFonts(e.target.files);
        document.getElementById('fileUploadEmpty').onchange = (e) => addFonts(e.target.files);
        
        DOM.search.oninput = (e) => {
            STATE.searchQuery = e.target.value;
            renderGrid();
        };

        DOM.preview.oninput = (e) => {
            STATE.previewText = e.target.value || 'Preview';
            updateVisuals();
        };

        DOM.color.oninput = (e) => {
            STATE.previewColor = e.target.value;
            updateVisuals();
        };

        document.getElementById('sizeInc').onclick = () => {
            if(STATE.previewSize < 100) { STATE.previewSize += 4; updateVisuals(); }
        };
        document.getElementById('sizeDec').onclick = () => {
            if(STATE.previewSize > 12) { STATE.previewSize -= 4; updateVisuals(); }
        };

        document.getElementById('btnClear').onclick = clearAll;
        document.getElementById('btnExport').onclick = exportPDF;

        // Init Icons
        if (window.lucide) lucide.createIcons();
    }

    // تصدير الوظائف التي تحتاجها HTML
    return {
        init,
        deleteFont,
        updateTag
    };

})();

window.addEventListener('DOMContentLoaded', App.init);