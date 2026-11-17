let tables = {};

// Zoom değişkenleri
let currentZoom = 1;
const minZoom = 0.05;
const maxZoom = 4;
const zoomStep = 0.1;

// Dark mode değişkenleri
let isDarkMode = false;
let focusedTable = null; // odak vurgusu: tıklanan tablo

// Dark mode functions
function initDarkMode() {
    // localStorage'dan dark mode tercihi al
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        enableDarkMode();
    }

    // Dark mode toggle button
    const toggleBtn = document.getElementById('dark-mode-toggle');
    toggleBtn.addEventListener('click', toggleDarkMode);
}

function toggleDarkMode() {
    if (isDarkMode) {
        disableDarkMode();
    } else {
        enableDarkMode();
    }
}

function enableDarkMode() {
    isDarkMode = true;
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');

    // Toggle button icon change
    const toggleBtn = document.getElementById('dark-mode-toggle');
    const icon = toggleBtn.querySelector('i');
    icon.className = 'fa-solid fa-sun';
    toggleBtn.title = 'Light Mode';
}

function disableDarkMode() {
    isDarkMode = false;
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');

    // Toggle button icon change
    const toggleBtn = document.getElementById('dark-mode-toggle');
    const icon = toggleBtn.querySelector('i');
    icon.className = 'fa-solid fa-moon';
    toggleBtn.title = 'Dark Mode';
}

