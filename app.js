/* ═══════════════════════════════════════
   Font Scope OS — Logic
═══════════════════════════════════════ */

const App = (function () {

  const STATE = {
    fonts: [],
    previewText: 'Simplicity is the ultimate sophistication',
    previewSize: 32,
    previewColor: '#FFFFFF',
    search: '',
    db: null,
    loaded: new Set(),
    isProcessing: false
  };

  const DOM = {};

  /* ── Init ── */
  function init() {
    cacheDOM();
    bindEvents();
    setupDB().then(loadFonts);
    applyTheme();
    
    // Init Lucide icons
    if (window.lucide) lucide.createIcons();
  }

  function cacheDOM() {
    DOM.grid = document.getElementById('fontGrid');
    DOM.totalFonts = document.getElementById('totalFonts');
    DOM.capFill = document.getElementById('capFill');
    DOM.capFillM = document.getElementById('capFillM');
    DOM.emptyState = document.getElementById('emptyState');
    
    // Inputs
    DOM.previewInput = document.getElementById('previewInput');
    DOM.searchInput = document.getElementById('searchInput');
    DOM.fileInput = document.getElementById('fileInput');
    DOM.fileInputM = document.getElementById('fileInputM');
    
    // Visuals
    DOM.sizeVal = document.getElementById('sizeVal');
    DOM.colorInput = document.getElementById('colorInput');
    DOM.colorDot = document.getElementById('colorDot');
    
    // Print
    DOM.printBody = document.getElementById('printBody');
  }

  /* ── Database (IndexedDB) ── */
  function setupDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('FontScopeOS_DB', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('fonts'))
          db.createObjectStore('fonts', { keyPath: 'name' });
      };
      req.onsuccess = e => { STATE.db = e.target.result; resolve(); };
      req.onerror = reject;
    });
  }

  async function loadFonts() {
    const tx = STATE.db.transaction('fonts', 'readonly');
    const req = tx.objectStore('fonts').getAll();
    req.onsuccess = () => {
      STATE.fonts = req.result || [];
      render();
    };
  }

  async function saveFont(file) {
    // Basic validation
    if (STATE.fonts.length >= 750) return showToast('Library full (750 Max)', true);
    
    const buffer = await file.arrayBuffer();
    const blob = new Blob([buffer], { type: file.type });
    const fontItem = {
      name: file.name,
      data: blob,
      tag: '',
      date: Date.now()
    };

    const tx = STATE.db.transaction('fonts', 'readwrite');
    tx.objectStore('fonts').put(fontItem);
    tx.oncomplete = () => {
      STATE.fonts.push(fontItem);
      render();
      showToast(`Added: ${file.name}`);
    };
    tx.onerror = () => showToast('Error saving font', true);
  }

  function deleteFont(name) {
    if(!confirm('Delete this font?')) return;
    const tx = STATE.db.transaction('fonts', 'readwrite');
    tx.objectStore('fonts').delete(name);
    tx.oncomplete = () => {
      STATE.fonts = STATE.fonts.filter(f => f.name !== name);
      render();
      showToast('Font deleted');
    };
  }

  function clearAll() {
    if(!confirm('ERASE ALL DATA?')) return;
    const tx = STATE.db.transaction('fonts', 'readwrite');
    tx.objectStore('fonts').clear();
    tx.oncomplete = () => {
      STATE.fonts = [];
      render();
      showToast('Library wiped');
    };
  }

  /* ── Font Loading ── */
  function injectFont(font) {
    const id = 'f_' + font.name.replace(/[^a-zA-Z0-9]/g, '');
    if (STATE.loaded.has(id)) return id;

    const url = URL.createObjectURL(font.data);
    const face = new FontFace(id, `url(${url})`);
    
    face.load().then(f => {
      document.fonts.add(f);
      STATE.loaded.add(id);
      URL.revokeObjectURL(url); // Clean up
    }).catch(e => console.warn(e));

    return id;
  }

  /* ── Rendering ── */
  function render() {
    const q = STATE.search.toLowerCase();
    const filtered = STATE.fonts.filter(f => f.name.toLowerCase().includes(q));
    
    DOM.grid.innerHTML = '';
    
    // Stats
    const count = STATE.fonts.length;
    DOM.totalFonts.textContent = count;
    const pct = (count / 750) * 100;
    DOM.capFill.style.width = pct + '%';
    if(DOM.capFillM) DOM.capFillM.style.width = pct + '%';

    // Empty state
    if (filtered.length === 0) {
      DOM.emptyState.style.display = 'flex';
      return;
    }
    DOM.emptyState.style.display = 'none';

    // Build Cards
    const frag = document.createDocumentFragment();
    
    filtered.forEach(font => {
      const family = injectFont(font);
      
      const card = document.createElement('div');
      card.className = 'font-card';
      
      card.innerHTML = `
        <div class="card-top">
          <span class="card-name" title="${font.name}">${font.name}</span>
          <button class="icon-action btn-del" aria-label="Delete">
            <i data-lucide="x" width="14" height="14"></i>
          </button>
        </div>
        <div class="card-preview" style="font-family: '${family}'; font-size: ${STATE.previewSize}px; color: ${STATE.previewColor};">
          <span>${STATE.previewText}</span>
        </div>
        <div class="card-footer">
          <input type="text" class="tag-input" placeholder="+ Add Tag" value="${font.tag || ''}">
        </div>
      `;

      // Event: Delete
      card.querySelector('.btn-del').onclick = () => deleteFont(font.name);
      
      // Event: Update Tag
      const tagInput = card.querySelector('.tag-input');
      tagInput.onchange = (e) => {
        font.tag = e.target.value;
        const tx = STATE.db.transaction('fonts', 'readwrite');
        tx.objectStore('fonts').put(font);
      };

      frag.appendChild(card);
    });

    DOM.grid.appendChild(frag);
    if (window.lucide) lucide.createIcons({ root: DOM.grid });
  }

  /* ── UI Actions ── */
  function updatePreview() {
    // Efficiently update CSS variables or specific styles if needed
    // Here we re-render styles on existing nodes to avoid full re-render
    const nodes = document.querySelectorAll('.card-preview');
    nodes.forEach(n => {
      n.style.fontSize = STATE.previewSize + 'px';
      n.style.color = STATE.previewColor;
      n.querySelector('span').textContent = STATE.previewText;
    });
    
    DOM.sizeVal.textContent = STATE.previewSize;
    DOM.colorDot.style.background = STATE.previewColor;
    
    // Update Theme specific
    const theme = document.body.getAttribute('data-theme');
    if(theme === 'light' && STATE.previewColor === '#FFFFFF') {
       // Auto switch logic if needed, but keeping manual for now
    }
  }

  function handleFiles(files) {
    Array.from(files).forEach(file => {
      if(file.name.match(/\.(ttf|otf|woff|woff2)$/i)) {
        saveFont(file);
      }
    });
  }

  /* ── Strict PDF Export ── */
  function exportPDF() {
    DOM.printBody.innerHTML = '';
    
    if (STATE.fonts.length === 0) return showToast('No fonts to export', true);
    
    const frag = document.createDocumentFragment();
    
    STATE.fonts.forEach(font => {
      const family = injectFont(font); // Ensure loaded
      const tr = document.createElement('tr');
      
      tr.innerHTML = `
        <td class="col-name">${font.name}</td>
        <td class="col-preview" style="font-family: '${family}';">${STATE.previewText}</td>
        <td class="col-tag">${font.tag || '—'}</td>
      `;
      frag.appendChild(tr);
    });
    
    DOM.printBody.appendChild(frag);
    window.print();
  }

  /* ── Helpers ── */
  function showToast(msg, error = false) {
    const t = document.getElementById('toast');
    const m = document.getElementById('toastMsg');
    const d = document.querySelector('.toast-dot');
    
    m.textContent = msg;
    d.style.background = error ? '#FF0000' : 'var(--accent)';
    d.style.boxShadow = error ? '0 0 8px #FF0000' : '0 0 8px var(--accent)';
    
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  /* ── Events ── */
  function bindEvents() {
    // Inputs
    DOM.searchInput.oninput = (e) => { STATE.search = e.target.value; render(); };
    DOM.previewInput.oninput = (e) => { STATE.previewText = e.target.value || 'Preview'; updatePreview(); };
    
    // Display Controls
    document.getElementById('btnSizeUp').onclick = () => { STATE.previewSize = Math.min(100, STATE.previewSize + 4); updatePreview(); };
    document.getElementById('btnSizeDown').onclick = () => { STATE.previewSize = Math.max(12, STATE.previewSize - 4); updatePreview(); };
    DOM.colorInput.oninput = (e) => { STATE.previewColor = e.target.value; updatePreview(); };
    
    // Actions
    DOM.fileInput.onchange = (e) => handleFiles(e.target.files);
    DOM.fileInputM.onchange = (e) => handleFiles(e.target.files);
    document.getElementById('btnClear').onclick = clearAll;
    document.getElementById('btnClearM').onclick = clearAll;
    
    // Theme
    document.getElementById('btnTheme').onclick = () => {
      const current = document.body.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-theme', next);
      // Auto-contrast preview color
      if (next === 'light') { 
          STATE.previewColor = '#000000'; 
          DOM.colorInput.value = '#000000';
      } else { 
          STATE.previewColor = '#FFFFFF'; 
          DOM.colorInput.value = '#FFFFFF';
      }
      updatePreview();
    };

    // Export
    document.getElementById('btnExport').onclick = exportPDF;
    document.getElementById('btnExportM').onclick = exportPDF;

    // Mobile Drawer
    const drawer = document.getElementById('mobileDrawer');
    const overlay = document.getElementById('mobileOverlay');
    const openBtn = document.getElementById('btnMenu');
    const closeBtn = document.getElementById('btnCloseDrawer');

    const toggleDrawer = (open) => {
      if(open) {
        drawer.classList.add('open');
        overlay.classList.add('open');
      } else {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
      }
    };

    openBtn.onclick = () => toggleDrawer(true);
    closeBtn.onclick = () => toggleDrawer(false);
    overlay.onclick = () => toggleDrawer(false);

    // Drag & Drop
    const dropZone = document.getElementById('dropOverlay');
    window.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('active'); };
    window.ondragleave = (e) => { if(e.relatedTarget === null) dropZone.classList.remove('active'); };
    window.ondrop = (e) => {
      e.preventDefault();
      dropZone.classList.remove('active');
      handleFiles(e.dataTransfer.files);
    };
  }

  function applyTheme() {
    // Initial set
    if(!document.body.getAttribute('data-theme')) 
      document.body.setAttribute('data-theme', 'dark');
  }

  return { init };
})();

window.addEventListener('DOMContentLoaded', App.init);