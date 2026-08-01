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
  const COPIABLE = 'p, h1, h2, h3, li, blockquote, pre, td, th, a';
  const MAX_COLS = 12;
  const MAX_TABLE_ROWS = 30;

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  const els = {
    newBtn: $('#new-note-btn'),
    search: $('#search-input'),
    list: $('#notes-list'),
    count: $('#notes-count'),
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
    floatCopy: $('#float-copy')
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
    els.title.focus();
  }

  function openNote(id) {
    flushSave();
    const n = getNote(id);
    if (!n) return;
    activeId = id;
    els.title.value = n.title;
    els.content.innerHTML = n.content;
    els.pin.classList.toggle('on', n.pinned);
    applyColor(n);
    renderTagChips(n);
    els.editor.classList.remove('hidden');
    els.empty.classList.add('hidden');
    els.content.scrollTop = 0;
    renderList();
  }

  function showEmpty() {
    activeId = null;
    els.editor.classList.add('hidden');
    els.empty.classList.remove('hidden');
    renderList();
    renderTags();
    updateCount();
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
    n.content = els.content.innerHTML;
    n.updatedAt = Date.now();
    saveNotes();
    renderList();
    renderTags();
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
      ? list.map(cardHTML).join('')
      : '<div class="list-empty">No notes here yet.</div>';
    updateCount();
  }

  function cardHTML(n) {
    const c = PALETTE[n.color];
    const excerpt = textOf(n.content).trim().slice(0, 120) || 'No content yet';
    const date = new Date(n.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<article class="note-card${n.id === activeId ? ' active' : ''}" data-id="${n.id}" ` +
      `style="--card-bg:${c.bg};--card-acc:${c.accent}">` +
      `<div class="card-head"><span class="card-title">${esc(n.title) || 'Untitled'}</span>` +
      (n.pinned ? '<span class="pin-dot">📌</span>' : '') + `</div>` +
      `<div class="card-excerpt">${esc(excerpt)}</div>` +
      `<div class="card-foot"><span class="card-date">${date}</span>` +
      `<span class="card-tags">${n.tags.slice(0, 3).map((t) => '#' + esc(t)).join(' ')}</span></div>` +
      `</article>`;
  }

  function updateCount() {
    const n = visibleNotes().length;
    els.count.textContent = n === 1 ? '1 note' : n + ' notes';
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

  function positionFloatCopy(rect) {
    const btn = els.floatCopy;
    btn.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 150)) + 'px';
    btn.style.bottom = (window.innerHeight - rect.bottom + 10) + 'px';
    btn.style.top = 'auto';
  }

  function hideFloatCopy() {
    els.floatCopy.classList.add('hidden');
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
      if (el && el !== hoverEl) {
        hoverEl = el;
        showLineCopyBtn(el);
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
    else if (el.tagName === 'TD' || el.tagName === 'TH') label = 'Copy cell';
    lineCopyBtn.textContent = label;
    lineCopyBtn.style.bottom = 'auto';
    lineCopyBtn.style.left = Math.min(rect.right + 10, window.innerWidth - 90) + 'px';
    lineCopyBtn.style.top = (rect.top + 2) + 'px';
    lineCopyBtn.classList.remove('hidden');
  }

  function scheduleHideLineBtn() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      lineCopyBtn.classList.add('hidden');
      hoverEl = null;
    }, 150);
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
      if (card) openNote(card.dataset.id);
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
    });

    els.title.addEventListener('input', scheduleSave);
    els.title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') els.content.focus();
    });

    els.content.addEventListener('input', scheduleSave);

    els.toolbar.addEventListener('mousedown', (e) => e.preventDefault());
    els.toolbar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'insert-table-btn') {
        insertTable();
        return;
      }
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
      notes = notes.filter((x) => x.id !== activeId);
      activeId = null;
      saveNotes();
      renderAll();
      if (notes.length) openNote(notes[0].id);
      else showEmpty();
    });

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
      }
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
        hideFloatCopy();
        return;
      }
      if (!(sel.anchorNode && els.content.contains(sel.anchorNode))) {
        hideFloatCopy();
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        hideFloatCopy();
        return;
      }
      positionFloatCopy(rect);
      els.floatCopy.classList.remove('hidden');
    });

    document.addEventListener('mousedown', (e) => {
      if (!els.floatCopy.contains(e.target)) hideFloatCopy();
    });

    els.floatCopy.addEventListener('mousedown', (e) => e.preventDefault());

    els.floatCopy.addEventListener('click', () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.anchorNode && els.content.contains(sel.anchorNode)) {
        copyText(sel.toString());
        flashSelection();
        hideFloatCopy();
      }
    });
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
    renderAll();
    if (notes.length) openNote(notes[0].id);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