// Parantez derinliği 0'daki virgüllerden böler (decimal(10,2), PRIMARY KEY (a,b) bozulmaz)
function splitDefinitions(body) {
    const parts = [];
    let depth = 0, current = '';
    for (const ch of body) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

// Tek tanımlayıcı: `ad`, "ad", [ad] ya da çıplak ad; "sema.ad" biçiminde nitelenmiş olabilir
const IDENT_SRC = '(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|[\\w$]+)';
const QIDENT_SRC = `${IDENT_SRC}(?:\\s*\\.\\s*${IDENT_SRC})*`;
const IDENT_RE = new RegExp(IDENT_SRC, 'g');

function unquoteIdent(str) {
    return str.replace(/^[`"\[]|[`"\]]$/g, '');
}

// "public"."tablo" -> tablo (şema öneki atılır)
function lastIdent(qualified) {
    const parts = qualified.match(IDENT_RE);
    return unquoteIdent(parts ? parts[parts.length - 1] : qualified.trim());
}

function parseIdentList(str) {
    return str.split(',').map(x => lastIdent(x.trim())).filter(Boolean);
}

// CREATE TABLE sorgularını ayrıştırır.
// Tablo: { tableName, columns: [{name, type, pk}], foreignKeys: [{name, column, referencesTable, referencesColumn}] }
// Bileşik FK, aynı `name` ile sütun çifti başına bir kayıt olarak tutulur.
// Sütun listesi verilmeyen REFERENCES (tablo) hedef tablonun PK'sına, yoksa aynı ada bağlanır.
function parseCreateTable(sql) {
    const createTableRegex = new RegExp(`CREATE\\s+(?:(?:GLOBAL\\s+|LOCAL\\s+)?(?:TEMPORARY|TEMP)\\s+|UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QIDENT_SRC})\\s*\\(`, 'gi');
    const pkRegex = /^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i;
    const fkRegex = new RegExp(`^(?:CONSTRAINT\\s+(${IDENT_SRC})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s*REFERENCES\\s+(${QIDENT_SRC})\\s*(?:\\(([^)]*)\\))?`, 'i');
    const refRegex = new RegExp(`\\s*\\bREFERENCES\\s+(${QIDENT_SRC})\\s*(?:\\(([^)]*)\\))?`, 'i');
    const colRegex = new RegExp(`^(${IDENT_SRC})\\s+([\\s\\S]+)$`);
    const skipRegex = /^(?:UNIQUE|KEY|INDEX|FULLTEXT|SPATIAL|CHECK|CONSTRAINT|EXCLUDE|LIKE)\b/i;

    const results = [];
    let match;

    while ((match = createTableRegex.exec(sql)) !== null) {
        // Gövde: açılış parantezinden eşleşen kapanışa kadar (iç içe parantezlere duyarlı)
        const start = match.index + match[0].length;
        let depth = 1, end = start;
        while (end < sql.length && depth > 0) {
            if (sql[end] === '(') depth++;
            else if (sql[end] === ')') depth--;
            end++;
        }
        const body = sql.slice(start, end - 1);
        createTableRegex.lastIndex = end;

        const table = { tableName: lastIdent(match[1]), columns: [], foreignKeys: [] };
        const tablePk = [];

        splitDefinitions(body).forEach(line => {
            let m;
            if ((m = line.match(pkRegex))) {
                tablePk.push(...parseIdentList(m[1]));
            } else if ((m = line.match(fkRegex))) {
                const cols = parseIdentList(m[2]);
                const refCols = m[4] ? parseIdentList(m[4]) : [];
                cols.forEach((col, i) => {
                    table.foreignKeys.push({
                        name: m[1] ? unquoteIdent(m[1]) : null,
                        column: col,
                        referencesTable: lastIdent(m[3]),
                        referencesColumn: refCols[i] || refCols[0] || null
                    });
                });
            } else if (!skipRegex.test(line)) {
                const colMatch = line.match(colRegex);
                if (!colMatch) return;
                const colName = unquoteIdent(colMatch[1]);
                let type = colMatch[2].replace(/\s+/g, ' ').trim();
                let pk = false;

                // Sütun içi PRIMARY KEY / REFERENCES
                if (/\bPRIMARY\s+KEY\b/i.test(type)) {
                    pk = true;
                    type = type.replace(/\s*\bPRIMARY\s+KEY\b/i, '');
                }
                const refMatch = type.match(refRegex);
                if (refMatch) {
                    table.foreignKeys.push({
                        name: null,
                        column: colName,
                        referencesTable: lastIdent(refMatch[1]),
                        referencesColumn: refMatch[2] ? parseIdentList(refMatch[2])[0] : null
                    });
                    type = type.replace(refMatch[0], '');
                }
                table.columns.push({ name: colName, type: type.trim(), pk });
            }
        });

        tablePk.forEach(name => {
            const col = table.columns.find(c => c.name === name);
            if (col) col.pk = true;
        });

        results.push(table);
    }

    // ALTER TABLE ... ADD [CONSTRAINT ad] FOREIGN KEY (...) REFERENCES ... (dump dosyalarında yaygın)
    const alterRegex = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?(${QIDENT_SRC})\\s+([\\s\\S]*?);`, 'gi');
    const addFkRegex = new RegExp(`ADD\\s+(?:CONSTRAINT\\s+(${IDENT_SRC})\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s*REFERENCES\\s+(${QIDENT_SRC})\\s*(?:\\(([^)]*)\\))?`, 'gi');
    let am;
    while ((am = alterRegex.exec(sql)) !== null) {
        const table = results.find(t => t.tableName === lastIdent(am[1]));
        if (!table) continue;
        let fm;
        addFkRegex.lastIndex = 0;
        while ((fm = addFkRegex.exec(am[2])) !== null) {
            const cols = parseIdentList(fm[2]);
            const refCols = fm[4] ? parseIdentList(fm[4]) : [];
            cols.forEach((col, i) => {
                table.foreignKeys.push({
                    name: fm[1] ? unquoteIdent(fm[1]) : null,
                    column: col,
                    referencesTable: lastIdent(fm[3]),
                    referencesColumn: refCols[i] || refCols[0] || null
                });
            });
        }
    }

    // Hedef sütun verilmemişse hedef tablonun PK'sını (yoksa aynı adlı sütunu) kullan
    results.forEach(t => t.foreignKeys.forEach(fk => {
        if (fk.referencesColumn) return;
        const ref = results.find(r => r.tableName === fk.referencesTable);
        const refPk = ref && ref.columns.filter(c => c.pk);
        fk.referencesColumn = (refPk && refPk.length ? refPk[0].name : fk.column);
    }));

    return results;
}

let spaceDown = false; // Space basılıyken boş alan sürüklemesi pan olur

function makeDraggable(element) {
    element.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || spaceDown) return; // sağ tık: bağlam menüsü; orta/Space: pan (alanın işleyicisi)

        const name = element.id.replace('table-', '');

        // Shift/Ctrl/Cmd+tık: tabloyu seçime ekle/çıkar (sürükleme yok)
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            e.preventDefault();
            toggleTableSelection(name);
            return;
        }

        // Seçili tablolardan biri sürükleniyorsa hepsi birlikte taşınır; değilse seçim temizlenir
        const selected = getSelectedTableNames();
        let dragNames;
        if (selected.includes(name)) {
            dragNames = selected;
        } else {
            if (selected.length) clearTableSelection();
            dragNames = [name];
        }
        const items = dragNames.map(n => ({
            el: tables[n],
            left: parseFloat(tables[n].style.left) || 0,
            top: parseFloat(tables[n].style.top) || 0
        }));
        const startX = e.clientX, startY = e.clientY;
        let moved = false;
        let raf = 0;

        // Sürükleme sırasında transition'ları devre dışı bırak
        items.forEach(it => { it.el.style.transition = 'none'; });

        document.onmousemove = function (ev) {
            if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
            if (!moved) return;

            // Zoom oranını da dikkate al
            const effectiveZoom = currentZoom || 1;
            const dx = (ev.clientX - startX) / effectiveZoom;
            const dy = (ev.clientY - startY) / effectiveZoom;

            const output = document.getElementById('output');
            const buffer = 300;
            items.forEach(it => {
                const newLeft = Math.max(0, it.left + dx);
                const newTop = Math.max(0, it.top + dy);
                it.el.style.left = newLeft + 'px';
                it.el.style.top = newTop + 'px';

                if (newLeft + it.el.offsetWidth + buffer > output.offsetWidth) {
                    output.style.minWidth = (output.offsetWidth + 1000) + 'px';
                }
                if (newTop + it.el.offsetHeight + buffer > output.offsetHeight) {
                    output.style.minHeight = (output.offsetHeight + 1000) + 'px';
                }
            });

            // Çizgiler canlı güncellenir (kare başına en çok bir kez)
            if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawConnections(); });
        };

        document.onmouseup = function () {
            document.onmousemove = null;
            document.onmouseup = null;
            if (raf) { cancelAnimationFrame(raf); raf = 0; }

            // Transition'ları tekrar etkinleştir
            items.forEach(it => { it.el.style.transition = ''; });

            // Sürükleme olmadan tıklama: odak vurgusu (aynı tabloya tekrar tıklayınca kalkar)
            if (!moved) {
                if (focusedTable === name) clearHighlight(); else focusTable(name);
            } else {
                drawConnections();
            }
        };
    });

    // Right-click context menu
    element.addEventListener('contextmenu', (e) => {
        const tableName = element.id.replace('table-', '');
        const colEl = e.target.closest('.column');
        showContextMenu(e, tableName, colEl ? colEl.dataset.column : null);
    });
}




// İlişkisiz tabloları tespit eden fonksiyon
function hasAnyRelationship(table, allTables) {
    // Bu tablonun başka tablolara foreign key'i var mı?
    const hasOutgoingFK = table.foreignKeys && table.foreignKeys.length > 0;

    // Bu tabloya başka tablolardan foreign key var mı?
    const hasIncomingFK = allTables.some(otherTable =>
        otherTable.tableName !== table.tableName &&
        otherTable.foreignKeys &&
        otherTable.foreignKeys.some(fk => fk.referencesTable === table.tableName)
    );

    return hasOutgoingFK || hasIncomingFK;
}

// ---- Yerleşim: ilişkiye göre kümeleme, çakışmasız ----

const LAYOUT_GAP = 60;        // tablolar arası en az boşluk
const LAYOUT_COMP_GAP = 140;  // kümeler arası boşluk

function rectsOverlap(a, b, gap) {
    return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap &&
        a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

// FK'lara göre bağlı bileşenleri bulur (union-find). Yalnızca verilen tablolar arasındaki bağlar sayılır.
function findComponents(list) {
    const parent = {};
    list.forEach(t => { parent[t.tableName] = t.tableName; });
    const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const edges = [];
    list.forEach(t => t.foreignKeys.forEach(fk => {
        if (fk.referencesTable !== t.tableName && parent[fk.referencesTable] !== undefined) {
            parent[find(t.tableName)] = find(fk.referencesTable);
            edges.push([t.tableName, fk.referencesTable]);
        }
    }));
    const comps = {};
    list.forEach(t => { (comps[find(t.tableName)] = comps[find(t.tableName)] || []).push(t.tableName); });
    return { comps: Object.values(comps), edges };
}

// Verilen dikdörtgenleri (x,y,w,h) çakışmayacak şekilde iter; son çare ızgaraya dizer.
function separateRects(rects, gap) {
    for (let iter = 0; iter < 800; iter++) {
        let moved = false;
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                if (!rectsOverlap(a, b, gap)) continue;
                moved = true;
                const dx = (a.x + a.w / 2) - (b.x + b.w / 2);
                const dy = (a.y + a.h / 2) - (b.y + b.h / 2);
                const penX = (a.w + b.w) / 2 + gap - Math.abs(dx);
                const penY = (a.h + b.h) / 2 + gap - Math.abs(dy);
                if (penX < penY) {
                    const s = (dx >= 0 ? 1 : -1) * (penX / 2 + 0.5);
                    a.x += s; b.x -= s;
                } else {
                    const s = (dy >= 0 ? 1 : -1) * (penY / 2 + 0.5);
                    a.y += s; b.y -= s;
                }
            }
        }
        if (!moved) return;
    }
    // Garanti: hâlâ çakışma varsa soldan sağa raflara diz
    const sorted = [...rects].sort((p, q) => p.y - q.y || p.x - q.x);
    const rowW = Math.max(...rects.map(r => r.w)) * Math.ceil(Math.sqrt(rects.length)) + gap * 4;
    let x = 0, y = 0, rowH = 0;
    sorted.forEach(r => {
        if (x > 0 && x + r.w > rowW) { x = 0; y += rowH + gap; rowH = 0; }
        r.x = x; r.y = y;
        x += r.w + gap; rowH = Math.max(rowH, r.h);
    });
}

// Tek bir bağlı bileşeni kuvvet-yönlü yerleştirir; sonuç (0,0) köşeli sınır kutusuna kaydırılır.
function layoutComponent(names, edges, size) {
    const idx = Object.fromEntries(names.map((n, i) => [n, i]));
    const myEdges = edges.filter(e => idx[e[0]] !== undefined && idx[e[1]] !== undefined);
    const degree = {};
    names.forEach(n => { degree[n] = 0; });
    myEdges.forEach(e => { degree[e[0]]++; degree[e[1]]++; });
    // Deterministik başlangıç: dereceye göre sıralı, çember üzerinde
    const order = [...names].sort((a, b) => degree[b] - degree[a] || (a < b ? -1 : 1));
    const R = 260 + 120 * names.length;
    const rects = names.map(n => ({ name: n, w: size[n].w, h: size[n].h, x: 0, y: 0 }));
    order.forEach((n, i) => {
        const ang = (2 * Math.PI * i) / order.length;
        const r = rects[idx[n]];
        const rad = i === 0 && order.length > 3 ? 0 : R;
        r.x = Math.cos(ang) * rad - r.w / 2;
        r.y = Math.sin(ang) * rad - r.h / 2;
    });

    const center = r => [r.x + r.w / 2, r.y + r.h / 2];
    for (let step = 0; step < 300; step++) {
        const cool = 1 - step / 300;
        const force = rects.map(() => [0, 0]);
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const [ax, ay] = center(rects[i]), [bx, by] = center(rects[j]);
                let dx = ax - bx, dy = ay - by;
                const d = Math.max(Math.hypot(dx, dy), 1);
                const rep = 6e5 / (d * d);
                dx /= d; dy /= d;
                force[i][0] += dx * rep; force[i][1] += dy * rep;
                force[j][0] -= dx * rep; force[j][1] -= dy * rep;
            }
        }
        myEdges.forEach(([u, v]) => {
            const i = idx[u], j = idx[v];
            const [ax, ay] = center(rects[i]), [bx, by] = center(rects[j]);
            let dx = bx - ax, dy = by - ay;
            const d = Math.max(Math.hypot(dx, dy), 1);
            const rest = (Math.hypot(rects[i].w, rects[i].h) + Math.hypot(rects[j].w, rects[j].h)) / 2 * 0.55 + LAYOUT_GAP;
            const f = 0.05 * (d - rest);
            dx /= d; dy /= d;
            force[i][0] += dx * f; force[i][1] += dy * f;
            force[j][0] -= dx * f; force[j][1] -= dy * f;
        });
        rects.forEach((r, i) => {
            const lim = 60 * cool + 2;
            r.x += Math.max(-lim, Math.min(lim, force[i][0]));
            r.y += Math.max(-lim, Math.min(lim, force[i][1]));
        });
    }

    separateRects(rects, LAYOUT_GAP);
    return rects;
}

// Yeni tablolar için konum hesaplar: bağlı kümeler bir arada, ilişkisizler en sonda ızgarada.
// Dönüş: { tabloAdı: {x, y} } ve gerçek kutu boyutlarına göre çakışma yoktur.
function calculateTablePositions(newTables, originX, originY) {
    const size = {};
    newTables.forEach(t => {
        const el = tables[t.tableName];
        // CSS zoom küçüldükçe yazı yüksekliği ~%28'e kadar büyüyebilir; ölçüye pay bırak
        size[t.tableName] = { w: el.offsetWidth || 420, h: Math.ceil((el.offsetHeight || 200) * 1.15) };
    });

    const { comps, edges } = findComponents(newTables);
    const related = comps.filter(c => c.length > 1).sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
    const loners = comps.filter(c => c.length === 1).map(c => c[0]).sort();

    const blocks = related.map(names => {
        const rects = layoutComponent(names, edges, size);
        const minX = Math.min(...rects.map(r => r.x)), minY = Math.min(...rects.map(r => r.y));
        rects.forEach(r => { r.x -= minX; r.y -= minY; });
        return {
            rects,
            w: Math.max(...rects.map(r => r.x + r.w)),
            h: Math.max(...rects.map(r => r.y + r.h))
        };
    });

    // İlişkisiz tablolar: tek bir ızgara bloğu
    if (loners.length) {
        const cols = Math.ceil(Math.sqrt(loners.length));
        const cellW = Math.max(...loners.map(n => size[n].w)) + LAYOUT_GAP;
        const rects = [];
        const rowHeights = [];
        loners.forEach((n, i) => {
            const row = Math.floor(i / cols);
            rowHeights[row] = Math.max(rowHeights[row] || 0, size[n].h);
        });
        loners.forEach((n, i) => {
            const row = Math.floor(i / cols), col = i % cols;
            let y = 0;
            for (let r = 0; r < row; r++) y += rowHeights[r] + LAYOUT_GAP;
            rects.push({ name: n, w: size[n].w, h: size[n].h, x: col * cellW, y });
        });
        blocks.push({
            rects,
            w: Math.max(...rects.map(r => r.x + r.w)),
            h: Math.max(...rects.map(r => r.y + r.h))
        });
    }

    // Blokları raflara diz (en büyük blok önce; ilişkisizler son blok olarak kalır)
    const total = blocks.reduce((s, b) => s + (b.w + LAYOUT_COMP_GAP) * (b.h + LAYOUT_COMP_GAP), 0);
    const shelfW = Math.max(Math.sqrt(total) * 1.5, ...blocks.map(b => b.w));
    const positions = {};
    let x = 0, y = 0, rowH = 0;
    blocks.forEach(b => {
        if (x > 0 && x + b.w > shelfW) { x = 0; y += rowH + LAYOUT_COMP_GAP; rowH = 0; }
        b.rects.forEach(r => { positions[r.name] = { x: originX + x + r.x, y: originY + y + r.y }; });
        x += b.w + LAYOUT_COMP_GAP;
        rowH = Math.max(rowH, b.h);
    });
    return positions;
}

// Sütun satırını (PK/FK rozetleriyle) oluşturur
function buildColumnElement(table, col) {
    const colDiv = document.createElement('div');
    colDiv.className = 'column';
    colDiv.id = `${table.tableName}-${col.name}`;
    colDiv.dataset.column = col.name;

    const fk = table.foreignKeys.find(f => f.column === col.name);
    if (col.pk) {
        const badge = document.createElement('span');
        badge.className = 'col-badge col-badge-pk';
        badge.textContent = 'PK';
        colDiv.appendChild(badge);
    }
    if (fk) {
        const badge = document.createElement('span');
        badge.className = 'col-badge col-badge-fk';
        badge.textContent = 'FK';
        badge.title = `→ ${fk.referencesTable}.${fk.referencesColumn}`;
        colDiv.appendChild(badge);
    }

    colDiv.appendChild(document.createTextNode(`${col.name} (${col.type})`));
    return colDiv;
}

// Bir tablonun sütunlarını modelden yeniden çizer (PK/FK değişince)
function refreshTableColumns(table) {
    const div = tables[table.tableName];
    if (!div) return;
    div.querySelectorAll('.column').forEach(el => el.remove());
    table.columns.forEach(col => div.appendChild(buildColumnElement(table, col)));
}

function visualize() {
    const sql = document.getElementById('sqlInput').value;
    const parsedTables = parseCreateTable(sql);
    const output = document.getElementById('output');
    const svg = document.getElementById('connections');

    if (!window.parsedTables) {
        window.parsedTables = [];
    }

    // Yeni tabloları filtreleme
    const newTables = parsedTables.filter(table => !tables[table.tableName]);

    if (newTables.length === 0) {
        console.log('Yeni tablo bulunamadı');
        return;
    }

    // Mevcut tüm tablolarla birlikte pozisyonları hesapla
    const allTables = [...window.parsedTables, ...newTables];

    // Önce yeni tabloları oluştur
    newTables.forEach((table) => {
        const div = document.createElement('div');
        div.className = 'table-box';

        // İlişkisiz tablo mu kontrol et
        if (!hasAnyRelationship(table, allTables)) {
            div.classList.add('unrelated');
        }

        div.style.left = `0px`; // Geçici pozisyon
        div.style.top = `0px`; // Geçici pozisyon
        div.id = 'table-' + table.tableName;

        const title = document.createElement('div');
        title.className = 'table-name';
        title.innerText = table.tableName;
        div.appendChild(title);

        table.columns.forEach(col => div.appendChild(buildColumnElement(table, col)));

        document.getElementById('canvas').appendChild(div);
        tables[table.tableName] = div;
        window.parsedTables.push(table);
        makeDraggable(div);
    });

    // Yazı tipleri yüklenip kutu ölçüleri oturduktan sonra yalnızca YENİ tabloları yerleştir (mevcutlar yerinde kalır)
    const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => setTimeout(() => {
        // Başlangıç noktası: mevcut tabloların sağında, yoksa sol üstte
        let originX = 200, originY = 100;
        const existing = allTables.filter(t => !newTables.includes(t) && tables[t.tableName]);
        if (existing.length) {
            originX = Math.max(...existing.map(t => tables[t.tableName].offsetLeft + tables[t.tableName].offsetWidth)) + LAYOUT_COMP_GAP;
            originY = Math.min(...existing.map(t => tables[t.tableName].offsetTop));
        }

        const positions = calculateTablePositions(newTables, originX, originY);
        newTables.forEach(table => {
            const el = tables[table.tableName];
            const pos = positions[table.tableName];
            if (el && pos) {
                el.style.left = `${Math.round(pos.x)}px`;
                el.style.top = `${Math.round(pos.y)}px`;
            }
        });
        // Güvence: yerleştirmeden sonra gerçek ölçüleri yeniden al, çakışma varsa ayır
        const real = newTables.map(t => {
            const el = tables[t.tableName];
            return { name: t.tableName, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
        });
        if (real.some((a, i) => real.some((b, j) => j > i && rectsOverlap(a, b, LAYOUT_GAP - 1)))) {
            separateRects(real, LAYOUT_GAP);
            real.forEach(r => {
                tables[r.name].style.left = `${Math.round(r.x)}px`;
                tables[r.name].style.top = `${Math.round(r.y)}px`;
            });
        }
        const maxX = Math.max(...newTables.map(t => tables[t.tableName].offsetLeft + tables[t.tableName].offsetWidth));
        const maxY = Math.max(...newTables.map(t => tables[t.tableName].offsetTop + tables[t.tableName].offsetHeight));
        ensureCanvasSize(maxX + 400, maxY + 400);
        updateUnrelatedState();

        drawConnections();

        // Tablolar yerleştirildikten sonra otomatik zoom yap
        setTimeout(() => {
            autoFitZoom();
            // Zoom değişince ölçüler oynayabilir: son bir çakışma denetimi
            const fin = newTables.map(t => {
                const el = tables[t.tableName];
                return { name: t.tableName, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
            });
            if (fin.some((a, i) => fin.some((b, j) => j > i && rectsOverlap(a, b, LAYOUT_GAP - 1)))) {
                separateRects(fin, LAYOUT_GAP);
                fin.forEach(r => {
                    tables[r.name].style.left = `${Math.round(r.x)}px`;
                    tables[r.name].style.top = `${Math.round(r.y)}px`;
                });
                drawConnections();
            }
        }, 100); // Pozisyonların tamamen yerleşmesi için biraz daha bekle
    }, 10)); // DOM render'ının tamamlanması için kısa bir gecikme
}

// Tüm tabloları gösterecek şekilde otomatik zoom ayarı
function autoFitZoom() {
    const outputWrapper = document.getElementById('output-wrapper');
    const tableElements = document.querySelectorAll('.table-box');

    if (tableElements.length === 0) return;

    // Tüm tabloların sınırlarını hesapla
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    tableElements.forEach(table => {
        const rect = table.getBoundingClientRect();
        const outputRect = document.getElementById('output').getBoundingClientRect();

        // Output container'a göre relatif pozisyonları hesapla
        const x = parseFloat(table.style.left) || 0;
        const y = parseFloat(table.style.top) || 0;
        const width = table.offsetWidth;
        const height = table.offsetHeight;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
    });

    // İçerik boyutları
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    // Viewport boyutları
    const viewportWidth = outputWrapper.clientWidth;
    const viewportHeight = outputWrapper.clientHeight;

    // Padding ekle (içerik etrafında boşluk için)
    const padding = 100;

    // Zoom oranlarını hesapla
    const zoomX = (viewportWidth - padding * 2) / contentWidth;
    const zoomY = (viewportHeight - padding * 2) / contentHeight;

    // En küçük zoom oranını seç (tüm içerik görünür olması için)
    let targetZoom = Math.min(zoomX, zoomY);

    // Zoom limitlerini uygula
    targetZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));

    // 10'un katlarına yuvarla
    targetZoom = Math.max(minZoom, Math.floor(targetZoom * 100) / 100);

    // Zoom'u uygula
    currentZoom = targetZoom;
    applyZoom();

    // Yüzen kontrollerin (sol panel, sağ zoom düğmeleri) altında kalmasın
    const insetL = Math.min(170, viewportWidth * 0.1), insetR = Math.min(130, viewportWidth * 0.08), insetV = 30;
    const availW = viewportWidth - insetL - insetR;
    const availH = viewportHeight - insetV * 2;

    // CSS zoom küçük ölçeklerde öğe yüksekliğini/yazı boyutunu değiştirdiği için hesap tutmayabilir:
    // gerçek ekran ölçüsüne bakıp tüm tablolar sığana kadar küçült
    const measure = () => {
        let l = Infinity, t = Infinity, r = -Infinity, bt = -Infinity;
        tableElements.forEach(el => {
            const rc = el.getBoundingClientRect();
            l = Math.min(l, rc.left); t = Math.min(t, rc.top);
            r = Math.max(r, rc.right); bt = Math.max(bt, rc.bottom);
        });
        return { l, t, r, b: bt, w: r - l, h: bt - t };
    };
    outputWrapper.scrollLeft = 0;
    outputWrapper.scrollTop = 0;
    let m = measure();
    for (let i = 0; i < 12 && currentZoom > minZoom && (m.w > availW || m.h > availH); i++) {
        const k = Math.min(availW / m.w, availH / m.h);
        currentZoom = Math.max(minZoom, Math.floor(currentZoom * k * 100) / 100);
        applyZoom();
        outputWrapper.scrollLeft = 0;
        outputWrapper.scrollTop = 0;
        m = measure();
    }

    // İçeriği boş alanın ortasına al: tabloları (zoom'suz birimle) kaydır, kaydırma 0'da kalsın
    const wr = outputWrapper.getBoundingClientRect();
    const wantL = wr.left + insetL + (availW - m.w) / 2;
    const wantT = wr.top + insetV + (availH - m.h) / 2;
    let dx = (wantL - m.l) / currentZoom;
    let dy = (wantT - m.t) / currentZoom;
    let curMinX = Infinity, curMinY = Infinity;
    tableElements.forEach(el => {
        curMinX = Math.min(curMinX, parseFloat(el.style.left) || 0);
        curMinY = Math.min(curMinY, parseFloat(el.style.top) || 0);
    });
    dx = Math.max(dx, -curMinX);
    dy = Math.max(dy, -curMinY);
    tableElements.forEach(el => {
        el.style.left = ((parseFloat(el.style.left) || 0) + dx) + 'px';
        el.style.top = ((parseFloat(el.style.top) || 0) + dy) + 'px';
    });
    drawConnections();
}

// Zoom değerini 10'un katlarına yuvarla
function roundToNearestTen(zoom) {
    // Yüzde değerine çevir (örn: 0.75 -> 75)
    const percentage = zoom * 100;

    // 10'un katlarına yuvarla
    const rounded = Math.round(percentage / 10) * 10;

    // Zoom limitleri
    const clamped = Math.max(minZoom * 100, Math.min(maxZoom * 100, rounded));

    // Tekrar decimal'e çevir
    return clamped / 100;
}

const FOCUS_COLOR = '#f59f00';

function drawConnections() {
    const svg = document.getElementById('connections');
    // <defs> (ok ucu) korunur; yalnız çizgiler yenilenir
    Array.from(svg.children).forEach(c => { if (c.tagName.toLowerCase() !== 'defs') c.remove(); });

    // Odak modu: yalnız odaktaki tabloya bağlı ipler öne çıkar
    const isHighlightMode = !!focusedTable;

    window.parsedTables.forEach(table => {
        table.foreignKeys.forEach(fk => {
            const fromElement = document.getElementById(`${table.tableName}-${fk.column}`);
            const toElement = document.getElementById(`${fk.referencesTable}-${fk.referencesColumn}`);

            if (fromElement && toElement) {
                const fromRect = fromElement.getBoundingClientRect();
                const toRect = toElement.getBoundingClientRect();
                const svgRect = svg.getBoundingClientRect();

                // Bu bağlantı highlight edilmiş tablolar arasında mı?
                const isHighlightedConnection = !isHighlightMode ||
                    table.tableName === focusedTable || fk.referencesTable === focusedTable;
                const focusLine = isHighlightMode && isHighlightedConnection;

                // Self-reference kontrolü (aynı tablodaki sütunlar arası ilişki)
                if (table.tableName === fk.referencesTable) {
                    // Self-reference: yay tablo kutusunun DIŞINDA (sağ kenar), zoom'dan bağımsız sabit ekran
                    // boyutunda çizilir; sütun satırları zoom'la ~0'a küçülse de yay görünür kalır.
                    const boxRect = (tables[table.tableName] || fromElement).getBoundingClientRect();
                    const startX = boxRect.right - svgRect.left;
                    const endX = startX;
                    const startY = fromRect.top + fromRect.height / 2 - svgRect.top;
                    const endY = toRect.top + toRect.height / 2 - svgRect.top;

                    // Curved path for self-reference
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const bulge = 46;      // yayın dışarı taşma miktarı (ekran px)
                    const minLoop = 44;    // yayın en az görünür yüksekliği (ekran px)
                    const dyArc = endY - startY;
                    const dirArc = dyArc >= 0 ? 1 : -1;
                    const spread = Math.max(0, (minLoop - Math.abs(dyArc)) / 2);
                    const cx = startX + bulge * 1.33;
                    const d = `M${startX},${startY} C${cx},${startY - dirArc * spread} ${cx},${endY + dirArc * spread} ${endX},${endY}`;

                    // Highlight durumunda beyaz stroke ekle
                    if (isHighlightedConnection) {
                        // Beyaz arka plan çizgisi
                        const backgroundPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        backgroundPath.setAttribute('d', d);
                        backgroundPath.setAttribute('stroke', 'white');
                        backgroundPath.setAttribute('stroke-width', '6');
                        backgroundPath.setAttribute('fill', 'none');
                        backgroundPath.setAttribute('class', 'connection-background highlighted-connection');
                        svg.appendChild(backgroundPath);
                    }

                    path.setAttribute('d', d);
                    path.setAttribute('stroke', focusLine ? FOCUS_COLOR : '#e74c3c');
                    path.setAttribute('stroke-width', focusLine ? '3.5' : '2');
                    path.setAttribute('fill', 'none');
                    path.setAttribute('marker-end', 'url(#arrow)');

                    if (isHighlightedConnection) {
                        path.setAttribute('class', 'connection-highlighted highlighted-connection');
                    } else {
                        path.setAttribute('class', 'connection-normal');
                        if (isHighlightMode) {
                            path.setAttribute('opacity', '0.12');
                        }
                    }
                    svg.appendChild(path);

                    // Yayın çıkış noktasına küçük nokta: hangi sütundan çıktığı görünsün
                    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    dot.setAttribute('cx', startX);
                    dot.setAttribute('cy', startY);
                    dot.setAttribute('r', '3.5');
                    dot.setAttribute('fill', focusLine ? FOCUS_COLOR : '#e74c3c');
                    if (isHighlightMode && !isHighlightedConnection) dot.setAttribute('opacity', '0.12');
                    svg.appendChild(dot);
                } else {
                    // Normal foreign key bağlantısı - düz çizgi
                    const fromCenterY = fromRect.top + fromRect.height / 2 - svgRect.top;
                    const toCenterY = toRect.top + toRect.height / 2 - svgRect.top;

                    // Hangi kenardan çıkacağını belirle (pozisyona göre)
                    const fromLeft = fromRect.left - svgRect.left;
                    const fromRight = fromRect.right - svgRect.left;
                    const toLeft = toRect.left - svgRect.left;
                    const toRight = toRect.right - svgRect.left;

                    let startX, endX;

                    // Eğer hedef tablo sağdaysa, sağ kenardan çık
                    if (fromLeft < toLeft) {
                        startX = fromRight;
                        endX = toLeft;
                    } else {
                        // Eğer hedef tablo soldaysa, sol kenardan çık
                        startX = fromLeft;
                        endX = toRight;
                    }

                    // Highlight durumunda beyaz stroke ekle
                    if (isHighlightedConnection) {
                        // Beyaz arka plan çizgisi
                        const backgroundLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                        backgroundLine.setAttribute('x1', startX);
                        backgroundLine.setAttribute('y1', fromCenterY);
                        backgroundLine.setAttribute('x2', endX);
                        backgroundLine.setAttribute('y2', toCenterY);
                        backgroundLine.setAttribute('stroke', 'white');
                        backgroundLine.setAttribute('stroke-width', '6');
                        backgroundLine.setAttribute('class', 'connection-background highlighted-connection');
                        svg.appendChild(backgroundLine);
                    }

                    // Düz çizgi çiz
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', startX);
                    line.setAttribute('y1', fromCenterY);
                    line.setAttribute('x2', endX);
                    line.setAttribute('y2', toCenterY);
                    line.setAttribute('stroke', focusLine ? FOCUS_COLOR : '#3498db');
                    line.setAttribute('stroke-width', focusLine ? '3.5' : '2');
                    line.setAttribute('marker-end', 'url(#arrow)');

                    if (isHighlightedConnection) {
                        line.setAttribute('class', 'connection-highlighted highlighted-connection');
                    } else {
                        line.setAttribute('class', 'connection-normal');
                        if (isHighlightMode) {
                            line.setAttribute('opacity', '0.12');
                        }
                    }
                    svg.appendChild(line);
                }
            }
        });
    });
}



// Boş alan: sürükleyince dikdörtgen (marquee) seçim; orta tuş ya da Space+sürükle ile pan
(function initCanvasPointer() {
    const wrapper = document.getElementById('output-wrapper');
    const isFormTarget = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable]');

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !isFormTarget(e.target) && !document.body.classList.contains('modal-open')) {
            e.preventDefault();
            spaceDown = true;
            wrapper.classList.add('pan-mode');
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') { spaceDown = false; wrapper.classList.remove('pan-mode'); }
    });
    window.addEventListener('blur', () => { spaceDown = false; wrapper.classList.remove('pan-mode'); });

    wrapper.addEventListener('mousedown', function (e) {
        if (e.target.closest('.table-box')) {
            // Space/orta tuş tablonun üstündeyken de pan olsun
            if (!(e.button === 1 || (e.button === 0 && spaceDown))) return;
        }
        const wr = wrapper.getBoundingClientRect();
        // Kaydırma çubuğu tıklamaları dokunulmaz
        if (e.clientX - wr.left > wrapper.clientWidth || e.clientY - wr.top > wrapper.clientHeight) return;

        // Pan
        if (e.button === 1 || (e.button === 0 && spaceDown)) {
            e.preventDefault();
            const sx = e.clientX, sy = e.clientY, sl = wrapper.scrollLeft, st = wrapper.scrollTop;
            wrapper.classList.add('panning');
            document.onmousemove = (ev) => {
                wrapper.scrollLeft = sl - (ev.clientX - sx);
                wrapper.scrollTop = st - (ev.clientY - sy);
            };
            document.onmouseup = () => {
                document.onmousemove = null;
                document.onmouseup = null;
                wrapper.classList.remove('panning');
            };
            return;
        }
        if (e.button !== 0) return;

        // Marquee seçim
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        const base = additive ? getSelectedTableNames() : [];
        const sx = e.clientX, sy = e.clientY;
        let box = null;
        e.preventDefault(); // metin seçimini engelle

        document.onmousemove = (ev) => {
            if (!box) {
                if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) <= 3) return;
                box = document.createElement('div');
                box.className = 'marquee';
                document.body.appendChild(box);
            }
            const x1 = Math.min(sx, ev.clientX), y1 = Math.min(sy, ev.clientY);
            const x2 = Math.max(sx, ev.clientX), y2 = Math.max(sy, ev.clientY);
            box.style.left = x1 + 'px';
            box.style.top = y1 + 'px';
            box.style.width = (x2 - x1) + 'px';
            box.style.height = (y2 - y1) + 'px';
            Object.entries(tables).forEach(([name, el]) => {
                const r = el.getBoundingClientRect();
                const hit = r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1;
                el.classList.toggle('selected', hit || base.includes(name));
            });
        };
        document.onmouseup = () => {
            document.onmousemove = null;
            document.onmouseup = null;
            if (box) {
                box.remove();
            } else if (!additive) {
                // Boş alana tıklama: seçimi ve odağı temizle
                clearTableSelection();
                clearHighlight();
            }
        };
    });

    // Cmd/Ctrl+A: tüm tabloları seç
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a'
            && !isFormTarget(e.target) && !document.body.classList.contains('modal-open')
            && !document.getElementById('export-popup')) {
            e.preventDefault();
            Object.values(tables).forEach(el => el.classList.add('selected'));
        }
    });
})();

document.getElementById('output-wrapper').addEventListener('scroll', function (e) {
    const wrapper = e.target;
    const output = document.getElementById('output');

    const scrollBuffer = 50;

    if (wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight - scrollBuffer) {
        output.style.minHeight = (output.offsetHeight + 100) + 'px';
    }

    if (wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - scrollBuffer) {
        output.style.minWidth = (output.offsetWidth + 100) + 'px';
    }

    drawConnections(); // Bağlantıları yeniden çiz
});

// İlişkili tabloları bulan fonksiyon
function getRelatedTables(targetTableName) {
    const relatedTables = new Set();
    relatedTables.add(targetTableName);

    // Bu tablonun referans ettiği tabloları bul
    const targetTable = window.parsedTables.find(t => t.tableName === targetTableName);
    if (targetTable && targetTable.foreignKeys) {
        targetTable.foreignKeys.forEach(fk => {
            relatedTables.add(fk.referencesTable);
        });
    }

    // Bu tabloyu referans eden tabloları bul
    window.parsedTables.forEach(table => {
        if (table.foreignKeys) {
            table.foreignKeys.forEach(fk => {
                if (fk.referencesTable === targetTableName) {
                    relatedTables.add(table.tableName);
                }
            });
        }
    });

    return Array.from(relatedTables);
}

// Odak vurgusu: tabloya bağlı ipler ve uçlarındaki tablolar öne çıkar, gerisi soluklaşır
function focusTable(tableName) {
    if (!tables[tableName]) return;
    focusedTable = tableName;
    const related = new Set(getRelatedTables(tableName));
    Object.entries(tables).forEach(([name, el]) => {
        el.classList.remove('highlighted', 'dimmed', 'focus-main');
        if (name === tableName) el.classList.add('highlighted', 'focus-main');
        else if (related.has(name)) el.classList.add('highlighted');
        else el.classList.add('dimmed');
    });
    drawConnections();
}

// Eski ad: bağlam menüsü "Öne Çıkar"
function highlightTable(tableName) {
    focusTable(tableName);
}

// ---- Metin çıktıları (SQL DDL / Markdown) ----

function qid(name) {
    return '`' + name + '`';
}

// Aynı CONSTRAINT adını paylaşan (bileşik) FK kayıtlarını tek FK'da toplar
function groupForeignKeys(table) {
    const groups = [];
    table.foreignKeys.forEach(fk => {
        const existing = fk.name && groups.find(g => g.name === fk.name && g.referencesTable === fk.referencesTable);
        if (existing) {
            existing.columns.push(fk.column);
            existing.referencesColumns.push(fk.referencesColumn);
        } else {
            groups.push({
                name: fk.name || null,
                columns: [fk.column],
                referencesTable: fk.referencesTable,
                referencesColumns: [fk.referencesColumn]
            });
        }
    });
    groups.forEach(g => {
        if (!g.name) g.name = `fk_${table.tableName}_${g.columns.join('_')}`;
    });
    return groups;
}

function fkClause(g) {
    return `CONSTRAINT ${qid(g.name)} FOREIGN KEY (${g.columns.map(qid).join(', ')}) ` +
        `REFERENCES ${qid(g.referencesTable)} (${g.referencesColumns.map(qid).join(', ')})`;
}

// Seçili (veya tüm) tablolar için CREATE TABLE çıktısı üretir.
// Bağımlılık sırasına dizer; döngüsel FK'lar sonda ALTER TABLE ile eklenir.
function generateDDL(names) {
    const wanted = new Set(names);
    const list = window.parsedTables.filter(t => wanted.has(t.tableName));
    const groups = {};
    list.forEach(t => { groups[t.tableName] = groupForeignKeys(t); });

    // Topolojik sıralama (yalnızca çıktıdaki tablolar arasında, kendine referans hariç)
    const ordered = [];
    const state = {};
    const deferred = new Set(); // "tablo|fkAdı" -> ALTER ile eklenecek
    const byName = Object.fromEntries(list.map(t => [t.tableName, t]));
    function visit(t, stack) {
        if (state[t.tableName] === 2) return;
        state[t.tableName] = 1;
        stack.push(t.tableName);
        groups[t.tableName].forEach(g => {
            const dep = byName[g.referencesTable];
            if (!dep || dep === t) return;
            if (state[dep.tableName] === 1) {
                deferred.add(t.tableName + '|' + g.name); // döngü: bu FK sonra eklenir
            } else {
                visit(dep, stack);
            }
        });
        stack.pop();
        state[t.tableName] = 2;
        ordered.push(t);
    }
    list.forEach(t => visit(t, []));

    const createStatements = ordered.map(t => {
        const lines = t.columns.map(c => `  ${qid(c.name)} ${c.type}`.trimEnd());
        const pks = t.columns.filter(c => c.pk).map(c => qid(c.name));
        if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`);
        groups[t.tableName].forEach(g => {
            if (!deferred.has(t.tableName + '|' + g.name)) lines.push('  ' + fkClause(g));
        });
        return `CREATE TABLE ${qid(t.tableName)} (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
    });

    const alters = [];
    ordered.forEach(t => {
        groups[t.tableName].forEach(g => {
            if (deferred.has(t.tableName + '|' + g.name)) {
                alters.push(`ALTER TABLE ${qid(t.tableName)} ADD ${fkClause(g)};`);
            }
        });
    });

    return createStatements.concat(alters).join('\n\n') + '\n';
}

// Markdown: her tablo için Sütun | Tür | Anahtar | Referans tablosu
function generateMarkdown(names) {
    const wanted = new Set(names);
    return window.parsedTables.filter(t => wanted.has(t.tableName)).map(t => {
        const rows = t.columns.map(c => {
            const keys = [];
            if (c.pk) keys.push('PK');
            const fks = t.foreignKeys.filter(f => f.column === c.name);
            if (fks.length) keys.push('FK');
            const ref = fks.map(f => `${f.referencesTable}.${f.referencesColumn}`).join(', ');
            const esc = v => String(v).replace(/\|/g, '\\|');
            return `| ${esc(c.name)} | ${esc(c.type)} | ${keys.join(', ')} | ${esc(ref)} |`;
        });
        return `### ${t.tableName}\n\n| Column | Type | Key | References |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;
    }).join('\n');
}

