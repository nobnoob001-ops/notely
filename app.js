(() => {
  'use strict';

  const PALETTE = [
    { name: 'Mist', bg: '#E9F0F7', accent: '#6E95B8' },
    { name: 'Sage', bg: '#E9F0E7', accent: '#7FA07C' },
    { name: 'Sand', bg: '#F6EFE2', accent: '#B49A72' },
    { name: 'Blush', bg: '#F7E8E7', accent: '#C08B8B' },
    { name: 'Lavender', bg: '#EEEAF6', accent: '#9887C4' },
    { name: 'Teal', bg: '#E2EFEF', accent: '#6FA6A9' },
    { name: 'Peach', bg: '#F9EDE2', accent: '#C98F62' },
    { name: 'Stone', bg: '#ECEDEF', accent: '#8A8F98' }
  ];

  const STORAGE_KEY = 'notely.notes.v1';
  const COPIABLE = 'p, h1, h2, h3, li, blockquote, pre, a';
  const MAX_COLS = 12;
  const MAX_TABLE_ROWS = 30;

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  const els = {
    newBtn: $('#new-note-btn'),
    search: $('#search-input'),
    list: $('#notes-list'),
    listTitle: $('#notes-title'),
    sort: $('#sort-select'),
    editor: $('#editor'),
    empty: $('#empty-state'),
    title: $('#note-title'),
    content: $('#note-content'),
    pin: $('#pin-btn'),
    color: $('#color-btn'),
    del: $('#delete-btn'),
    toolbar: $('#toolbar'),
    colorbar: $('#note-colorbar'),
    tagInput: $('#tag-input'),
    tagChips: $('#tag-chips'),
    tagList: $('#tag-list'),
    navItems: $$('.nav-item'),
    overlay: $('#sidebar-overlay'),
    searchToggle: $('#search-toggle-btn'),
    back: $('#back-btn'),
    menu: $('#menu-btn'),
    fab: $('#fab'),
    selBar: $('#sel-bar'),
    focusBtn: $('#focus-btn'),
    exportBtn: $('#export-btn'),
    wordCount: $('#word-count'),
    emptyNewBtn: $('#empty-new-btn'),
    attachBtn: $('#attach-btn'),
    fileInput: $('#file-input'),
    recBtn: $('#rec-btn'),
    ocrBtn: $('#ocr-btn'),
    ocrLang: $('#ocr-lang'),
    fontSelect: $('#font-select'),
    attachments: $('#attachments'),
    attachmentList: $('#attachment-list'),
    ocrProgress: $('#ocr-progress'),
    ocrBarFill: $('#ocr-bar-fill'),
    ocrStatus: $('#ocr-status'),
    recBar: $('#rec-bar'),
    recTime: $('#rec-time'),
    recStop: $('#rec-stop'),
    recCancel: $('#rec-cancel'),
    viewer: $('#viewer'),
    viewerBody: $('#viewer-body'),
    viewerClose: $('#viewer-close')
  };

  let notes = loadNotes();
  let activeId = null;
  let filter = 'all';
  let activeTag = null;
  let lastColors = [];
  let saveTimer = null;
  let hoverEl = null;
  let lineCopyBtn = null;
  let hideTimer = null;
  let colorPop = null;
  let lastCellEl = null;
  let totalsPop = null;
  let totalsWrap = null;
  let totalsCol = 0;
  let savedRange = null;
  let mediaRecorder = null;
  let recChunks = [];
  let recStream = null;
  let recStartTs = 0;
  let recTimer = null;

  function loadNotes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function saveNotes() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch (e) {}
  }

  /* ---------- Attachment storage (IndexedDB) ---------- */

  const ATTACH_DB = 'notely.files.v1';
  let idbPromise = null;

  function openDB() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(ATTACH_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('files')) {
          req.result.createObjectStore('files');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return idbPromise;
  }

  async function idbPut(id, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function attachmentIcon(att) {
    if (att.type && att.type.startsWith('image/')) return '🖼';
    if (att.type && att.type.startsWith('audio/')) return '🎵';
    if (att.type === 'application/pdf' || String(att.name).toLowerCase().endsWith('.pdf')) return '📄';
    return '📎';
  }

  function renderAttachments(n) {
    const list = (n && n.attachments) || [];
    els.attachments.classList.toggle('hidden', !list.length);
    els.attachmentList.innerHTML = list.map((a) =>
      `<div class="attach-chip" data-id="${esc(a.id)}">` +
      `<span class="attach-ico">${attachmentIcon(a)}</span>` +
      `<span class="attach-meta">` +
      `<span class="attach-name" title="${esc(a.name)}">${esc(a.name)}</span>` +
      `<span class="attach-size">${fmtSize(a.size || 0)}</span>` +
      `</span>` +
      `<span class="attach-acts">` +
      `<button type="button" data-act="dl" title="Download">⬇</button>` +
      (a.type && a.type.startsWith('image/') ? `<button type="button" data-act="ocr" title="Extract text (OCR)">🔎</button>` : '') +
      `<button type="button" data-act="rm" title="Remove">✕</button>` +
      `</span></div>`
    ).join('');
    list.forEach((a) => {
      const chip = els.attachmentList.querySelector(`[data-id="${a.id}"] .attach-ico`);
      if (chip && a.type && a.type.startsWith('image/')) {
        idbGet(a.id).then((blob) => {
          if (!blob || !chip.isConnected) return;
          chip.textContent = '';
          chip.style.background = 'url(' + URL.createObjectURL(blob) + ') center/cover no-repeat';
        }).catch(() => {});
      }
    });
  }

  async function attachFiles(fileList) {
    const n = getNote(activeId);
    if (!n || !fileList || !fileList.length) return;
    if (!n.attachments) n.attachments = [];
    for (const f of fileList) {
      const id = uid();
      const blob = new Blob([f], { type: f.type || 'application/octet-stream' });
      await idbPut(id, blob);
      n.attachments.push({ id, name: f.name, type: f.type, size: f.size });
      insertInlineMediaAtCursor(inlineMediaMarkup({ name: f.name, type: f.type }, id));
    }
    saveNotes();
    renderAttachments(n);
    showToast(fileList.length === 1 ? 'Attached ✓' : fileList.length + ' files attached ✓');
  }

  async function downloadAttachment(id) {
    const blob = await idbGet(id);
    const n = getNote(activeId);
    const att = n && n.attachments && n.attachments.find((a) => a.id === id);
    if (!blob || !att) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.name || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function removeAttachment(id) {
    const n = getNote(activeId);
    if (!n) return;
    n.attachments = (n.attachments || []).filter((a) => a.id !== id);
    await idbDelete(id);
    saveNotes();
    renderAttachments(n);
    renderList();
  }

  function deleteNoteAttachments(n) {
    (n.attachments || []).forEach((a) => idbDelete(a.id).catch(() => {}));
  }

  /* ---------- Inline media + viewer ---------- */

  function mediaKind(att) {
    if (!att) return 'file';
    const t = att.type || '';
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('audio/')) return 'audio';
    if (t === 'application/pdf' || String(att.name).toLowerCase().endsWith('.pdf')) return 'pdf';
    return 'file';
  }

  function inlineMediaMarkup(att, id) {
    const kind = mediaKind(att);
    if (kind === 'image') {
      return `<div class="media-box media-img" contenteditable="false" data-blob="${id}" data-kind="image">` +
        `<img data-blob="${id}" alt="${esc(att.name)}"></div>`;
    }
    if (kind === 'audio') {
      return `<div class="media-box media-audio" contenteditable="false" data-blob="${id}" data-kind="audio">` +
        `<audio controls data-blob="${id}"></audio></div>`;
    }
    if (kind === 'pdf') {
      return `<div class="media-box media-pdf" contenteditable="false" data-blob="${id}" data-kind="pdf" title="Tap to view">` +
        `<span class="media-file-ico">📄</span><span class="media-file-name">${esc(att.name)}</span></div>`;
    }
    return `<div class="media-box media-file" contenteditable="false" data-blob="${id}" data-kind="file" title="Tap to view">` +
      `<span class="media-file-ico">📎</span><span class="media-file-name">${esc(att.name)}</span></div>`;
  }

  function saveSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { savedRange = null; return; }
    const r = sel.getRangeAt(0).cloneRange();
    savedRange = els.content.contains(r.startContainer) ? r : null;
  }

  function restoreSelection() {
    els.content.focus();
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  function insertInlineMediaAtCursor(markup) {
    restoreSelection();
    const div = document.createElement('div');
    div.innerHTML = markup;
    const node = div.firstChild;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && els.content.contains(sel.getRangeAt(0).startContainer)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      els.content.appendChild(node);
    }
    savedRange = null;
    hydrateInlineMedia(els.content);
    scheduleSave();
    recomputeTotals();
    updateStats();
  }

  async function hydrateInlineMedia(root) {
    const boxes = (root || els.content).querySelectorAll('[data-blob]');
    for (const box of boxes) {
      const id = box.dataset.blob;
      if (!id) continue;
      idbGet(id).then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        if (box.dataset.kind === 'image' && box.firstElementChild && box.firstElementChild.tagName === 'IMG') {
          box.firstElementChild.src = url;
        } else if (box.dataset.kind === 'audio' && box.firstElementChild && box.firstElementChild.tagName === 'AUDIO') {
          box.firstElementChild.src = url;
        }
      }).catch(() => {});
    }
  }

  function sanitizeContent(html) {
    return String(html || '').replace(/\ssrc="blob:[^"]*"/g, ' src=""');
  }

  async function openViewer(id) {
    const n = getNote(activeId);
    const att = n && n.attachments && n.attachments.find((a) => a.id === id);
    const blob = await idbGet(id);
    if (!blob) { showToast('File not found'); return; }
    const url = URL.createObjectURL(blob);
    const kind = mediaKind(att);
    const body = els.viewerBody;
    body.innerHTML = '';
    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = url;
      body.appendChild(img);
    } else if (kind === 'audio') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.autoplay = true;
      audio.src = url;
      body.appendChild(audio);
    } else if (kind === 'pdf') {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.title = att && att.name || 'PDF';
      body.appendChild(iframe);
    } else {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = url;
      body.appendChild(audio);
    }
    els.viewer.classList.remove('hidden');
    document.body.classList.add('viewer-open');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function closeViewer() {
    els.viewer.classList.add('hidden');
    els.viewerBody.innerHTML = '';
    document.body.classList.remove('viewer-open');
  }

  /* ---------- Voice recording ---------- */

  function pickMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    if (!window.MediaRecorder) return null;
    for (const c of candidates) {
      try { if (MediaRecorder.isTypeSupported(c)) return c; } catch (e) {}
    }
    return '';
  }

  async function startRecording() {
    const n = getNote(activeId);
    if (!n) { showToast('Open a note first'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      showToast('Recording not supported on this browser');
      return;
    }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      showToast('Microphone access denied');
      return;
    }
    const mime = pickMimeType();
    try {
      mediaRecorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    } catch (e) {
      try { mediaRecorder = new MediaRecorder(recStream); }
      catch (e2) { recStream.getTracks().forEach((t) => t.stop()); showToast('Recording failed'); return; }
    }
    recChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = finishRecording;
    mediaRecorder.start();
    recStartTs = Date.now();
    els.recBar.classList.remove('hidden');
    els.recTime.textContent = '0:00';
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStartTs) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      els.recTime.textContent = mm + ':' + ss;
    }, 500);
    showToast('Recording…');
  }

  function stopRecording(save) {
    if (!mediaRecorder) return;
    mediaRecorder.onstop = save ? finishRecording : null;
    try { mediaRecorder.stop(); } catch (e) {}
    mediaRecorder = null;
  }

  async function finishRecording() {
    if (recStream) { recStream.getTracks().forEach((t) => t.stop()); recStream = null; }
    clearInterval(recTimer);
    els.recBar.classList.add('hidden');
    const blob = new Blob(recChunks, { type: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm' });
    const n = getNote(activeId);
    if (!blob.size || !n) { showToast('No audio captured'); return; }
    const id = uid();
    await idbPut(id, blob);
    const ext = /mp4|m4a|aac/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
    const name = 'Voice note ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.' + ext;
    n.attachments = n.attachments || [];
    n.attachments.push({ id, name, type: blob.type || 'audio/webm', size: blob.size });
    saveNotes();
    renderAttachments(n);
    renderList();
    insertInlineMediaAtCursor(inlineMediaMarkup({ name, type: blob.type }, id));
    showToast('Voice note added ✓');
  }

  /* ---------- Offline OCR ---------- */

  const OCR_PATHS = {
    workerPath: 'vendor/ocr/worker.min.js',
    corePath: 'vendor/ocr/',
    langPath: 'vendor/ocr/lang/',
    gzip: true
  };
  let tesseractPromise = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (tesseractPromise) return tesseractPromise;
    tesseractPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/ocr/tesseract.min.js';
      s.onload = () => resolve();
      s.onerror = () => { tesseractPromise = null; reject(new Error('Failed to load OCR engine')); };
      document.head.appendChild(s);
    });
    return tesseractPromise;
  }

  function ocrSetStatus(text, pct) {
    els.ocrBarFill.style.width = (pct == null ? 0 : pct) + '%';
    els.ocrStatus.textContent = text || '';
  }

  async function runOCR(attId) {
    const n = getNote(activeId);
    if (!n) return;
    const imgs = (n.attachments || []).filter((a) => a.type && a.type.startsWith('image/'));
    const att = imgs.find((a) => a.id === attId) || imgs[0];
    if (!att) {
      showToast('Attach an image first');
      return;
    }
    const blob = await idbGet(att.id);
    if (!blob) {
      showToast('Image not found');
      return;
    }
    const lang = els.ocrLang.value || 'eng';
    els.ocrProgress.classList.remove('hidden');
    ocrSetStatus('Loading OCR…', 5);
    try {
      const imageURL = URL.createObjectURL(blob);
      const canvas = await blobToCanvas(blob, imageURL);
      await loadTesseract();
      ocrSetStatus('Preparing engine…', 10);
      const worker = await Tesseract.createWorker(lang, 1, {
        ...OCR_PATHS,
        logger: (m) => {
          if (m.status === 'recognizing text') {
            ocrSetStatus('Recognizing…', 10 + m.progress * 85);
          }
        }
      });
      const { data: { text } } = await worker.recognize(canvas);
      await worker.terminate();
      ocrSetStatus('Inserting…', 100);
      insertOCRText(text);
      showToast('OCR complete ✓');
    } catch (e) {
      showToast('OCR failed');
    } finally {
      setTimeout(() => els.ocrProgress.classList.add('hidden'), 400);
    }
  }

  function blobToCanvas(blob, url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = img.naturalWidth || img.width;
          cv.height = img.naturalHeight || img.height;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve(cv);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image decode failed'));
      };
      img.src = url;
    });
  }

  function insertOCRText(text) {
    const clean = String(text || '').trim();
    if (!clean) {
      showToast('No text detected');
      return;
    }
    const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const html = lines.map((l) => `<p>${esc(l)}</p>`).join('');
    els.content.focus();
    document.execCommand('insertHTML', false, html);
    recomputeTotals();
    updateStats();
    scheduleSave();
  }

  /* ---------- Font picker ---------- */

  const FONT_CLASSES = {
    default: '',
    inter: 'font-inter',
    serif: 'font-serif',
    hind: 'font-hind',
    notosansbn: 'font-notosansbn',
    notoserifbn: 'font-notoserifbn'
  };

  function applyFont(n) {
    const cls = FONT_CLASSES[n.font] || '';
    Object.values(FONT_CLASSES).forEach((c) => { if (c) els.content.classList.remove(c); });
    if (cls) els.content.classList.add(cls);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function textOf(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return d.textContent || '';
  }

  function getNote(id) {
    return notes.find((n) => n.id === id);
  }

  function nextColor() {
    let pool = PALETTE.map((_, i) => i).filter((i) => !lastColors.includes(i));
    if (!pool.length) pool = PALETTE.map((_, i) => i);
    const i = pool[Math.floor(Math.random() * pool.length)];
    lastColors.push(i);
    if (lastColors.length > 2) lastColors.shift();
    return i;
  }

  function newNote() {
    const now = Date.now();
    const n = {
      id: uid(),
      title: '',
      color: nextColor(),
      content: '',
      tags: [],
      attachments: [],
      font: 'default',
      pinned: false,
      createdAt: now,
      updatedAt: now
    };
    notes.unshift(n);
    activeId = n.id;
    filter = 'all';
    activeTag = null;
    refreshNav();
    saveNotes();
    renderAll();
    openNote(n.id);
    const card = els.list.querySelector('.note-card[data-id="' + n.id + '"]');
    if (card) card.classList.add('new-card');
    if (isMobile()) location.hash = '#/note/' + n.id;
    els.title.focus();
  }

  function openNote(id) {
    flushSave();
    const n = getNote(id);
    if (!n) return;
    activeId = id;
    els.title.value = n.title;
    els.content.innerHTML = n.content;
    hydrateInlineMedia(els.content);
    els.pin.classList.toggle('on', n.pinned);
    applyColor(n);
    applyFont(n);
    els.fontSelect.value = n.font || 'default';
    renderTagChips(n);
    renderAttachments(n);
    els.editor.classList.remove('hidden');
    els.empty.classList.add('hidden');
    els.content.scrollTop = 0;
    renderList();
    updateView();
    updateStats();
  }

  function showEmpty() {
    activeId = null;
    els.editor.classList.add('hidden');
    els.empty.classList.remove('hidden');
    els.attachments.classList.add('hidden');
    els.ocrProgress.classList.add('hidden');
    renderList();
    renderTags();
    updateCount();
    updateView();
    updateStats();
  }

  function isMobile() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function updateView() {
    const mobile = isMobile();
    const inNote = !!activeId && !!getNote(activeId);
    document.body.classList.toggle('view-note', mobile && inNote);
    document.body.classList.toggle('view-list', mobile && !inNote);
  }

  function closeNav() {
    document.body.classList.remove('nav-open');
    els.overlay.classList.remove('show');
  }

  function applyColor(n) {
    const c = PALETTE[n.color];
    els.editor.style.setProperty('--note-bg', c.bg);
    els.editor.style.setProperty('--note-acc', c.accent);
    els.colorbar.style.background = c.accent;
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      saveCurrent();
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrent, 250);
  }

  function saveCurrent() {
    const n = getNote(activeId);
    if (!n) return;
    n.title = els.title.value.trim();
    n.content = sanitizeContent(els.content.innerHTML);
    n.updatedAt = Date.now();
    saveNotes();
    renderList();
    renderTags();
    updateStats();
  }

  function visibleNotes() {
    let out = [...notes];
    if (filter === 'pinned') out = out.filter((n) => n.pinned);
    if (activeTag) out = out.filter((n) => n.tags.includes(activeTag));
    const q = els.search.value.trim().toLowerCase();
    if (q) {
      out = out.filter((n) =>
        (n.title + ' ' + textOf(n.content) + ' ' + n.tags.join(' ')).toLowerCase().includes(q)
      );
    }
    const sortBy = els.sort.value;
    out.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
    return out;
  }

  function renderList() {
    const list = visibleNotes();
    els.list.innerHTML = list.length
      ? list.map((n, i) => cardHTML(n, i)).join('')
      : '<div class="list-empty"><div class="list-empty-icon">🗒</div><p>No notes yet</p><small>Tap + to create your first note</small></div>';
    updateCount();
  }

  function cardHTML(n, i) {
    const c = PALETTE[n.color];
    const excerpt = textOf(n.content).trim().slice(0, 120) || 'No content yet';
    const date = new Date(n.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<article class="note-card${n.id === activeId ? ' active' : ''}" data-id="${n.id}" ` +
      `style="--card-bg:${c.bg};--card-acc:${c.accent};--i:${Math.min(i, 10)}">` +
      `<div class="card-head"><span class="card-title">${esc(n.title) || 'Untitled'}</span>` +
      (n.pinned ? '<span class="pin-dot">📌</span>' : '') + `</div>` +
      `<div class="card-excerpt">${esc(excerpt)}</div>` +
      `<div class="card-foot"><span class="card-date">${date}</span>` +
      `<span class="card-tags">${n.tags.slice(0, 3).map((t) => '#' + esc(t)).join(' ')}</span></div>` +
      `</article>`;
  }

  function updateCount() {
    let label = 'All notes';
    if (filter === 'pinned') label = 'Pinned';
    if (activeTag) label = '#' + activeTag;
    if (els.search.value.trim()) label = 'Search results';
    const n = visibleNotes().length;
    els.listTitle.textContent = label + (n ? ` (${n})` : '');
  }

  function updateStats() {
    const text = els.content.innerText.trim();
    const words = text ? text.split(/\s+/).length : 0;
    els.wordCount.textContent = words + ' words · ' + text.length + ' chars';
  }

  function renderTags() {
    const counts = {};
    notes.forEach((n) => n.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    const tags = Object.keys(counts).sort();
    els.tagList.innerHTML = tags.length
      ? tags.map((t) =>
          `<button type="button" class="tag-item${t === activeTag ? ' active' : ''}" data-tag="${esc(t)}">` +
          `<span class="hash">#</span>${esc(t)}<span class="count">${counts[t]}</span></button>`
        ).join('')
      : '<div class="sidebar-foot" style="border:none;text-align:left;padding:2px 4px">No tags yet</div>';
  }

  function refreshNav() {
    els.navItems.forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
  }

  function renderTagChips(n) {
    els.tagChips.innerHTML = n.tags.map((t) =>
      `<span class="tag-chip" data-tag="${esc(t)}">#${esc(t)}` +
      `<button type="button" class="remove" title="Remove tag">×</button></span>`
    ).join('');
  }

  /* ---------- Copy helpers ---------- */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast('Copied ✓'))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Copied ✓');
    } catch (e) {
      showToast('Copy failed');
    }
    ta.remove();
  }

  function showToast(msg) {
    let toast = $('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 1400);
  }

  function copyLine(el) {
    let text;
    if (el.tagName === 'A') text = el.getAttribute('href') || el.textContent;
    else if (el.tagName === 'PRE') text = el.textContent;
    else text = el.textContent.trim();
    copyText(text);
  }

  /* ---------- Selection copy ---------- */

  function positionSelBar(rect) {
    const bar = els.selBar;
    bar.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 220)) + 'px';
    bar.style.bottom = (window.innerHeight - rect.bottom + 10) + 'px';
    bar.style.top = 'auto';
    bar.classList.remove('hidden');
  }

  function hideSelBar() {
    els.selBar.classList.add('hidden');
  }

  function flashSelection() {
    try {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!range.toString().length) return;
      const span = document.createElement('span');
      span.className = 'copy-flash';
      const clone = range.cloneRange();
      clone.surroundContents(span);
      setTimeout(() => {
        if (span.parentNode) {
          const frag = document.createDocumentFragment();
          while (span.firstChild) frag.appendChild(span.firstChild);
          span.parentNode.replaceChild(frag, span);
          scheduleSave();
        }
      }, 900);
    } catch (e) {}
  }

  /* ---------- Line copy ---------- */

  function initLineCopy() {
    lineCopyBtn = document.createElement('button');
    lineCopyBtn.type = 'button';
    lineCopyBtn.className = 'float-copy hidden';
    document.body.appendChild(lineCopyBtn);

    els.content.addEventListener('mouseover', (e) => {
      if (!els.content.contains(e.target)) return;
      const el = e.target.closest(COPIABLE);
      if (el) {
        if (el !== hoverEl) {
          hoverEl = el;
          showLineCopyBtn(el);
        }
      } else if (hoverEl && hoverEl.contains(e.target)) {
        return;
      } else {
        hideLineCopyBtn();
      }
    });

    els.content.addEventListener('mouseout', (e) => {
      if (e.relatedTarget && els.content.contains(e.relatedTarget)) return;
      scheduleHideLineBtn();
    });

    lineCopyBtn.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
    });

    lineCopyBtn.addEventListener('mouseleave', scheduleHideLineBtn);

    lineCopyBtn.addEventListener('click', () => {
      if (hoverEl) {
        copyLine(hoverEl);
        scheduleHideLineBtn();
      }
    });
  }

  function showLineCopyBtn(el) {
    const rect = el.getBoundingClientRect();
    let label = 'Copy';
    if (el.tagName === 'A') label = 'Copy link';
    lineCopyBtn.textContent = label;
    lineCopyBtn.style.bottom = 'auto';
    lineCopyBtn.style.left = Math.min(rect.right + 10, window.innerWidth - 90) + 'px';
    lineCopyBtn.style.top = (rect.top + 2) + 'px';
    lineCopyBtn.classList.remove('hidden');
  }

  function scheduleHideLineBtn() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideLineCopyBtn, 150);
  }

  function hideLineCopyBtn() {
    clearTimeout(hideTimer);
    lineCopyBtn.classList.add('hidden');
    hoverEl = null;
  }

  /* ---------- Selection bar ---------- */

  function initSelBar() {
    const defs = [
      { act: 'copy', label: 'Copy', title: 'Copy text', run: () => copySelection('text') },
      { act: 'md', label: 'MD', title: 'Copy as Markdown', run: () => copySelection('md') },
      { sep: true },
      { act: 'bold', label: 'B', title: 'Bold', run: () => execSel('bold') },
      { act: 'italic', label: 'I', title: 'Italic', run: () => execSel('italic') },
      { act: 'hl', label: 'H', title: 'Highlight', run: highlightSel }
    ];
    defs.forEach((d) => {
      if (d.sep) {
        const s = document.createElement('span');
        s.className = 'sep';
        els.selBar.appendChild(s);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d.label;
      b.title = d.title || d.label;
      b.dataset.act = d.act;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', d.run);
      els.selBar.appendChild(b);
    });
  }

  function getSel() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    if (!(sel.anchorNode && els.content.contains(sel.anchorNode))) return null;
    if (!sel.toString().trim()) return null;
    return sel;
  }

  function copySelection(kind) {
    const sel = getSel();
    if (!sel) return;
    const text = kind === 'md' ? htmlToMd(sel.getRangeAt(0).cloneContents()) : sel.toString();
    copyText(text);
    if (kind === 'text') flashSelection();
    hideSelBar();
  }

  function execSel(cmd, val) {
    const sel = getSel();
    if (!sel) return;
    document.execCommand(cmd, false, val || null);
    scheduleSave();
    hideSelBar();
  }

  function highlightSel() {
    execSel('hiliteColor', '#ffe08a');
  }

  function positionSelBar(rect) {
    const bar = els.selBar;
    bar.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 220)) + 'px';
    bar.style.bottom = (window.innerHeight - rect.bottom + 10) + 'px';
    bar.style.top = 'auto';
    bar.classList.remove('hidden');
  }

  function hideSelBar() {
    els.selBar.classList.add('hidden');
  }

  /* ---------- Totals popover ---------- */

  function initTotalsPop() {
    totalsPop = document.createElement('div');
    totalsPop.className = 'totals-pop hidden';
    document.body.appendChild(totalsPop);
    document.addEventListener('mousedown', (e) => {
      if (totalsPop.classList.contains('hidden')) return;
      if (!totalsPop.contains(e.target)) totalsPop.classList.add('hidden');
    });
  }

  function openTotalsPop(wrap, btnRect) {
    totalsWrap = wrap;
    const headers = [...wrap.querySelectorAll('thead th')].map((th, i) => String(th.textContent).trim() || 'Column ' + (i + 1));
    const funcs = [
      ['sum', 'Sum'],
      ['avg', 'Average'],
      ['min', 'Min'],
      ['max', 'Max'],
      ['count', 'Count']
    ];
    let html = '<div class="tp-label">Column</div><div class="tp-chips" id="tp-cols">';
    html += headers.map((h, i) => `<button type="button" class="tp-chip${i === totalsCol ? ' on' : ''}" data-i="${i}">${esc(h)}</button>`).join('');
    html += '</div><div class="tp-label">Calculate</div><div class="tp-chips" id="tp-funcs">';
    html += funcs.map((f) => `<button type="button" class="tp-chip" data-f="${f[0]}">${f[1]}</button>`).join('');
    html += '</div><button type="button" class="tp-remove" id="tp-remove">Remove total</button>';
    totalsPop.innerHTML = html;

    const chips = [...totalsPop.querySelectorAll('#tp-cols .tp-chip')];
    chips.forEach((c) => {
      c.addEventListener('click', () => {
        totalsCol = +c.dataset.i;
        chips.forEach((x) => x.classList.toggle('on', x === c));
      });
    });
    if (chips.length) chips[0].classList.add('on');

    totalsPop.querySelector('#tp-funcs').addEventListener('click', (e) => {
      const b = e.target.closest('.tp-chip');
      if (!b) return;
      applyTotal(b.dataset.f);
      totalsPop.classList.add('hidden');
    });

    totalsPop.querySelector('#tp-remove').addEventListener('click', () => {
      removeTotal();
      totalsPop.classList.add('hidden');
    });

    const r = btnRect;
    totalsPop.style.top = (r.bottom + 8) + 'px';
    totalsPop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    totalsPop.style.left = 'auto';
    totalsPop.classList.remove('hidden');
  }

  function applyTotal(func) {
    if (!totalsWrap) return;
    const tbody = totalsWrap.querySelector('tbody');
    const old = tbody.querySelector('tr.totals-row');
    if (old) old.remove();
    const colCount = Math.max(1, totalsWrap.querySelectorAll('thead th').length);
    const cells = [];
    for (let i = 0; i < colCount; i++) cells.push('<td></td>');
    cells[totalsCol] = '<td class="total-val"></td>';
    const tr = document.createElement('tr');
    tr.className = 'totals-row';
    tr.dataset.col = totalsCol;
    tr.dataset.func = func;
    tr.innerHTML = cells.join('');
    tbody.appendChild(tr);
    computeWrapTotals(totalsWrap);
    scheduleSave();
  }

  function removeTotal() {
    if (!totalsWrap) return;
    const tr = totalsWrap.querySelector('tr.totals-row');
    if (tr) tr.remove();
    scheduleSave();
  }

  function computeWrapTotals(wrap) {
    const tbody = wrap.querySelector('tbody');
    const tr = tbody && tbody.querySelector('tr.totals-row');
    if (!tr) return;
    const col = +tr.dataset.col;
    const func = tr.dataset.func;
    const rows = [...tbody.querySelectorAll('tr:not(.totals-row)')];
    const nums = rows
      .map((r) => {
        const c = r.children[col];
        return c ? parseFloat(String(c.textContent).replace(/[^0-9.\-]/g, '')) : NaN;
      })
      .filter((n) => !isNaN(n));
    let val;
    if (func === 'sum') val = nums.reduce((a, b) => a + b, 0);
    else if (func === 'avg') val = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    else if (func === 'min') val = nums.length ? Math.min(...nums) : 0;
    else if (func === 'max') val = nums.length ? Math.max(...nums) : 0;
    else val = nums.length;
    const label = { sum: 'Σ Sum', avg: 'Avg', min: 'Min', max: 'Max', count: 'Count' }[func] || func;
    const labelCol = col === 0 ? 1 : 0;
    if (tr.children[labelCol]) tr.children[labelCol].textContent = label;
    const vCell = tr.children[col];
    if (vCell) vCell.textContent = fmtVal(val);
  }

  function fmtVal(n) {
    return Number.isInteger(n) ? String(n) : (+n.toFixed(2)).toString();
  }

  function recomputeTotals() {
    $$('.table-wrap', els.content).forEach(computeWrapTotals);
  }

  /* ---------- Markdown conversion ---------- */

  function htmlToMd(node) {
    let md = '';
    const walk = (n) => {
      if (n.nodeType === 3) {
        md += n.textContent;
        return;
      }
      const tag = n.nodeName.toLowerCase();
      if (tag === 'br') {
        md += '\n';
        return;
      }
      const inner = () => [...n.childNodes].forEach(walk);
      const txt = () => [...n.childNodes].map((c) => c.textContent || '').join('');
      switch (tag) {
        case 'p':
        case 'div':
          inner();
          md += '\n\n';
          break;
        case 'h1':
        case 'h2':
        case 'h3':
          md += '\n' + '#'.repeat(+tag[1]) + ' ' + txt() + '\n\n';
          break;
        case 'b':
        case 'strong':
          md += '**' + txt() + '**';
          break;
        case 'i':
        case 'em':
          md += '*' + txt() + '*';
          break;
        case 'u':
          inner();
          break;
        case 'a':
          md += '[' + txt() + '](' + (n.getAttribute('href') || '') + ')';
          break;
        case 'li':
          md += '- ' + txt() + '\n';
          break;
        case 'ul':
        case 'ol':
          inner();
          md += '\n';
          break;
        case 'pre':
          md += '\n```\n' + txt() + '\n```\n';
          break;
        case 'blockquote':
          md += '\n> ' + txt() + ' \n';
          break;
        case 'table':
          md += tableToMd(n);
          break;
        default:
          inner();
      }
    };
    walk(node);
    return md;
  }

  function tableToMd(table) {
    const rows = [...table.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('th, td')].map((c) => String(c.textContent).trim().replace(/\|/g, '\\|'))
    );
    if (!rows.length) return '';
    const header = rows[0];
    let md = '\n| ' + header.join(' | ') + ' |\n| ' + header.map(() => '---').join(' | ') + ' |\n';
    rows.slice(1).forEach((r) => {
      md += '| ' + r.join(' | ') + ' |\n';
    });
    return md + '\n';
  }

  /* ---------- Export ---------- */

  function exportNoteAsMd() {
    const n = getNote(activeId);
    if (!n) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = n.content;
    const md = '# ' + (n.title || 'Untitled') + '\n\n' + htmlToMd(wrap);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (n.title || 'note') + '.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Exported ✓');
  }

  /* ---------- Colour picker ---------- */

  function initColorPop() {
    colorPop = document.createElement('div');
    colorPop.className = 'color-pop hidden';
    PALETTE.forEach((c, i) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'swatch';
      sw.style.background = c.bg;
      sw.title = c.name;
      sw.addEventListener('click', () => {
        const n = getNote(activeId);
        if (!n) return;
        n.color = i;
        applyColor(n);
        colorPop.classList.add('hidden');
        saveNotes();
        renderList();
      });
      colorPop.appendChild(sw);
    });
    document.body.appendChild(colorPop);

    els.color.addEventListener('click', () => {
      const rect = els.color.getBoundingClientRect();
      colorPop.style.top = (rect.bottom + 8) + 'px';
      colorPop.style.right = (window.innerWidth - rect.right) + 'px';
      colorPop.classList.toggle('hidden');
    });

    document.addEventListener('mousedown', (e) => {
      if (colorPop.classList.contains('hidden')) return;
      if (!colorPop.contains(e.target) && !els.color.contains(e.target)) {
        colorPop.classList.add('hidden');
      }
    });
  }

  /* ---------- Tables ---------- */

  function tableControls() {
    return `<div class="table-controls">` +
      `<button type="button" data-table-op="add-col" title="Add column">+ Col</button>` +
      `<button type="button" data-table-op="add-row" title="Add row">+ Row</button>` +
      `<button type="button" data-table-op="copy-cell" title="Copy the selected cell">Copy cell</button>` +
      `<button type="button" data-table-op="totals" title="Calculate totals">Σ Total</button>` +
      `<button type="button" data-table-op="del-col" title="Remove last column">− Col</button>` +
      `<button type="button" data-table-op="del-row" title="Remove last row">− Row</button>` +
      `<button type="button" data-table-op="remove" title="Delete table">✕</button>` +
      `</div>`;
  }

  function tableShell(headHtml, bodyHtml) {
    return `<div class="table-wrap" contenteditable="false">` +
      `<table contenteditable="true"><thead><tr>${headHtml}</tr></thead>` +
      `<tbody>${bodyHtml}</tbody></table>` +
      tableControls() + `</div><p><br></p>`;
  }

  function insertTable() {
    const cols = 3;
    const head = '<th><br></th>'.repeat(cols);
    let body = '';
    for (let r = 1; r < 3; r++) body += `<tr>${'<td><br></td>'.repeat(cols)}</tr>`;
    els.content.focus();
    document.execCommand('insertHTML', false, tableShell(head, body));
    scheduleSave();
  }

  function tableMarkupFrom(rows) {
    const rowsC = rows.slice(0, MAX_TABLE_ROWS);
    const head = rowsC[0].slice(0, MAX_COLS).map((c) => `<th>${esc(c)}</th>`).join('');
    let body = '';
    for (let r = 1; r < rowsC.length; r++) {
      body += `<tr>${rowsC[r].slice(0, MAX_COLS).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
    }
    return tableShell(head, body);
  }

  function tableFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    const rows = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = [...tr.querySelectorAll('th, td')].map((c) => c.textContent.trim());
      if (cells.length) rows.push(cells);
    });
    return rows.length ? rows : null;
  }

  function tableFromText(text) {
    if (!text.includes('\t')) return null;
    const rows = text.split(/\r?\n/)
      .map((l) => l.split('\t').map((c) => c.trim()))
      .filter((r) => r.some((c) => c !== ''));
    return rows.length >= 2 ? rows : null;
  }

  function tableOp(op, btn) {
    const wrap = btn.closest('.table-wrap');
    if (!wrap) return;
    const table = wrap.querySelector('table');
    const thead = table.querySelector('thead tr');
    const tbody = table.querySelector('tbody');
    const colCount = table.querySelectorAll('thead th').length || 1;

    if (op === 'add-col') {
      if (colCount >= MAX_COLS) return;
      thead.insertAdjacentHTML('beforeend', '<th><br></th>');
      $$('tr', tbody).forEach((tr) => tr.insertAdjacentHTML('beforeend', '<td><br></td>'));
    } else if (op === 'del-col') {
      if (colCount <= 1) return;
      const th = thead.querySelector('th:last-child');
      if (th) th.remove();
      $$('tr', tbody).forEach((tr) => {
        const td = tr.querySelector('td:last-child');
        if (td) td.remove();
      });
    } else if (op === 'add-row') {
      tbody.insertAdjacentHTML('beforeend', `<tr>${'<td><br></td>'.repeat(colCount)}</tr>`);
    } else if (op === 'del-row') {
      const trs = $$('tr', tbody);
      if (trs.length <= 1) return;
      trs[trs.length - 1].remove();
    } else if (op === 'copy-cell') {
      const cell = wrap.querySelector('td:focus, th:focus') || lastCellEl || wrap.querySelector('tbody td, thead th');
      if (cell) copyText(cell.textContent.trim());
      return;
    } else if (op === 'totals') {
      openTotalsPop(wrap, btn.getBoundingClientRect());
      return;
    } else if (op === 'remove') {
      wrap.remove();
    }
    scheduleSave();
  }

  /* ---------- Events ---------- */

  function bindEvents() {
    els.newBtn.addEventListener('click', newNote);

    els.list.addEventListener('click', (e) => {
      const card = e.target.closest('.note-card');
      if (card) {
        if (isMobile()) location.hash = '#/note/' + card.dataset.id;
        else openNote(card.dataset.id);
      }
    });

    els.search.addEventListener('input', () => {
      activeTag = null;
      refreshNav();
      renderTags();
      renderList();
    });

    els.sort.addEventListener('change', renderList);

    els.navItems.forEach((b) => {
      b.addEventListener('click', () => {
        filter = b.dataset.filter;
        activeTag = null;
        refreshNav();
        renderTags();
        renderList();
        if (isMobile()) closeNav();
      });
    });

    els.tagList.addEventListener('click', (e) => {
      const item = e.target.closest('.tag-item');
      if (!item) return;
      activeTag = activeTag === item.dataset.tag ? null : item.dataset.tag;
      filter = 'all';
      refreshNav();
      renderTags();
      renderList();
      if (isMobile()) closeNav();
    });

    els.title.addEventListener('input', scheduleSave);
    els.title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') els.content.focus();
    });

    els.content.addEventListener('input', () => {
      recomputeTotals();
      updateStats();
      scheduleSave();
    });

    els.toolbar.addEventListener('mousedown', (e) => {
      if (e.target.closest('select')) return;
      e.preventDefault();
    });
    els.toolbar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'insert-table-btn') {
        insertTable();
        return;
      }
      if (b.id === 'attach-btn' || b.id === 'ocr-btn' || b.id === 'rec-btn') return;
      document.execCommand(b.dataset.cmd, false, b.dataset.value || null);
      els.content.focus();
    });

    els.pin.addEventListener('click', () => {
      const n = getNote(activeId);
      if (!n) return;
      n.pinned = !n.pinned;
      els.pin.classList.toggle('on', n.pinned);
      saveNotes();
      renderList();
    });

    els.del.addEventListener('click', () => {
      const n = getNote(activeId);
      if (!n) return;
      if (!window.confirm('Delete this note?')) return;
      deleteNoteAttachments(n);
      notes = notes.filter((x) => x.id !== activeId);
      activeId = null;
      saveNotes();
      renderAll();
      if (isMobile()) {
        location.hash = '#/';
      } else if (notes.length) {
        openNote(notes[0].id);
      } else {
        showEmpty();
      }
    });

    els.back.addEventListener('click', () => {
      location.hash = '#/';
    });

    els.menu.addEventListener('click', () => {
      document.body.classList.add('nav-open');
      els.overlay.classList.add('show');
    });

    els.searchToggle.addEventListener('click', () => {
      document.body.classList.add('nav-open');
      els.overlay.classList.add('show');
      setTimeout(() => els.search.focus(), 220);
    });

    els.overlay.addEventListener('click', closeNav);

    els.fab.addEventListener('click', () => {
      closeNav();
      newNote();
    });

    els.focusBtn.addEventListener('click', () => {
      document.body.classList.toggle('focus-mode');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
        document.body.classList.remove('focus-mode');
      }
    });

    els.exportBtn.addEventListener('click', exportNoteAsMd);

    els.attachBtn.addEventListener('mousedown', saveSelection);
    els.attachBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      const files = [...els.fileInput.files];
      els.fileInput.value = '';
      attachFiles(files);
    });

    els.recBtn.addEventListener('mousedown', saveSelection);
    els.recBtn.addEventListener('click', startRecording);
    els.recStop.addEventListener('click', () => stopRecording(true));
    els.recCancel.addEventListener('click', () => stopRecording(false));

    els.viewerClose.addEventListener('click', closeViewer);
    els.viewer.addEventListener('click', (e) => {
      if (e.target === els.viewer) closeViewer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.viewer.classList.contains('hidden')) closeViewer();
    });

    els.content.addEventListener('click', (e) => {
      const box = e.target.closest('[data-blob]');
      if (box) openViewer(box.dataset.blob);
    });

    els.ocrBtn.addEventListener('click', () => runOCR(null));

    els.fontSelect.addEventListener('change', () => {
      const n = getNote(activeId);
      if (!n) return;
      n.font = els.fontSelect.value;
      applyFont(n);
      saveNotes();
      renderList();
    });

    els.attachmentList.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      const chip = e.target.closest('.attach-chip');
      if (!chip) return;
      const id = chip.dataset.id;
      if (!id) return;
      if (btn) {
        if (btn.dataset.act === 'dl') downloadAttachment(id);
        else if (btn.dataset.act === 'rm') removeAttachment(id);
        else if (btn.dataset.act === 'ocr') runOCR(id);
        return;
      }
      if (!e.target.closest('.attach-acts')) openViewer(id);
    });

    els.emptyNewBtn.addEventListener('click', newNote);

    els.tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const n = getNote(activeId);
        if (!n) return;
        const tag = els.tagInput.value.trim().replace(/^#/, '').toLowerCase();
        if (tag && !n.tags.includes(tag)) {
          n.tags.push(tag);
          saveNotes();
          renderTagChips(n);
          renderTags();
          renderList();
        }
        els.tagInput.value = '';
      } else if (e.key === 'Escape') {
        els.tagInput.value = '';
      }
    });

    els.tagChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.tag-chip');
      if (!chip) return;
      if (e.target.classList.contains('remove')) {
        const n = getNote(activeId);
        if (!n) return;
        n.tags = n.tags.filter((t) => t !== chip.dataset.tag);
        saveNotes();
        renderTagChips(n);
        renderTags();
        renderList();
      } else {
        activeTag = activeTag === chip.dataset.tag ? null : chip.dataset.tag;
        filter = 'all';
        refreshNav();
        renderTags();
        renderList();
      }
    });

    els.content.addEventListener('click', (e) => {
      const op = e.target.closest('[data-table-op]');
      if (op) {
        e.preventDefault();
        tableOp(op.dataset.tableOp, op);
        return;
      }
      const cell = e.target.closest('td, th');
      if (cell && cell.closest('.table-wrap')) lastCellEl = cell;
    });

    els.content.addEventListener('focusin', (e) => {
      const cell = e.target.closest && e.target.closest('td, th');
      if (cell && cell.closest('.table-wrap')) lastCellEl = cell;
    });

    els.content.addEventListener('paste', (e) => {
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      let rows = html ? tableFromHtml(html) : null;
      if (!rows && text) rows = tableFromText(text);
      if (rows) {
        e.preventDefault();
        document.execCommand('insertHTML', false, tableMarkupFrom(rows));
        scheduleSave();
      }
    });

    document.addEventListener('mouseup', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        hideSelBar();
        return;
      }
      if (!(sel.anchorNode && els.content.contains(sel.anchorNode))) {
        hideSelBar();
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        hideSelBar();
        return;
      }
      positionSelBar(rect);
    });

    document.addEventListener('mousedown', (e) => {
      if (!els.selBar.contains(e.target)) hideSelBar();
    });

    els.selBar.addEventListener('mousedown', (e) => e.preventDefault());
  }

  function renderAll() {
    renderList();
    renderTags();
    refreshNav();
  }

  function init() {
    bindEvents();
    initLineCopy();
    initColorPop();
    initSelBar();
    initTotalsPop();
    renderAll();
    document.body.classList.add('boot');
    setTimeout(() => document.body.classList.remove('boot'), 700);
    const m = location.hash.match(/^#\/note\/(.+)$/);
    if (m && getNote(m[1])) openNote(m[1]);
    else if (!isMobile() && notes.length) openNote(notes[0].id);
    updateView();
    updateStats();
    window.addEventListener('resize', updateView);
    window.addEventListener('hashchange', () => {
      const hm = location.hash.match(/^#\/note\/(.+)$/);
      if (hm && getNote(hm[1]) && hm[1] !== activeId) {
        openNote(hm[1]);
      } else if (!hm || !getNote(hm[1])) {
        flushSave();
        activeId = null;
        showEmpty();
      }
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
    }
  }

  init();
})();
