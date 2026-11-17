let tables = {};

// Zoom değişkenleri
let currentZoom = 1;
const minZoom = 0.05;
const maxZoom = 4;
const zoomStep = 0.1;

// Dark mode değişkenleri
let isDarkMode = false;

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

function parseCreateTable(sql) {
    const createTableRegex = /CREATE TABLE [`"]?(\w+)[`"]? \((.*?)\) ENGINE=/gis;
    const foreignKeyRegex = /CONSTRAINT [`"]?(\w+)[`"]? FOREIGN KEY \([`"]?(\w+)[`"]?\) REFERENCES [`"]?(\w+)[`"]? \([`"]?(\w+)[`"]?\)/gi;

    let match;
    const results = [];

    while ((match = createTableRegex.exec(sql)) !== null) {
        const tableName = match[1];
        const columnsSection = match[2];

        const lines = columnsSection.split(/,(?![^\(]*\))/).map(line => line.trim());
        const columns = [];

        lines.forEach(line => {
            if (line.startsWith('PRIMARY KEY') || line.startsWith('UNIQUE KEY') || line.startsWith('KEY')) return;

            const colMatch = line.match(/[`"]?(\w+)[`"]?\s+([^\r,]+)/);
            if (colMatch) {
                columns.push({ name: colMatch[1], type: colMatch[2] });
            }
        });

        results.push({ tableName, columns, foreignKeys: [] });
    }

    let fkMatch;
    while ((fkMatch = foreignKeyRegex.exec(sql)) !== null) {
        const sourceTable = results.find(t => t.columns.some(c => c.name === fkMatch[2]));
        if (sourceTable) {
            sourceTable.foreignKeys.push({
                column: fkMatch[2],
                referencesTable: fkMatch[3],
                referencesColumn: fkMatch[4]
            });
        }
    }

    return results;
}
function makeDraggable(element) {
    let startX, startY, startLeft, startTop;
    let dragTimeout;
    let isDragging = false;

    element.addEventListener('mousedown', (e) => {
        // Right click kontrolü
        if (e.button === 2) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        // Doğrudan elementin kendi offsetLeft ve offsetTop'unu al (scale uygulanmamış)
        startLeft = parseFloat(element.style.left) || 0;
        startTop = parseFloat(element.style.top) || 0;

        // Highlight modunda SVG'yi gizle (performans için)
        const highlightedElements = document.querySelectorAll('.table-box.highlighted');
        const isHighlightMode = highlightedElements.length > 0;
        const svg = document.getElementById('connections');

        if (isHighlightMode) {
            svg.style.display = 'none';
        }

        // Sürükleme sırasında transition'ları devre dışı bırak
        element.style.transition = 'none';

        document.onmousemove = function (e) {
            // Zoom oranını da dikkate al
            const effectiveZoom = currentZoom || 1;
            const dx = (e.clientX - startX) / effectiveZoom;
            const dy = (e.clientY - startY) / effectiveZoom;

            let newLeft = startLeft + dx;
            let newTop = startTop + dy;

            element.style.left = newLeft + 'px';
            element.style.top = newTop + 'px';

            const buffer = 300;
            const output = document.getElementById('output');

            if (newLeft + element.offsetWidth + buffer > output.offsetWidth) {
                output.style.minWidth = (output.offsetWidth + 1000) + 'px';
            }

            if (newTop + element.offsetHeight + buffer > output.offsetHeight) {
                output.style.minHeight = (output.offsetHeight + 1000) + 'px';
            }

            // Highlight modunda ipleri güncelleme
            if (!isHighlightMode) {
                // Normal modda her hareket için güncelle
                drawConnections();
            }
        };

        document.onmouseup = function () {
            document.onmousemove = null;
            document.onmouseup = null;
            isDragging = false;

            // SVG'yi tekrar göster ve bağlantıları çiz
            if (isHighlightMode) {
                svg.style.display = 'block';
            }

            // Transition'ları tekrar etkinleştir
            element.style.transition = '';

            // Son güncellemeyi garantile
            if (dragTimeout) {
                clearTimeout(dragTimeout);
            }
            drawConnections();
        };
    });

    // Right-click context menu
    element.addEventListener('contextmenu', (e) => {
        const tableName = element.id.replace('table-', '');
        showContextMenu(e, tableName);
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

// Tablo gruplarını oluşturan yardımcı fonksiyon
function createTableGroups(parsedTables) {
    const relatedTables = [];
    const unrelatedTables = [];

    // Önce ilişkili ve ilişkisiz tabloları ayır
    parsedTables.forEach(table => {
        if (hasAnyRelationship(table, parsedTables)) {
            relatedTables.push(table);
        } else {
            unrelatedTables.push(table);
        }
    });

    const groups = [];
    const processedTables = new Set();

    // İlişkili tablolar için grup oluştur
    relatedTables.forEach(table => {
        if (processedTables.has(table.tableName)) return;

        const group = { mainTable: table, relatedTables: [], isRelated: true };
        processedTables.add(table.tableName);

        // Bu tabloya referans veren tabloları bul
        relatedTables.forEach(otherTable => {
            if (otherTable.tableName !== table.tableName && !processedTables.has(otherTable.tableName)) {
                const hasReference = otherTable.foreignKeys.some(fk => fk.referencesTable === table.tableName);
                if (hasReference) {
                    group.relatedTables.push(otherTable);
                    processedTables.add(otherTable.tableName);
                }
            }
        });

        groups.push(group);
    });

    // İşlenmemiş ilişkili tabloları tekil gruplar olarak ekle
    relatedTables.forEach(table => {
        if (!processedTables.has(table.tableName)) {
            groups.push({ mainTable: table, relatedTables: [], isRelated: true });
        }
    });

    // İlişkisiz tabloları ayrı bir grup olarak ekle
    if (unrelatedTables.length > 0) {
        groups.push({
            mainTable: null,
            relatedTables: unrelatedTables,
            isRelated: false,
            isUnrelatedGroup: true
        });
    }

    return groups;
}

// Tablo yüksekliğini hesaplayan yardımcı fonksiyon
function calculateTableHeight(table) {
    // Eğer tablo DOM'da varsa gerçek yüksekliğini al
    const tableElement = tables[table.tableName];
    if (tableElement) {
        return tableElement.offsetHeight;
    }

    // DOM'da yoksa tahmini hesaplama yap
    const titleHeight = 50; // Table name için
    const columnHeight = 32; // Her column için (margin + padding dahil)
    const padding = 30; // Top ve bottom padding

    return titleHeight + (table.columns.length * columnHeight) + padding;
}

// Gelişmiş yerleştirme algoritması
function calculateTablePositions(parsedTables) {
    const positions = {};
    const tableWidth = 450;
    const baseTableHeight = 200; // Minimum yükseklik
    const groupPadding = 200; // Gruplar arası mesafe
    const horizontalTablePadding = tableWidth; // Yatayda bir tablo genişliği kadar boşluk
    const verticalTablePadding = 100; // Dikeyde 100px boşluk

    // Ekranın ortasından başlayacak şekilde pozisyon hesapla
    const viewportWidth = window.innerWidth || 1200;
    const viewportHeight = window.innerHeight || 800;
    const startX = Math.max(100, viewportWidth / 4); // En az 100px, yoksa ekranın 1/4'ü
    const startY = Math.max(100, viewportHeight / 6); // En az 100px, yoksa ekranın 1/6'sı

    const groups = createTableGroups(parsedTables);

    // İlişkili ve ilişkisiz grupları ayır
    const relatedGroups = groups.filter(group => group.isRelated !== false);
    const unrelatedGroups = groups.filter(group => group.isUnrelatedGroup === true);

    let currentX = startX;
    let currentY = startY;
    let maxGroupHeight = 0;
    let maxRelatedX = startX; // İlişkili tabloların en sağ noktası

    // Önce ilişkili grupları yerleştir
    relatedGroups.forEach((group, groupIndex) => {
        const groupTables = group.mainTable ? [group.mainTable, ...group.relatedTables] : group.relatedTables;
        const tablesPerRow = 6; // Satır başına 6 tablo (3'ten 6'ya artırıldı)
        const groupWidth = Math.min(tablesPerRow, groupTables.length) * (tableWidth + horizontalTablePadding);

        // Bu gruptaki satır yüksekliklerini hesapla
        const rowHeights = [];

        // Her satırdaki en yüksek tabloyu bul
        for (let row = 0; row < Math.ceil(groupTables.length / tablesPerRow); row++) {
            let maxRowHeight = baseTableHeight;
            for (let col = 0; col < tablesPerRow; col++) {
                const tableIndex = row * tablesPerRow + col;
                if (tableIndex < groupTables.length) {
                    const table = groupTables[tableIndex];
                    const tableHeight = calculateTableHeight(table);
                    maxRowHeight = Math.max(maxRowHeight, tableHeight);
                }
            }
            rowHeights.push(maxRowHeight);
        }

        // Grup içindeki tabloları yerleştir
        groupTables.forEach((table, tableIndex) => {
            if (!table) return; // mainTable null olabilir

            const row = Math.floor(tableIndex / tablesPerRow);
            const col = tableIndex % tablesPerRow;

            const x = currentX + col * (tableWidth + horizontalTablePadding);

            // Y pozisyonunu önceki satırların toplam yüksekliği + padding'e göre hesapla
            let y = currentY;
            for (let i = 0; i < row; i++) {
                y += rowHeights[i] + verticalTablePadding;
            }

            positions[table.tableName] = { x, y };
        });

        // Grup yüksekliğini hesapla
        const totalGroupHeight = rowHeights.reduce((sum, height) => sum + height, 0) +
            (rowHeights.length - 1) * verticalTablePadding;
        maxGroupHeight = Math.max(maxGroupHeight, totalGroupHeight);

        // Bir sonraki grup konumunu hesapla
        currentX += groupWidth + groupPadding;
        maxRelatedX = Math.max(maxRelatedX, currentX);

        // Eğer çok sağa gittiyse alt satıra geç
        if (currentX > 4000) { // 2500'den 4000'e artırıldı (6 tablo için daha geniş alan)
            currentX = startX;
            currentY += maxGroupHeight + groupPadding;
            maxGroupHeight = 0;
        }
    });

    // İlişkisiz tabloları en sağa yerleştir
    if (unrelatedGroups.length > 0) {
        const unrelatedGroup = unrelatedGroups[0];
        const unrelatedTables = unrelatedGroup.relatedTables;

        // İlişkisiz tablolar için ayrı alan
        const unrelatedStartX = maxRelatedX + groupPadding * 2; // Ekstra mesafe
        let unrelatedCurrentX = unrelatedStartX;
        let unrelatedCurrentY = startY;

        const tablesPerRow = 4; // İlişkisiz tablolar için 2'den 4'e artırıldı

        // İlişkisiz tabloları yerleştir
        unrelatedTables.forEach((table, index) => {
            const row = Math.floor(index / tablesPerRow);
            const col = index % tablesPerRow;

            const x = unrelatedCurrentX + col * (tableWidth + horizontalTablePadding);
            const y = unrelatedCurrentY + row * (baseTableHeight + verticalTablePadding);

            positions[table.tableName] = { x, y };
        });
    }

    return positions;
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

        table.columns.forEach(col => {
            const colDiv = document.createElement('div');
            colDiv.className = 'column';
            colDiv.id = `${table.tableName}-${col.name}`;
            colDiv.innerText = `${col.name} (${col.type})`;
            div.appendChild(colDiv);
        });

        document.getElementById('canvas').appendChild(div);
        tables[table.tableName] = div;
        window.parsedTables.push(table);
        makeDraggable(div);
    });

    // DOM'a eklendikten sonra pozisyonları hesapla ve güncelle
    setTimeout(() => {
        const positions = calculateTablePositions(allTables);

        // Tüm tabloların pozisyonlarını güncelle
        allTables.forEach((table) => {
            const position = positions[table.tableName];
            const tableElement = tables[table.tableName];
            if (tableElement && position) {
                tableElement.style.left = `${position.x}px`;
                tableElement.style.top = `${position.y}px`;
            }
        });

        drawConnections();

        // Tablolar yerleştirildikten sonra otomatik zoom yap
        setTimeout(() => {
            autoFitZoom();
        }, 100); // Pozisyonların tamamen yerleşmesi için biraz daha bekle
    }, 10); // DOM render'ının tamamlanması için kısa bir gecikme
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
    applyZoom();    // İçeriği merkeze getir
    setTimeout(() => {
        const newContentWidth = contentWidth * targetZoom;
        const newContentHeight = contentHeight * targetZoom;
        const newMinX = minX * targetZoom;
        const newMinY = minY * targetZoom;

        // Merkez hesaplama
        const scrollX = newMinX - (viewportWidth - newContentWidth) / 2;
        const scrollY = newMinY - (viewportHeight - newContentHeight) / 2;

        outputWrapper.scrollLeft = Math.max(0, scrollX);
        outputWrapper.scrollTop = Math.max(0, scrollY);
    }, 50);
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

function drawConnections() {
    const svg = document.getElementById('connections');
    svg.innerHTML = '';

    // Highlight durumunu kontrol et - highlighted tablolar var mı?
    const highlightedElements = document.querySelectorAll('.table-box.highlighted');
    const isHighlightMode = highlightedElements.length > 0;
    const highlightedTables = new Set();

    if (isHighlightMode) {
        highlightedElements.forEach(table => {
            const tableName = table.id.replace('table-', '');
            highlightedTables.add(tableName);
        });
    }

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
                    (highlightedTables.has(table.tableName) && highlightedTables.has(fk.referencesTable));

                // Self-reference kontrolü (aynı tablodaki sütunlar arası ilişki)
                if (table.tableName === fk.referencesTable) {
                    // Self-reference için özel curved path
                    const fromCenterX = fromRect.left + fromRect.width / 2 - svgRect.left;
                    const fromCenterY = fromRect.top + fromRect.height / 2 - svgRect.top;
                    const toCenterX = toRect.left + toRect.width / 2 - svgRect.left;
                    const toCenterY = toRect.top + toRect.height / 2 - svgRect.top;

                    // Sağ kenardan çıkış
                    const startX = fromRect.right - svgRect.left;
                    const startY = fromCenterY;
                    const endX = toRect.right - svgRect.left;
                    const endY = toCenterY;

                    // Curved path for self-reference
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const offsetX = 50;
                    const d = `M${startX},${startY} C${startX + offsetX},${startY} ${endX + offsetX},${endY} ${endX},${endY}`;

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
                    path.setAttribute('stroke', '#e74c3c');
                    path.setAttribute('stroke-width', '2');
                    path.setAttribute('fill', 'none');
                    path.setAttribute('marker-end', 'url(#arrow)');

                    if (isHighlightedConnection) {
                        path.setAttribute('class', 'connection-highlighted highlighted-connection');
                    } else {
                        path.setAttribute('class', 'connection-normal');
                        if (isHighlightMode) {
                            path.setAttribute('opacity', '0.3');
                        }
                    }
                    svg.appendChild(path);
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
                    line.setAttribute('stroke', '#3498db');
                    line.setAttribute('stroke-width', '2');
                    line.setAttribute('marker-end', 'url(#arrow)');

                    if (isHighlightedConnection) {
                        line.setAttribute('class', 'connection-highlighted highlighted-connection');
                    } else {
                        line.setAttribute('class', 'connection-normal');
                        if (isHighlightMode) {
                            line.setAttribute('opacity', '0.3');
                        }
                    }
                    svg.appendChild(line);
                }
            }
        });
    });
}



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

// Tabloları highlight eden fonksiyon
function highlightTable(tableName) {
    const relatedTableNames = getRelatedTables(tableName);

    // Tüm tabloları dim yap
    Object.values(tables).forEach(tableElement => {
        tableElement.classList.remove('highlighted', 'dimmed');
        tableElement.classList.add('dimmed');
    });

    // İlişkili tabloları highlight yap
    relatedTableNames.forEach(name => {
        const tableElement = tables[name];
        if (tableElement) {
            tableElement.classList.remove('dimmed');
            tableElement.classList.add('highlighted');
        }
    });

    // Bağlantıları yeniden çiz
    drawConnections();
}

// Tabloyu SQL olarak export eden fonksiyon
function exportTableAsSQL(tableName) {
    const table = window.parsedTables.find(t => t.tableName === tableName);
    if (!table) {
        alert('Tablo bulunamadı!');
        return;
    }

    let sql = `CREATE TABLE \`${table.tableName}\` (\n`;

    // Sütunları ekle
    const columnDefinitions = table.columns.map(col => {
        return `  \`${col.name}\` ${col.type}`;
    });

    sql += columnDefinitions.join(',\n');

    // Foreign key'leri ekle
    if (table.foreignKeys && table.foreignKeys.length > 0) {
        sql += ',\n';
        const foreignKeyDefinitions = table.foreignKeys.map(fk => {
            return `  CONSTRAINT \`fk_${table.tableName}_${fk.column}\` FOREIGN KEY (\`${fk.column}\`) REFERENCES \`${fk.referencesTable}\` (\`${fk.referencesColumn}\`)`;
        });
        sql += foreignKeyDefinitions.join(',\n');
    }

    sql += '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;';

    // Popup göster
    showExportPopup(tableName, sql);
}

// Export popup'ını gösteren fonksiyon
function showExportPopup(tableName, sqlContent) {
    // Mevcut popup'ı kaldır
    const existingPopup = document.getElementById('export-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    // Popup container
    const popup = document.createElement('div');
    popup.id = 'export-popup';
    popup.className = 'export-popup';

    // Popup content
    const content = document.createElement('div');
    content.className = 'export-popup-content';

    // Header
    const header = document.createElement('div');
    header.className = 'export-popup-header';
    header.innerHTML = `
        <h3>📤 SQL Export - ${tableName}</h3>
        <button class="export-close-btn" onclick="hideExportPopup()">×</button>
    `;

    // SQL Content
    const sqlTextarea = document.createElement('textarea');
    sqlTextarea.className = 'export-sql-textarea';
    sqlTextarea.value = sqlContent;
    sqlTextarea.readOnly = true;

    // Buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'export-popup-buttons';

    const copyButton = document.createElement('button');
    copyButton.className = 'export-btn export-btn-primary';
    copyButton.textContent = '📋 Kopyala';
    copyButton.onclick = () => {
        sqlTextarea.select();
        document.execCommand('copy');
        copyButton.textContent = '✅ Kopyalandı!';
        setTimeout(() => {
            copyButton.textContent = '📋 Kopyala';
        }, 2000);
    };

    const closeButton = document.createElement('button');
    closeButton.className = 'export-btn export-btn-secondary';
    closeButton.textContent = 'Kapat';
    closeButton.onclick = hideExportPopup;

    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(closeButton);

    // Popup'ı birleştir
    content.appendChild(header);
    content.appendChild(sqlTextarea);
    content.appendChild(buttonContainer);
    popup.appendChild(content);

    // Sayfaya ekle
    document.body.appendChild(popup);

    // Textarea'yı seç
    setTimeout(() => {
        sqlTextarea.select();
    }, 100);
}

// Export popup'ını gizleyen fonksiyon
function hideExportPopup() {
    const popup = document.getElementById('export-popup');
    if (popup) {
        popup.remove();
    }
}

// Highlight'ı temizleyen fonksiyon
function clearHighlight() {
    Object.values(tables).forEach(tableElement => {
        tableElement.classList.remove('highlighted', 'dimmed');
    });

    // Bağlantıları yeniden çiz
    drawConnections();
}// Context menu oluşturan fonksiyon
function createContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.className = 'context-menu';

    const highlightItem = document.createElement('div');
    highlightItem.className = 'context-menu-item';
    highlightItem.textContent = '🔍 Öne Çıkar';
    highlightItem.onclick = function () {
        const tableName = menu.dataset.tableName;
        if (tableName) {
            highlightTable(tableName);
        }
        hideContextMenu();
    };

    const exportItem = document.createElement('div');
    exportItem.className = 'context-menu-item';
    exportItem.textContent = '📤 Dışa Aktar';
    exportItem.onclick = function () {
        const tableName = menu.dataset.tableName;
        if (tableName) {
            exportTableAsSQL(tableName);
        }
        hideContextMenu();
    };

    menu.appendChild(highlightItem);
    menu.appendChild(exportItem);
    document.body.appendChild(menu);

    return menu;
}

// Context menu'yu gösteren fonksiyon
function showContextMenu(e, tableName) {
    e.preventDefault();

    let menu = document.getElementById('context-menu');
    if (!menu) {
        menu = createContextMenu();
    }

    menu.dataset.tableName = tableName;
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
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