function getSelectedTableNames() {
    return Object.keys(tables).filter(n => tables[n].classList.contains('selected'));
}

function toggleTableSelection(tableName) {
    tables[tableName].classList.toggle('selected');
}

function clearTableSelection() {
    Object.values(tables).forEach(el => el.classList.remove('selected'));
}

// Tek tabloyu dışa aktarır (bağlam menüsü): seçili tablolar varsa ve bu tablo onlardan biriyse hepsini içerir
function exportTableAsSQL(tableName) {
    const selected = getSelectedTableNames();
    showExportPopup(selected.includes(tableName) ? selected : [tableName]);
}

// Dışa aktarma penceresi: kapsam (seçili/tümü), biçim (SQL/Markdown), kopyala, indir
function showExportPopup(initialNames) {
    hideExportPopup();
    if (!window.parsedTables || !window.parsedTables.length) {
        alert('Önce bir şema yükleyin.');
        return;
    }

    const allNames = window.parsedTables.map(t => t.tableName);
    const selected = initialNames || getSelectedTableNames();
    let scope = selected.length ? 'selected' : 'all';
    let format = 'sql';
    let scopeNames = selected;

    const popup = document.createElement('div');
    popup.id = 'export-popup';
    popup.className = 'export-popup';
    popup.innerHTML = `
        <div class="export-popup-content">
            <div class="export-popup-header">
                <h3>📤 Dışa Aktar</h3>
                <button class="export-close-btn" type="button">×</button>
            </div>
            <div class="export-options">
                <label>Kapsam
                    <select id="export-scope">
                        <option value="selected">Seçili tablolar</option>
                        <option value="all">Tüm şema</option>
                    </select>
                </label>
                <label>Biçim
                    <select id="export-format">
                        <option value="sql">SQL (CREATE TABLE)</option>
                        <option value="md">Markdown</option>
                    </select>
                </label>
                <span class="export-count"></span>
            </div>
            <textarea class="export-sql-textarea" readonly></textarea>
            <div class="export-popup-buttons"></div>
        </div>`;

    const scopeSel = popup.querySelector('#export-scope');
    const formatSel = popup.querySelector('#export-format');
    const textarea = popup.querySelector('textarea');
    const count = popup.querySelector('.export-count');
    const buttons = popup.querySelector('.export-popup-buttons');

    if (!selected.length) scopeSel.querySelector('[value="selected"]').disabled = true;
    scopeSel.value = scope;

    const render = () => {
        scope = scopeSel.value;
        format = formatSel.value;
        const names = scope === 'all' ? allNames : scopeNames;
        count.textContent = `${names.length} tablo`;
        textarea.value = format === 'sql' ? generateDDL(names) : generateMarkdown(names);
    };
    scopeSel.onchange = formatSel.onchange = render;
    render();

    const copyBtn = document.createElement('button');
    copyBtn.className = 'export-btn export-btn-primary';
    copyBtn.textContent = '📋 Kopyala';
    copyBtn.onclick = () => {
        const done = () => {
            copyBtn.textContent = '✅ Kopyalandı!';
            setTimeout(() => { copyBtn.textContent = '📋 Kopyala'; }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textarea.value).then(done, () => {
                textarea.select();
                document.execCommand('copy');
                done();
            });
        } else {
            textarea.select();
            document.execCommand('copy');
            done();
        }
    };

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'export-btn export-btn-primary';
    downloadBtn.textContent = '💾 İndir';
    downloadBtn.onclick = () => {
        const isSql = formatSel.value === 'sql';
        const blob = new Blob([textarea.value], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'schema.' + (isSql ? 'sql' : 'md');
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'export-btn export-btn-secondary';
    closeBtn.textContent = 'Kapat';
    closeBtn.onclick = hideExportPopup;

    buttons.append(copyBtn, downloadBtn, closeBtn);
    popup.querySelector('.export-close-btn').onclick = hideExportPopup;
    document.body.appendChild(popup);
}

// Export popup'ını gizleyen fonksiyon
function hideExportPopup() {
    const popup = document.getElementById('export-popup');
    if (popup) {
        popup.remove();
    }
}

// Odak vurgusunu temizler
function clearHighlight() {
    focusedTable = null;
    Object.values(tables).forEach(tableElement => {
        tableElement.classList.remove('highlighted', 'dimmed', 'focus-main');
    });
    drawConnections();
}

// Context menu oluşturan fonksiyon (öğeler showContextMenu'da doldurulur)
function createContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.className = 'context-menu';
    document.body.appendChild(menu);
    return menu;
}

function addMenuItem(menu, label, handler, separated) {
    const item = document.createElement('div');
    item.className = 'context-menu-item' + (separated ? ' context-menu-separated' : '');
    item.textContent = label;
    item.onclick = function () {
        hideContextMenu();
        handler();
    };
    menu.appendChild(item);
}

// Context menu'yu gösteren fonksiyon. columnName verilirse sütuna özel işlemler de eklenir.
function showContextMenu(e, tableName, columnName) {
    e.preventDefault();

    let menu = document.getElementById('context-menu');
    if (!menu) {
        menu = createContextMenu();
    }
    menu.innerHTML = '';
    menu.dataset.tableName = tableName;

    const table = window.parsedTables.find(t => t.tableName === tableName);
    const col = table && columnName ? table.columns.find(c => c.name === columnName) : null;

    if (col) {
        const fk = table.foreignKeys.find(f => f.column === col.name);
        addMenuItem(menu, col.pk ? '🔑 Primary Key\'i kaldır' : '🔑 Primary Key olarak işaretle',
            () => togglePrimaryKey(tableName, col.name));
        addMenuItem(menu, fk ? '🔗 Foreign Key\'i düzenle…' : '🔗 Foreign Key tanımla…',
            () => showForeignKeyDialog(tableName, col.name));
        if (fk) {
            addMenuItem(menu, `✂️ Foreign Key'i kaldır (→ ${fk.referencesTable}.${fk.referencesColumn})`,
                () => setForeignKey(tableName, col.name, null));
        }
    }

    addMenuItem(menu, '🔍 Öne Çıkar', () => highlightTable(tableName), !!col);
    addMenuItem(menu, '📤 Dışa Aktar', () => exportTableAsSQL(tableName));

    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
}

// PK işaretini aç/kapat (birden çok sütun işaretlenirse bileşik PK olur)
function togglePrimaryKey(tableName, columnName) {
    const table = window.parsedTables.find(t => t.tableName === tableName);
    const col = table && table.columns.find(c => c.name === columnName);
    if (!col) return;
    col.pk = !col.pk;
    refreshTableColumns(table);
    drawConnections();
}

// Bir sütunun FK'sini ayarlar; ref null ise kaldırır
function setForeignKey(tableName, columnName, ref) {
    const table = window.parsedTables.find(t => t.tableName === tableName);
    if (!table) return;

    table.foreignKeys = table.foreignKeys.filter(f => f.column !== columnName);
    if (ref) {
        table.foreignKeys.push({
            name: null,
            column: columnName,
            referencesTable: ref.table,
            referencesColumn: ref.column
        });
    }

    refreshTableColumns(table);
    updateUnrelatedState();
    drawConnections();
}

// İlişkisiz (kesik çizgili) tablo görünümünü güncel ilişkilere göre yeniler
function updateUnrelatedState() {
    window.parsedTables.forEach(t => {
        const el = tables[t.tableName];
        if (el) el.classList.toggle('unrelated', !hasAnyRelationship(t, window.parsedTables));
    });
}

// FK hedefi seçme penceresi (hedef tablo + kolon)
function showForeignKeyDialog(tableName, columnName) {
    hideExportPopup();
    const table = window.parsedTables.find(t => t.tableName === tableName);
    const existing = table.foreignKeys.find(f => f.column === columnName);

    const popup = document.createElement('div');
    popup.id = 'export-popup';
    popup.className = 'export-popup';

    const content = document.createElement('div');
    content.className = 'export-popup-content fk-dialog';
    content.innerHTML = `
        <div class="export-popup-header">
            <h3>🔗 Foreign Key - ${tableName}.${columnName}</h3>
            <button class="export-close-btn" type="button">×</button>
        </div>
        <div class="fk-dialog-body">
            <label>Hedef tablo
                <select id="fk-target-table"></select>
            </label>
            <label>Hedef kolon
                <select id="fk-target-column"></select>
            </label>
        </div>
        <div class="export-popup-buttons"></div>
    `;

    const tableSelect = content.querySelector('#fk-target-table');
    const columnSelect = content.querySelector('#fk-target-column');

    window.parsedTables.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.tableName;
        opt.textContent = t.tableName;
        tableSelect.appendChild(opt);
    });

    const fillColumns = (selectedColumn) => {
        const target = window.parsedTables.find(t => t.tableName === tableSelect.value);
        columnSelect.innerHTML = '';
        // PK sütunları önce
        [...target.columns].sort((a, b) => (b.pk ? 1 : 0) - (a.pk ? 1 : 0)).forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name + (c.pk ? ' (PK)' : '');
            columnSelect.appendChild(opt);
        });
        if (selectedColumn) columnSelect.value = selectedColumn;
    };

    tableSelect.addEventListener('change', () => fillColumns());
    if (existing) tableSelect.value = existing.referencesTable;
    fillColumns(existing && existing.referencesColumn);

    const buttons = content.querySelector('.export-popup-buttons');
    const saveBtn = document.createElement('button');
    saveBtn.className = 'export-btn export-btn-primary';
    saveBtn.textContent = 'Kaydet';
    saveBtn.onclick = () => {
        setForeignKey(tableName, columnName, { table: tableSelect.value, column: columnSelect.value });
        hideExportPopup();
    };
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'export-btn export-btn-secondary';
    cancelBtn.textContent = 'İptal';
    cancelBtn.onclick = hideExportPopup;
    buttons.appendChild(saveBtn);
    buttons.appendChild(cancelBtn);
    content.querySelector('.export-close-btn').onclick = hideExportPopup;

    popup.appendChild(content);
    document.body.appendChild(popup);
}

