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
    let offsetX, offsetY;
    element.addEventListener('mousedown', (e) => {
        offsetX = e.clientX - element.offsetLeft;
        offsetY = e.clientY - element.offsetTop;
        document.onmousemove = function (e) {
            element.style.left = (e.clientX - offsetX) + 'px';
            element.style.top = (e.clientY - offsetY) + 'px';
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

        const div = document.createElement('div');
        div.className = 'table-box';
        div.style.left = (50 + Object.keys(tables).length * 250) + 'px';
        div.style.top = '50px';
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

        output.appendChild(div);
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