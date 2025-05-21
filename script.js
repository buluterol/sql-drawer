let tables = {};

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

    element.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startY = e.clientY;

        // Doğrudan elementin kendi offsetLeft ve offsetTop'unu al (scale uygulanmamış)
        startLeft = parseFloat(element.style.left) || 0;
        startTop = parseFloat(element.style.top) || 0;

        document.onmousemove = function (e) {
            const dx = (e.clientX - startX) / scale;
            const dy = (e.clientY - startY) / scale;

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

            drawConnections();
        };

        document.onmouseup = function () {
            document.onmousemove = null;
            document.onmouseup = null;
        };
    });
}




function visualize() {
    const sql = document.getElementById('sqlInput').value;
    const parsedTables = parseCreateTable(sql);
    const output = document.getElementById('output');
    const svg = document.getElementById('connections');
    if (!window.parsedTables) {
        window.parsedTables = [];
    }

    parsedTables.forEach((table, index) => {
        if (tables[table.tableName]) {
            console.log(`Tablo zaten var: ${table.tableName}`);
            return;
        }

        const tableWidth = 220;
        const tableHeight = 150;
        const padding = 50;
        const canvasWidth = 3000; // maksimum genişlik

        const maxPerRow = Math.floor((canvasWidth - padding) / (tableWidth + padding));
        const row = Math.floor(index / maxPerRow);
        const col = index % maxPerRow;

        const left = padding + col * (tableWidth + padding);
        const top = padding + row * (tableHeight + padding);

        const div = document.createElement('div');
        div.className = 'table-box';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
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


    drawConnections();
}

function drawConnections() {
    const svg = document.getElementById('connections');
    svg.innerHTML = '';

    window.parsedTables.forEach(table => {
        table.foreignKeys.forEach(fk => {
            const fromElement = document.getElementById(`${table.tableName}-${fk.column}`);
            const toElement = document.getElementById(`${fk.referencesTable}-${fk.referencesColumn}`);
            if (fromElement && toElement) {
                const fromRect = fromElement.getBoundingClientRect();
                const toRect = toElement.getBoundingClientRect();
                const svgRect = svg.getBoundingClientRect();

                if (table.tableName === fk.referencesTable) {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const startX = fromRect.right - svgRect.left;
                    const startY = fromRect.top + fromRect.height / 2 - svgRect.top;
                    const endX = toRect.right + 50 - svgRect.left;
                    const endY = toRect.top + toRect.height / 2 - svgRect.top;

                    const d = `M${startX},${startY} C${startX + 50},${startY - 50} ${endX + 50},${endY + 50} ${endX},${endY}`;
                    path.setAttribute('d', d);
                    path.setAttribute('stroke', '#f00');
                    path.setAttribute('fill', 'none');
                    path.setAttribute('marker-end', 'url(#arrow)');
                    svg.appendChild(path);
                } else {
                    const fromLeft = fromRect.left - svgRect.left;
                    const fromRight = fromRect.left + fromRect.width - svgRect.left;
                    const fromCenterY = fromRect.top + fromRect.height / 2 - svgRect.top;

                    const toLeft = toRect.left - svgRect.left;
                    const toRight = toRect.left + toRect.width - svgRect.left;
                    const toCenterY = toRect.top + toRect.height / 2 - svgRect.top;

                    const fromX = (fromLeft < toLeft) ? fromRight : fromLeft;
                    const toX = (fromLeft < toLeft) ? toLeft : toRight;

                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', fromX);
                    line.setAttribute('y1', fromCenterY);
                    line.setAttribute('x2', toX);
                    line.setAttribute('y2', toCenterY);
                    svg.appendChild(line);
                }
            }
        });
    });
}



let scale = 1;

document.addEventListener('wheel', function (e) {
    if (e.ctrlKey) {
        e.preventDefault();
        const wrapper = document.getElementById('output');

        if (e.deltaY < 0) {
            scale += 0.05; // Zoom in
        } else {
            scale -= 0.05; // Zoom out
        }

        scale = Math.min(Math.max(0.2, scale), 3); // Zoom aralığını sınırla

        wrapper.style.zoom = scale; // CSS zoom kullanımı
        drawConnections(); // Bağlantıları yeniden çiz
    }
}, { passive: false });



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