// Context menu'yu gizleyen fonksiyon
function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) {
        menu.style.display = 'none';
    }
}

// Global click listener - context menu'yu gizlemek ve highlight temizlemek için
document.addEventListener('click', function (e) {
    if (!e.target.closest('.context-menu') && !e.target.closest('.table-box')) {
        hideContextMenu();
        clearHighlight();
    } else if (!e.target.closest('.context-menu')) {
        hideContextMenu();
    }
});

// ESC tuşu ile highlight'ı temizle
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        clearTableSelection();
        clearHighlight();
        hideContextMenu();
    }
});

// Zoom Controls
function initZoomControls() {
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const zoomResetBtn = document.getElementById('zoom-reset');
    const outputWrapper = document.getElementById('output-wrapper');
    const output = document.getElementById('output');

    // Zoom In
    zoomInBtn.addEventListener('click', () => {
        if (currentZoom < maxZoom) {
            const newZoom = currentZoom + zoomStep;
            currentZoom = roundToNearestTen(Math.min(newZoom, maxZoom));
            applyZoom();
        }
    });

    // Zoom Out
    zoomOutBtn.addEventListener('click', () => {
        if (currentZoom > minZoom) {
            const newZoom = currentZoom - zoomStep;
            currentZoom = roundToNearestTen(Math.max(newZoom, minZoom));
            applyZoom();
        }
    });

    // Zoom Reset - Auto Fit All Tables
    zoomResetBtn.addEventListener('click', () => {
        autoFitZoom();
    });

    // Ctrl (Windows/Linux) / Cmd (Mac) + tekerlek ve trackpad pinch (ctrlKey'li wheel):
    // imlecin altındaki noktaya doğru zoom. Tarayıcının sayfa zoom'u engellenir.
    document.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();

        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16; // satır modu (Firefox)
        else if (e.deltaMode === 2) dy *= 100;

        // Trackpad pinch küçük deltalar üretir, fare tekerleği ~100
        const sensitivity = Math.abs(dy) < 50 ? 0.01 : 0.002;
        const factor = Math.exp(-Math.max(-150, Math.min(150, dy)) * sensitivity);
        zoomAt(currentZoom * factor, e.clientX, e.clientY);
    }, { passive: false });

    // Touch zoom for mobile
    let initialDistance = 0;
    let initialZoom = 1;
    let isZooming = false;

    outputWrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isZooming = true;
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            initialDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );
            initialZoom = currentZoom;
            e.preventDefault();
        }
    });

    outputWrapper.addEventListener('touchmove', (e) => {
        if (isZooming && e.touches.length === 2) {
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            const distance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );

            const scale = distance / initialDistance;
            const newZoom = Math.max(minZoom, Math.min(maxZoom, initialZoom * scale));

            if (newZoom !== currentZoom) {
                currentZoom = newZoom;
                applyZoom();
            }

            e.preventDefault();
        }
    });

    outputWrapper.addEventListener('touchend', () => {
        isZooming = false;
    });

    // Zoom Range
    const zoomRange = document.getElementById('zoom-range');
    zoomRange.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        currentZoom = value / 100;
        applyZoom();
    });
}

// Pan alanı (#output) en az verilen (zoom'suz) boyuta kadar büyür, asla küçülmez
function ensureCanvasSize(minW, minH) {
    const output = document.getElementById('output');
    const curW = parseFloat(output.style.minWidth) || 0;
    const curH = parseFloat(output.style.minHeight) || 0;
    const baseW = 8 * window.innerWidth;
    const baseH = 4 * window.innerHeight;
    output.style.minWidth = Math.ceil(Math.max(curW, baseW, minW)) + 'px';
    output.style.minHeight = Math.ceil(Math.max(curH, baseH, minH)) + 'px';
}

// Zoom'u belirtilen ekran noktası sabit kalacak şekilde değiştirir
function zoomAt(targetZoom, clientX, clientY) {
    const outputWrapper = document.getElementById('output-wrapper');
    const newZoom = Math.round(Math.max(minZoom, Math.min(maxZoom, targetZoom)) * 1000) / 1000;
    if (newZoom === currentZoom) return;

    const rect = outputWrapper.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // İmlecin altındaki içerik noktası (zoom'suz koordinat)
    const contentX = (outputWrapper.scrollLeft + mouseX) / currentZoom;
    const contentY = (outputWrapper.scrollTop + mouseY) / currentZoom;

    currentZoom = newZoom;
    applyZoom();

    // Pan alanı, imlecin altındaki noktayı sabit tutmaya yetecek kadar büyük olsun
    ensureCanvasSize(contentX + outputWrapper.clientWidth / newZoom, contentY + outputWrapper.clientHeight / newZoom);

    outputWrapper.scrollLeft = contentX * newZoom - mouseX;
    outputWrapper.scrollTop = contentY * newZoom - mouseY;
    drawConnections();
}

function applyZoom() {
    const output = document.getElementById('output');
    const outputWrapper = document.getElementById('output-wrapper');

    // CSS zoom kullan - bu şekilde SVG çizgiler bozulmaz
    output.style.zoom = currentZoom;

    // Zoom out'ta pan alanı ekranı her zaman kaplasın
    ensureCanvasSize(outputWrapper.clientWidth / currentZoom, outputWrapper.clientHeight / currentZoom);
    if (window.parsedTables) drawConnections(); // çizgiler ekran koordinatıyla çizildiği için zoom sonrası yenile

    // Grid: CSS zoom çizgiyi de küçülttüğü için ekranda hep ~1px çizgi ve en az ~25px
    // aralık kalacak şekilde aralığı 2'nin katlarıyla büyüt, kalınlığı zoom'a göre telafi et
    let gridSize = 100;
    while (gridSize * currentZoom < 25) gridSize *= 2;
    output.style.setProperty('--grid-size', `${gridSize}px`);
    output.style.setProperty('--grid-line', `${Math.max(1, 1 / currentZoom).toFixed(3)}px`);

    // Update zoom level display
    const zoomLevel = document.getElementById('zoom-level');
    if (zoomLevel) {
        zoomLevel.textContent = Math.round(currentZoom * 100) + '%';
    }

    // Update zoom range slider
    const zoomRange = document.getElementById('zoom-range');
    if (zoomRange) {
        zoomRange.value = Math.round(currentZoom * 100);
    }

    // Update zoom button states
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');

    zoomInBtn.style.opacity = currentZoom >= maxZoom ? '0.5' : '1';
    zoomOutBtn.style.opacity = currentZoom <= minZoom ? '0.5' : '1';

    zoomInBtn.style.pointerEvents = currentZoom >= maxZoom ? 'none' : 'auto';
    zoomOutBtn.style.pointerEvents = currentZoom <= minZoom ? 'none' : 'auto';
}// Initialize controls when page loads
document.addEventListener('DOMContentLoaded', () => {
    initZoomControls();
    initDarkMode();
});
