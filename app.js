/**
 * Logica Principal do Geoportal WebGIS (Leaflet + PapaParse + Chart.js)
 * Suporte a Padrao Personalizado de Cores/Opacidades, Status "Resistente" e Nome de Area no Modal
 */

document.addEventListener('DOMContentLoaded', () => {
    // ESTADO GLOBAL DA APLICAÇÃO
    const state = {
        map: null,
        activeBaseMapLayer: null,
        baseMapLayers: {},
        geojsonLayer: null,
        rawGeoJSON: null,
        csvStatusMap: new Map(),      // Chave: COD_GERAL => Status Simplificado
        csvAreaNameMap: new Map(),    // Chave: COD_GERAL => AREA_NOME
        csvCodeToAreaNameMap: new Map(), // Chave: COD_AREA => AREA_NOME
        activeFilters: {
            area: 'ALL',
            category: 'ALL',
            lote: 'ALL',
            statuses: new Set(['Imóvel Selado', 'Frente De Obras', 'Removido', 'Em Tratativas', 'Resistente', 'Não Informado'])
        },
        filteredFeatures: [],
        charts: {
            donut: null,
            barArea: null
        },
        csvLoteMap: new Map(),        // Chave: COD_GERAL => LOTE
        areaToLoteMap: new Map(),     // Chave: COD_AREA => LOTE (relação 1:1)
        extraLayers: {
            limiteDTS: null,
            lotesMananciais: null
        },
        extraLayersInstances: {
            limiteDTS: null,
            lotesMananciais: null
        },
        userLayers: []                // Camadas enviadas pelo usuário
    };

    // INICIALIZAÇÃO DO GEOPORTAL
    initMap();
    setupEventListeners();
    initUpdateBadge();
    loadData();

    function initUpdateBadge() {
        if (CONFIG.lastUpdate && CONFIG.lastUpdate.date) {
            document.getElementById('updateDate').textContent = CONFIG.lastUpdate.date;
            document.getElementById('updateDesc').textContent = CONFIG.lastUpdate.description || '';
            
            const badge = document.getElementById('updateInfoBadge');
            badge.style.display = 'flex';
            badge.style.opacity = '1';
            
            // Inicia o fade out após 4 segundos (para totalizar 5s com a transição de 1s)
            setTimeout(() => {
                badge.style.opacity = '0';
                
                // Remove do DOM visualmente após a transição terminar
                setTimeout(() => {
                    badge.style.display = 'none';
                }, 1000);
            }, 4000);
        }
    }

    /**
     * Helper para Normalização de Strings de Status (Inclui Resistente)
     */
    function normalizeStatus(val) {
        if (!val) return "Não Informado";
        const v = String(val).trim();
        const vLower = v.toLowerCase();

        if (vLower.includes('resistente')) {
            return "Resistente";
        }
        if (vLower.includes('selado') || (vLower.includes('im') && vLower.includes('vel'))) {
            return "Imóvel Selado";
        }
        if (vLower.includes('obras') || vLower.includes('frente')) {
            return "Frente De Obras";
        }
        if (vLower.includes('removid')) {
            return "Removido";
        }
        if (vLower.includes('tratativ')) {
            return "Em Tratativas";
        }
        return v || "Não Informado";
    }

    /**
     * Helper para Resolver o Nome Oficial da Área/Favela
     */
    function resolveAreaName(props) {
        const code1 = props.cod_geral || props.COD_GERAL;
        const areaCode = props.cod_area || props.COD_AREA;

        if (code1) {
            const nameFromCSV = state.csvAreaNameMap.get(String(code1).trim().toUpperCase());
            if (nameFromCSV) return nameFromCSV;
        }

        if (areaCode) {
            const nameFromAreaMap = state.csvCodeToAreaNameMap.get(String(areaCode).trim());
            if (nameFromAreaMap) return nameFromAreaMap;
        }

        if (areaCode && CONFIG.areaNames[areaCode]) {
            return CONFIG.areaNames[areaCode];
        }

        return props.nome_area || props.NOME_AREA || areaCode || 'Desconhecida';
    }

    /**
     * 1. Inicializa o Mapa Leaflet e os Base Maps
     */
    function initMap() {
        state.map = L.map('map', {
            center: [-23.5505, -46.6333],
            zoom: 13,
            zoomControl: false,
            preferCanvas: true // Renderiza vetores em Canvas HTML5, sincronizando com os tiles e evitando desencaixe no html2canvas
        });

        L.control.zoom({ position: 'topright' }).addTo(state.map);

        const container = document.getElementById('basemapContainer');
        container.innerHTML = '';

        CONFIG.baseMaps.forEach((bm, idx) => {
            const tileLayer = L.tileLayer(bm.url, {
                attribution: bm.attribution,
                maxZoom: bm.maxZoom,
                crossOrigin: true
            });
            state.baseMapLayers[bm.id] = tileLayer;

            if (idx === 0) {
                tileLayer.addTo(state.map);
                state.activeBaseMapLayer = tileLayer;
            }

            const card = document.createElement('div');
            card.className = `basemap-card ${idx === 0 ? 'active' : ''}`;
            card.dataset.id = bm.id;
            
            let iconClass = 'fa-earth-americas';
            if (bm.id === 'light') iconClass = 'fa-map';
            if (bm.id === 'dark') iconClass = 'fa-moon';

            card.innerHTML = `
                <i class="fa-solid ${iconClass}"></i>
                <span>${bm.name}</span>
            `;

            card.addEventListener('click', () => switchBaseMap(bm.id));
            container.appendChild(card);
        });
    }

    function switchBaseMap(id) {
        if (state.activeBaseMapLayer) {
            state.map.removeLayer(state.activeBaseMapLayer);
        }
        state.activeBaseMapLayer = state.baseMapLayers[id];
        state.activeBaseMapLayer.addTo(state.map);

        document.querySelectorAll('.basemap-card').forEach(card => {
            card.classList.toggle('active', card.dataset.id === id);
        });
    }

    /**
     * 2. Carrega o GeoJSON e o CSV de Forma Dinâmica
     */
    async function loadData() {
        showToast('Carregando dados cartográficos e tabela de status...', 'info');

        try {
            await loadCSVData(CONFIG.csvPath);

            // Carrega as camadas adicionais silenciosamente
            try {
                const resLimite = await fetch(CONFIG.extraLayers.limiteDTS.path + '?t=' + Date.now());
                if (resLimite.ok) state.extraLayers.limiteDTS = await resLimite.json();
            } catch(e) { console.warn('Camada limite_dts não encontrada', e); }

            try {
                const resLotes = await fetch(CONFIG.extraLayers.lotesMananciais.path + '?t=' + Date.now());
                if (resLotes.ok) state.extraLayers.lotesMananciais = await resLotes.json();
            } catch(e) { console.warn('Camada lotes_mananciais não encontrada', e); }

            const response = await fetch(CONFIG.geojsonPath + '?t=' + Date.now());
            if (!response.ok) throw new Error('Não foi possível ler o arquivo base_selagem.geojson');
            
            state.rawGeoJSON = await response.json();
            
            processAndRenderGeoJSON();
            populateFilterOptions();
            updateStatistics();

            showToast(`WebGIS pronto! ${state.rawGeoJSON.features.length} edificações reconhecidas.`, 'success');
        } catch (err) {
            console.error('Erro ao carregar dados:', err);
            if (window.location.protocol === 'file:') {
                showToast('Atenção: Para abrir em outras máquinas, dê 2 cliques no arquivo "iniciar_geoportal.bat"!', 'error');
                alert('DICA PARA OUTROS COMPUTADORES:\n\nOs navegadores bloqueiam o carregamento direto por segurança (CORS).\n\nPara abrir o Geoportal em qualquer computador sem instalar nada, por favor execute o arquivo "iniciar_geoportal.bat" com 2 cliques na pasta do projeto!');
            } else {
                showToast('Erro ao carregar dados da pasta. Verifique se os arquivos estão na mesma pasta.', 'error');
            }
        }
    }

    function loadCSVData(path) {
        return new Promise((resolve, reject) => {
            Papa.parse(path + '?t=' + Date.now(), {
                download: true,
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    state.csvStatusMap.clear();
                    state.csvAreaNameMap.clear();
                    state.csvLoteMap.clear();
                    state.csvCodeToAreaNameMap.clear();

                    results.data.forEach(row => {
                        const code = row['COD_GERAL'] || row['cod_geral'] || row[CONFIG.joinKey];
                        const rawStatus = row['Status Simplificado'] || row['status_simplificado'] || row['Status'];
                        const areaCode = row['COD_AREA'] || row['cod_area'];
                        const areaName = row['AREA_NOME'] || row['area_nome'] || row['NOME_AREA'] || row['nome_area'];
                        const lote = row['nome_lote'] || row['NOME_LOTE'] || row['Nome_Lote'] || row['Nome_lote'] || row['Lote'] || row['lote'] || row['LOTE'];

                        if (code) {
                            const cleanCode = String(code).trim().toUpperCase();
                            state.csvStatusMap.set(cleanCode, normalizeStatus(rawStatus));

                            if (areaName) {
                                state.csvAreaNameMap.set(cleanCode, String(areaName).trim());
                            }
                            if (lote) {
                                state.csvLoteMap.set(cleanCode, String(lote).trim());
                            }
                        }

                        if (areaCode && areaName) {
                            state.csvCodeToAreaNameMap.set(String(areaCode).trim(), String(areaName).trim());
                        }
                    });
                    console.log(`CSV parsed: ${state.csvStatusMap.size} status e ${state.csvAreaNameMap.size} nomes de áreas associados.`);
                    resolve();
                },
                error: (err) => reject(err)
            });
        });
    }

    /**
     * 3. Processamento do GeoJSON e Cruzamento de Dados (Join)
     */
    function processAndRenderGeoJSON() {
        if (!state.rawGeoJSON || !state.rawGeoJSON.features) return;

        if (state.geojsonLayer) {
            state.map.removeLayer(state.geojsonLayer);
        }

        state.rawGeoJSON.features.forEach(feature => {
            const props = feature.properties || {};
            const code1 = props.cod_geral || props.COD_GERAL;
            const code2 = props.cod_selo || props.COD_SELO;

            let status = null;

            if (code1) {
                status = state.csvStatusMap.get(String(code1).trim().toUpperCase());
            }

            if (!status && code2) {
                status = state.csvStatusMap.get(String(code2).trim().toUpperCase());
            }

            if (!status) {
                status = normalizeStatus(props['Status Simplificado'] || props['status_selo'] || props['status']);
            }

            props._status_simplificado = status || 'Não Informado';
            props._nome_area_resolvido = resolveAreaName(props);
            
            // Pega o lote a partir do CSV ou diretamente da coluna nome_lote do GeoJSON
            let resolvedLote = null;
            if (code1) resolvedLote = state.csvLoteMap.get(String(code1).trim().toUpperCase());
            if (!resolvedLote && code2) resolvedLote = state.csvLoteMap.get(String(code2).trim().toUpperCase());
            if (!resolvedLote) {
                resolvedLote = props.nome_lote || props.NOME_LOTE || props.Nome_Lote || props.Nome_lote || props.lote || props.LOTE || props.Lote;
            }
            props._lote_resolvido = resolvedLote ? String(resolvedLote).trim() : 'N/A';

            // Mapeia a Área / Favela para o seu respectivo Lote (relação 1:1)
            const areaCode = props.cod_area || props.COD_AREA;
            if (areaCode && props._lote_resolvido && props._lote_resolvido !== 'N/A' && props._lote_resolvido !== '-') {
                state.areaToLoteMap.set(String(areaCode).trim(), props._lote_resolvido);
            }
        });

        filterFeatures();
    }

    function filterFeatures() {
        if (!state.rawGeoJSON) return;

        state.filteredFeatures = state.rawGeoJSON.features.filter(feature => {
            const props = feature.properties || {};
            const area = props.cod_area || props.COD_AREA || 'OUTROS';
            const category = props.categoria || props.CATEGORIA || 'N/A';
            const lote = props._lote_resolvido || 'N/A';
            const status = props._status_simplificado;

            if (state.activeFilters.area !== 'ALL' && area !== state.activeFilters.area) {
                return false;
            }

            if (state.activeFilters.category !== 'ALL' && category !== state.activeFilters.category) {
                return false;
            }
            
            if (state.activeFilters.lote !== 'ALL') {
                const filterLote = String(state.activeFilters.lote).trim().toUpperCase();
                const featLote = String(props._lote_resolvido || '').trim().toUpperCase();
                if (featLote !== filterLote) {
                    return false;
                }
            }

            if (!state.activeFilters.statuses.has(status)) {
                return false;
            }

            return true;
        });

        state.geojsonLayer = L.geoJSON({
            type: 'FeatureCollection',
            features: state.filteredFeatures
        }, {
            style: styleFeature,
            onEachFeature: onEachFeature
        }).addTo(state.map);

        // Mantém as camadas de limites no fundo para nunca obstruir os cliques na selagem
        if (state.extraLayersInstances.lotesMananciais) {
            state.extraLayersInstances.lotesMananciais.bringToBack();
        }
        if (state.extraLayersInstances.limiteDTS) {
            state.extraLayersInstances.limiteDTS.bringToBack();
        }

        if (state.filteredFeatures.length > 0) {
            const bounds = state.geojsonLayer.getBounds();
            if (bounds.isValid()) {
                state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
            }
        }
    }

    /**
     * Aplica Estilização: categoria (para não-domicílios) tem prioridade visual, status para domicílios
     */
    function styleFeature(feature) {
        const props = feature.properties || {};
        const cat = props.categoria || props.CATEGORIA || 'Domicílio';

        // Feições não-domiciliares recebem cor de categoria
        if (cat !== 'Domicílio') {
            const catCfg = CONFIG.categoryColors[cat];
            if (catCfg) {
                return {
                    fillColor: catCfg.color,
                    weight: 1.2,
                    opacity: 1,
                    color: catCfg.border,
                    fillOpacity: catCfg.opacity
                };
            }
        }

        // Domicílios: cor pelo status
        const status = feature.properties._status_simplificado;
        const configColor = CONFIG.statusColors[status] || CONFIG.statusColors['Não Informado'];

        return {
            fillColor: configColor.color,
            weight: 1.2,
            opacity: 1,
            color: configColor.border,
            fillOpacity: configColor.opacity !== undefined ? configColor.opacity : 0.70
        };
    }

    function onEachFeature(feature, layer) {
        const props = feature.properties || {};
        const code = props.cod_geral || props.COD_GERAL || props.cod_selo || 'N/A';
        const areaCode = props.cod_area || props.COD_AREA || 'N/A';
        const areaName = props._nome_area_resolvido || resolveAreaName(props);
        const status = props._status_simplificado;
        const selo = props.cod_selo || props.COD_SELO || 'N/A';
        const cat = props.categoria || props.CATEGORIA || 'Domicílio';
        const rawLote = props._lote_resolvido || props.nome_lote || props.NOME_LOTE || props.lote || props.LOTE || '-';

        let loteFormatted = '-';
        if (rawLote && rawLote !== '-' && rawLote !== 'N/A') {
            loteFormatted = String(rawLote).trim().toLowerCase().startsWith('lote')
                ? String(rawLote).trim()
                : `Lote ${String(rawLote).trim()}`;
        }

        // Determina cores para tooltip/popup: categoria tem prioridade para não-domicílios
        let tooltipBg, tooltipBorder, tooltipTextColor;
        if (cat !== 'Domicílio' && CONFIG.categoryColors[cat]) {
            const catCfg = CONFIG.categoryColors[cat];
            tooltipBg = catCfg.color;
            tooltipBorder = catCfg.border;
            tooltipTextColor = '#ffffff';
        } else {
            const configColor = CONFIG.statusColors[status] || CONFIG.statusColors['Não Informado'];
            tooltipBg = configColor.color;
            tooltipBorder = configColor.border;
            tooltipTextColor = (configColor.color === '#ffffff' || configColor.color === '#ffff00') ? '#1e293b' : '#ffffff';
        }

        const configColor = CONFIG.statusColors[status] || CONFIG.statusColors['Não Informado'];
        const badgeTextColor = (configColor.color === '#ffffff' || configColor.color === '#ffff00') ? '#1e293b' : '#ffffff';

        // Linha do Lote no tooltip (exibida logo abaixo de Favela/Área)
        const loteLine = (loteFormatted && loteFormatted !== '-')
            ? `<div style="font-size:11px; color:#1e293b; font-weight:600;">Lote: ${loteFormatted}</div>`
            : '';

        // Linha de tipo no tooltip: categoria real (nunca N/A)
        const catLabel = (cat && cat !== 'Domicílio') ? `<div style="font-size:10px; color:#475569; font-weight:600; margin-top:1px;">Categoria: ${cat}</div>` : '';

        layer.bindTooltip(`
            <div style="font-weight:700; font-size:12px;">${code}</div>
            <div style="font-size:11px; color:#1e293b; font-weight:600;">Favela/Área: ${areaName} (${areaCode})</div>
            ${loteLine}
            ${catLabel}
            <div style="font-size:11px; margin-top:3px;">
                <span class="badge-status" style="background:${tooltipBg}; color:${tooltipTextColor}; border:1px solid ${tooltipBorder}">${cat !== 'Domicílio' ? cat : status}</span>
            </div>
        `, { sticky: true });

        layer.on({
            mouseover: (e) => {
                const l = e.target;
                l.setStyle({
                    weight: 3,
                    color: '#38bdf8',
                    fillOpacity: 0.95
                });
                l.bringToFront();
            },
            mouseout: (e) => {
                state.geojsonLayer.resetStyle(e.target);
            },
            click: (e) => {
                const textColor = (configColor.color === '#ffffff' || configColor.color === '#ffff00') ? '#1e293b' : '#ffffff';

                // Linha de status no popup: para não-domicílios mostra categoria + status
                const statusRow = cat !== 'Domicílio'
                    ? `<div class="popup-row" style="margin-top:10px; border-top:1px dashed #334155; padding-top:8px;">
                            <span class="popup-label">Categoria:</span>
                            <span class="badge-status" style="background:${tooltipBg}; color:${tooltipTextColor}; border:1px solid ${tooltipBorder}">${cat}</span>
                       </div>
                       <div class="popup-row">
                            <span class="popup-label">Status:</span>
                            <span class="badge-status" style="background:${configColor.color}; color:${badgeTextColor}; border:1px solid ${configColor.border}">${status}</span>
                       </div>`
                    : `<div class="popup-row" style="margin-top:10px; border-top:1px dashed #334155; padding-top:8px;">
                            <span class="popup-label">Status Simplificado:</span>
                            <span class="badge-status" style="background:${configColor.color}; color:${textColor}; border:1px solid ${configColor.border}">${status}</span>
                       </div>`;

                const popupContent = `
                    <div class="popup-dossier">
                        <div class="popup-header">
                            <h4><i class="fa-solid fa-house-flag"></i> ${code}</h4>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Código do Selo:</span>
                            <span class="popup-val">${selo}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Área / Favela:</span>
                            <span class="popup-val">${areaName} (${areaCode})</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Lote:</span>
                            <span class="popup-val">${loteFormatted}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Uso / Categoria:</span>
                            <span class="popup-val">${cat}</span>
                        </div>
                        ${statusRow}
                    </div>
                `;
                layer.bindPopup(popupContent).openPopup();
            }
        });
    }

    /**
     * 4. Preenche os Filtros Dinâmicos na Barra Lateral
     */
    function populateFilterOptions() {
        if (!state.rawGeoJSON) return;

        const categories = new Set();
        state.rawGeoJSON.features.forEach(f => {
            const props = f.properties || {};
            const cat = props.categoria || props.CATEGORIA;
            if (cat) categories.add(cat);
        });

        populateLoteFilter();
        populateAreaFilter(state.activeFilters.lote);

        const selectCat = document.getElementById('selectCategory');
        if (selectCat) {
            selectCat.innerHTML = '<option value="ALL">Todas as Categorias</option>';
            categories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                selectCat.appendChild(opt);
            });
        }

        renderStatusFilterList();
        renderMapLegend();
    }

    /**
     * Popula a lista de Lotes principais
     */
    function populateLoteFilter() {
        const selectLote = document.getElementById('selectLote');
        if (!selectLote || !state.rawGeoJSON) return;

        const lotes = new Set();
        state.rawGeoJSON.features.forEach(f => {
            const props = f.properties || {};
            const lote = props._lote_resolvido;
            if (lote && lote !== 'N/A' && lote !== '-') {
                lotes.add(lote);
            }
        });

        const currentVal = state.activeFilters.lote;
        selectLote.innerHTML = '<option value="ALL">Todos os Lotes (Visão Geral)</option>';

        const sortedLotes = [...lotes].sort((a, b) => {
            const numA = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
            const numB = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
            if (numA !== numB) return numA - numB;
            return String(a).localeCompare(String(b), undefined, { numeric: true });
        });

        sortedLotes.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l;
            opt.textContent = String(l).toLowerCase().startsWith('lote') ? l : `Lote ${l}`;
            selectLote.appendChild(opt);
        });

        if (currentVal !== 'ALL' && lotes.has(currentVal)) {
            selectLote.value = currentVal;
        } else {
            selectLote.value = 'ALL';
            state.activeFilters.lote = 'ALL';
        }
    }

    /**
     * Popula dinamicamente a lista de Áreas/Favelas de acordo com o Lote selecionado
     * (Como cada área/favela pertence exclusivamente a 1 lote, filtra em cascata)
     */
    function populateAreaFilter(selectedLote = 'ALL') {
        const selectArea = document.getElementById('selectArea');
        if (!selectArea || !state.rawGeoJSON) return;

        const areas = new Map(); // areaCode => areaName

        state.rawGeoJSON.features.forEach(f => {
            const props = f.properties || {};
            const areaCode = props.cod_area || props.COD_AREA;
            const featLote = props._lote_resolvido;

            if (areaCode) {
                const isMatch = (selectedLote === 'ALL') || 
                    (featLote && String(featLote).trim().toUpperCase() === String(selectedLote).trim().toUpperCase());
                
                if (isMatch) {
                    const name = props._nome_area_resolvido || resolveAreaName(props);
                    areas.set(String(areaCode).trim(), name);
                }
            }
        });

        const currentArea = state.activeFilters.area;
        const loteLabel = selectedLote !== 'ALL' 
            ? ` (${String(selectedLote).trim().toLowerCase().startsWith('lote') ? selectedLote : 'Lote ' + selectedLote})` 
            : ' (Consolidado)';
            
        selectArea.innerHTML = `<option value="ALL">Todas as Favelas${loteLabel}</option>`;

        // Ordena áreas alfabeticamente pelo nome da favela
        const sortedAreas = [...areas.entries()].sort((a, b) => a[1].localeCompare(b[1]));

        sortedAreas.forEach(([code, name]) => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = `${name} (${code})`;
            selectArea.appendChild(opt);
        });

        // Se a favela selecionada anteriormente ainda pertence ao lote atual, mantém selecionada
        if (currentArea !== 'ALL' && areas.has(currentArea)) {
            selectArea.value = currentArea;
        } else {
            selectArea.value = 'ALL';
            state.activeFilters.area = 'ALL';
        }
    }

    /**
     * Renderiza a lista de Status na Barra Lateral com Quantitativos Dinâmicos por Área e Lote
     */
    function renderStatusFilterList() {
        const container = document.getElementById('statusFilterContainer');
        container.innerHTML = '';

        const counts = {};
        Object.keys(CONFIG.statusColors).forEach(st => counts[st] = 0);

        const targetFeatures = (state.rawGeoJSON ? state.rawGeoJSON.features : []).filter(f => {
            const props = f.properties || {};
            const area = props.cod_area || props.COD_AREA || 'OUTROS';
            const category = props.categoria || props.CATEGORIA || 'N/A';

            if (state.activeFilters.area !== 'ALL' && area !== state.activeFilters.area) {
                return false;
            }

            if (state.activeFilters.category !== 'ALL' && category !== state.activeFilters.category) {
                return false;
            }
            
            if (state.activeFilters.lote !== 'ALL') {
                const filterLote = String(state.activeFilters.lote).trim().toUpperCase();
                const featLote = String(props._lote_resolvido || '').trim().toUpperCase();
                if (featLote !== filterLote) return false;
            }

            return true;
        });

        targetFeatures.forEach(f => {
            const st = f.properties._status_simplificado || 'Não Informado';
            counts[st] = (counts[st] || 0) + 1;
        });

        Object.keys(CONFIG.statusColors).forEach(stKey => {
            const cfg = CONFIG.statusColors[stKey];
            const cnt = counts[stKey] || 0;

            const item = document.createElement('div');
            item.className = 'status-item';
            
            const isChecked = state.activeFilters.statuses.has(stKey);

            item.innerHTML = `
                <div class="status-label" title="${cfg.desc || ''}">
                    <input type="checkbox" data-status="${stKey}" ${isChecked ? 'checked' : ''}>
                    <span class="status-dot" style="background:${cfg.color}; border:1px solid ${cfg.border}"></span>
                    <span>${cfg.label}</span>
                </div>
                <span class="status-count">${cnt.toLocaleString('pt-BR')}</span>
            `;

            item.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) {
                    state.activeFilters.statuses.add(stKey);
                } else {
                    state.activeFilters.statuses.delete(stKey);
                }
                processAndRenderGeoJSON();
                updateStatistics();
            });

            container.appendChild(item);
        });
    }

    /**
     * Renderiza a Legenda Flutuante no Mapa (Cores de Status e Categorias)
     */
    function renderMapLegend() {
        const container = document.getElementById('legendContainer');
        if (!container) return;
        container.innerHTML = '';

        // Status dos Domicílios
        Object.keys(CONFIG.statusColors).forEach(stKey => {
            const cfg = CONFIG.statusColors[stKey];
            const row = document.createElement('div');
            row.className = 'legend-row';
            row.title = cfg.desc || '';
            row.innerHTML = `
                <div class="legend-box" style="background:${cfg.color}; border:1px solid ${cfg.border}; opacity:${cfg.opacity !== undefined ? cfg.opacity : 1}"></div>
                <span>${cfg.label}</span>
            `;
            container.appendChild(row);
        });

        // Separador para categorias
        const sep = document.createElement('div');
        sep.style.cssText = 'border-top:1px dashed rgba(255,255,255,0.15); margin:6px 0; padding-top:4px; font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;';
        sep.textContent = 'Outras Categorias';
        container.appendChild(sep);

        // Categorias não-domiciliares
        Object.keys(CONFIG.categoryColors).forEach(catKey => {
            const cfg = CONFIG.categoryColors[catKey];
            const row = document.createElement('div');
            row.className = 'legend-row';
            row.innerHTML = `
                <div class="legend-box" style="background:${cfg.color}; border:1px solid ${cfg.border}; opacity:${cfg.opacity !== undefined ? cfg.opacity : 1}"></div>
                <span>${cfg.label}</span>
            `;
            container.appendChild(row);
        });
    }

    /**
     * 5. Painel de Estatísticas — base de cálculo: apenas Domicílios
     */
    function updateStatistics() {
        const features = state.filteredFeatures || (state.rawGeoJSON ? state.rawGeoJSON.features : []);
        // Base de porcentagem: apenas domicílios
        const domicilioFeatures = features.filter(f => {
            const cat = f.properties.categoria || f.properties.CATEGORIA || 'Domicílio';
            return cat === 'Domicílio';
        });
        const total = domicilioFeatures.length;

        // Identifica área e lote ativos
        const selectedAreaCode = state.activeFilters.area;
        const selectedLote = state.activeFilters.lote;

        let areaDisplayName = 'Todas as Áreas (Consolidado)';
        if (selectedAreaCode !== 'ALL') {
            const areaNameFound = state.csvCodeToAreaNameMap.get(selectedAreaCode) || CONFIG.areaNames[selectedAreaCode] || selectedAreaCode;
            areaDisplayName = `${areaNameFound} (${selectedAreaCode})`;
        }
        
        const areaBadge = document.getElementById('statsModalAreaName');
        const loteBadge = document.getElementById('statsModalLoteName');
        const filterBanner = document.getElementById('statsFilterBanner');
        const filterBannerText = document.getElementById('statsFilterBannerText');

        // Determina o lote associado à seleção
        let resolvedLote = selectedLote;
        if (selectedAreaCode !== 'ALL' && (!resolvedLote || resolvedLote === 'ALL')) {
            resolvedLote = state.areaToLoteMap.get(selectedAreaCode) || 'ALL';
        }

        if (selectedAreaCode !== 'ALL') {
            // Favela específica
            if (areaBadge) areaBadge.textContent = areaDisplayName;

            if (resolvedLote && resolvedLote !== 'ALL') {
                const loteFmt = String(resolvedLote).trim().toLowerCase().startsWith('lote') ? resolvedLote : `Lote ${resolvedLote}`;
                if (loteBadge) {
                    loteBadge.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${loteFmt}`;
                    loteBadge.style.display = 'inline-flex';
                }
                if (filterBanner && filterBannerText) {
                    filterBanner.style.display = 'flex';
                    filterBannerText.innerHTML = `Exibindo indicadores da favela <strong>${areaDisplayName}</strong> (pertencente ao <strong>${loteFmt}</strong>).`;
                }
            } else {
                if (loteBadge) loteBadge.style.display = 'none';
                if (filterBanner && filterBannerText) {
                    filterBanner.style.display = 'flex';
                    filterBannerText.innerHTML = `Exibindo indicadores da favela <strong>${areaDisplayName}</strong>.`;
                }
            }
        } else if (resolvedLote && resolvedLote !== 'ALL') {
            // Visão consolidada de todas as favelas do lote
            const loteFmt = String(resolvedLote).trim().toLowerCase().startsWith('lote') ? resolvedLote : `Lote ${resolvedLote}`;
            if (areaBadge) areaBadge.textContent = `Favelas do ${loteFmt} (Consolidado)`;
            if (loteBadge) {
                loteBadge.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${loteFmt}`;
                loteBadge.style.display = 'inline-flex';
            }
            if (filterBanner && filterBannerText) {
                filterBanner.style.display = 'flex';
                filterBannerText.innerHTML = `Exibindo indicadores consolidados de todas as favelas pertencentes ao <strong>${loteFmt}</strong>.`;
            }
        } else {
            // Visão consolidada geral de todas as áreas
            if (areaBadge) areaBadge.textContent = 'Todas as Áreas (Consolidado)';
            if (loteBadge) loteBadge.style.display = 'none';
            if (filterBanner) filterBanner.style.display = 'none';
        }

        const counts = {
            'Imóvel Selado': 0,
            'Frente De Obras': 0,
            'Removido': 0,
            'Em Tratativas': 0,
            'Resistente': 0,
            'Não Informado': 0
        };

        const groupCounts = {};

        // Contabiliza apenas domicílios nos KPIs e agrupa por favela
        domicilioFeatures.forEach(f => {
            const st = f.properties._status_simplificado || 'Não Informado';
            counts[st] = (counts[st] || 0) + 1;

            const area = f.properties.cod_area || f.properties.COD_AREA || 'OUTROS';
            if (!groupCounts[area]) {
                groupCounts[area] = { 'Imóvel Selado': 0, 'Frente De Obras': 0, 'Removido': 0, 'Em Tratativas': 0, 'Resistente': 0, 'Não Informado': 0 };
            }
            if (groupCounts[area][st] !== undefined) {
                groupCounts[area][st]++;
            }
        });

        // KPI total: mostra total de domicílios (base) e o total geral entre parênteses
        const totalGeral = features.length;
        const kpiTotalEl = document.getElementById('kpiTotal');
        if (kpiTotalEl) kpiTotalEl.textContent = total.toLocaleString('pt-BR');
        const kpiTotalDesc = document.getElementById('kpiTotalEdif') || (kpiTotalEl ? kpiTotalEl.closest('.kpi-card').querySelector('.kpi-percent') : null);
        if (kpiTotalDesc) kpiTotalDesc.textContent = `${totalGeral.toLocaleString('pt-BR')} edificações no total`;
        
        const updateKpiCard = (valId, pctId, key) => {
            const count = counts[key] || 0;
            const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
            const elVal = document.getElementById(valId);
            const elPct = document.getElementById(pctId);
            if (elVal) elVal.textContent = count.toLocaleString('pt-BR');
            if (elPct) elPct.textContent = `${pct}% do total`;
        };

        updateKpiCard('kpiSelado', 'kpiSeladoPct', 'Imóvel Selado');
        updateKpiCard('kpiObras', 'kpiObrasPct', 'Frente De Obras');
        updateKpiCard('kpiRemovido', 'kpiRemovidoPct', 'Removido');
        updateKpiCard('kpiTratativas', 'kpiTratativasPct', 'Em Tratativas');
        updateKpiCard('kpiResistente', 'kpiResistentePct', 'Resistente');

        renderDonutChart(counts, total);
        renderBarChartArea(groupCounts, resolvedLote !== 'ALL' ? resolvedLote : null, selectedAreaCode !== 'ALL' ? areaDisplayName : null);
    }

    function renderDonutChart(counts, total) {
        const ctx = document.getElementById('donutChart').getContext('2d');

        const labels = ['Imóvel Selado', 'Frente de Obras', 'Removido', 'Em Tratativas', 'Resistente', 'Sem Status'];
        const dataValues = [
            counts['Imóvel Selado'] || 0,
            counts['Frente De Obras'] || 0,
            counts['Removido'] || 0,
            counts['Em Tratativas'] || 0,
            counts['Resistente'] || 0,
            counts['Não Informado'] || 0
        ];
        const colors = [
            CONFIG.statusColors['Imóvel Selado'].color,
            CONFIG.statusColors['Frente De Obras'].color,
            CONFIG.statusColors['Removido'].color,
            CONFIG.statusColors['Em Tratativas'].color,
            CONFIG.statusColors['Resistente'].color,
            CONFIG.statusColors['Não Informado'].color
        ];

        if (state.charts.donut) {
            state.charts.donut.destroy();
        }

        state.charts.donut = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: dataValues,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: '#0f172a'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#f8fafc', font: { family: 'Inter', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const val = context.raw;
                                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                                return ` ${context.label}: ${val} (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: '65%'
            }
        });
    }

    function renderBarChartArea(groupCounts, activeLote = null, activeAreaName = null) {
        const ctx = document.getElementById('barChartArea').getContext('2d');
        const keys = Object.keys(groupCounts);

        const barCardTitle = document.querySelector('.chart-card:nth-child(2) h3');
        if (activeAreaName) {
            if (barCardTitle) barCardTitle.innerHTML = `<i class="fa-solid fa-chart-bar"></i> Distribuição de Status — ${activeAreaName}`;
        } else if (activeLote) {
            const loteFmt = String(activeLote).trim().toLowerCase().startsWith('lote') ? activeLote : `Lote ${activeLote}`;
            if (barCardTitle) barCardTitle.innerHTML = `<i class="fa-solid fa-chart-bar"></i> Distribuição de Status por Favela (${loteFmt})`;
        } else {
            if (barCardTitle) barCardTitle.innerHTML = `<i class="fa-solid fa-chart-bar"></i> Distribuição de Status por Área (Favela)`;
        }

        const labels = keys.map(k => {
            const resolvedName = state.csvCodeToAreaNameMap.get(k) || CONFIG.areaNames[k] || k;
            return `${resolvedName} (${k})`;
        });

        const datasets = [
            {
                label: 'Imóvel Selado',
                data: keys.map(k => groupCounts[k]['Imóvel Selado'] || 0),
                backgroundColor: CONFIG.statusColors['Imóvel Selado'].color
            },
            {
                label: 'Frente de Obras',
                data: keys.map(k => groupCounts[k]['Frente De Obras'] || 0),
                backgroundColor: CONFIG.statusColors['Frente De Obras'].color
            },
            {
                label: 'Removido',
                data: keys.map(k => groupCounts[k]['Removido'] || 0),
                backgroundColor: CONFIG.statusColors['Removido'].color
            },
            {
                label: 'Em Tratativas',
                data: keys.map(k => groupCounts[k]['Em Tratativas'] || 0),
                backgroundColor: CONFIG.statusColors['Em Tratativas'].color
            },
            {
                label: 'Resistente',
                data: keys.map(k => groupCounts[k]['Resistente'] || 0),
                backgroundColor: CONFIG.statusColors['Resistente'].color
            }
        ];

        if (state.charts.barArea) {
            state.charts.barArea.destroy();
        }

        state.charts.barArea = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } },
                        grid: { display: false }
                    },
                    y: {
                        stacked: true,
                        ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } },
                        grid: { color: 'rgba(255,255,255,0.06)' }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#f8fafc', font: { family: 'Inter', size: 11 }, boxWidth: 12 }
                    }
                }
            }
        });
    }

    /**
     * 6. Configuração dos Eventos da Interface
     */
    function setupEventListeners() {
        const sidebar = document.getElementById('sidebar');
        const btnToggle = document.getElementById('btnToggleSidebar');
        const toggleIcon = document.getElementById('toggleIcon');

        btnToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            if (sidebar.classList.contains('collapsed')) {
                toggleIcon.className = 'fa-solid fa-chevron-right';
            } else {
                toggleIcon.className = 'fa-solid fa-chevron-left';
            }
        });

        const selectLote = document.getElementById('selectLote');
        if (selectLote) {
            selectLote.addEventListener('change', (e) => {
                state.activeFilters.lote = e.target.value;
                populateAreaFilter(state.activeFilters.lote);
                processAndRenderGeoJSON();
                renderStatusFilterList();
                updateStatistics();
            });
        }

        document.getElementById('selectArea').addEventListener('change', (e) => {
            state.activeFilters.area = e.target.value;
            // Se o usuário selecionou uma favela específica, sincroniza o lote correspondente
            if (state.activeFilters.area !== 'ALL') {
                const autoLote = state.areaToLoteMap.get(state.activeFilters.area);
                if (autoLote && autoLote !== 'N/A') {
                    state.activeFilters.lote = autoLote;
                    if (selectLote) selectLote.value = autoLote;
                }
            }
            processAndRenderGeoJSON();
            renderStatusFilterList();
            updateStatistics();
        });

        document.getElementById('selectCategory').addEventListener('change', (e) => {
            state.activeFilters.category = e.target.value;
            processAndRenderGeoJSON();
            renderStatusFilterList();
            updateStatistics();
        });

        // Toggles para as camadas adicionais
        const toggleDTS = document.getElementById('toggleLimiteDTS');
        if (toggleDTS) {
            toggleDTS.addEventListener('change', (e) => {
                if (e.target.checked && state.extraLayers.limiteDTS) {
                    if (state.extraLayersInstances.limiteDTS) {
                        state.map.removeLayer(state.extraLayersInstances.limiteDTS);
                    }
                    state.extraLayersInstances.limiteDTS = L.geoJSON(state.extraLayers.limiteDTS, {
                        style: CONFIG.extraLayers.limiteDTS.style,
                        interactive: false // Não intercepta nenhum clique/hover
                    }).addTo(state.map);
                    state.extraLayersInstances.limiteDTS.bringToBack();
                } else if (state.extraLayersInstances.limiteDTS) {
                    state.map.removeLayer(state.extraLayersInstances.limiteDTS);
                    state.extraLayersInstances.limiteDTS = null;
                }
            });
        }

        const toggleLotes = document.getElementById('toggleLotesMananciais');
        if (toggleLotes) {
            toggleLotes.addEventListener('change', (e) => {
                if (e.target.checked && state.extraLayers.lotesMananciais) {
                    if (state.extraLayersInstances.lotesMananciais) {
                        state.map.removeLayer(state.extraLayersInstances.lotesMananciais);
                    }
                    state.extraLayersInstances.lotesMananciais = L.geoJSON(state.extraLayers.lotesMananciais, {
                        style: (feature) => {
                            const code = feature.properties.Codigo || feature.properties.codigo || feature.properties.lote || '1';
                            const color = CONFIG.extraLayers.lotesMananciais.colors[code] || '#333333';
                            return {
                                ...CONFIG.extraLayers.lotesMananciais.defaultStyle,
                                color: color,
                                fillColor: color
                            };
                        },
                        onEachFeature: (feature, layer) => {
                            const p = feature.properties || {};
                            const nome = p.Name || p.name || (p.Codigo ? `Lote ${p.Codigo}` : 'Lote');
                            // Rótulo permanente no centro do lote, totalmente transparente ao mouse (sem conflito com selagem)
                            layer.bindTooltip(nome, {
                                permanent: true,
                                direction: 'center',
                                className: 'lote-map-label',
                                interactive: false
                            });
                        },
                        interactive: false // Não intercepta nenhum clique/hover do mouse
                    }).addTo(state.map);
                    state.extraLayersInstances.lotesMananciais.bringToBack();
                } else if (state.extraLayersInstances.lotesMananciais) {
                    state.map.removeLayer(state.extraLayersInstances.lotesMananciais);
                    state.extraLayersInstances.lotesMananciais = null;
                }
            });
        }

        document.getElementById('searchInput').addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            if (!query || !state.geojsonLayer) return;

            let matchLayer = null;
            state.geojsonLayer.eachLayer(layer => {
                const props = layer.feature.properties || {};
                const code = (props.cod_geral || props.COD_GERAL || '').toLowerCase();
                const selo = (props.cod_selo || props.COD_SELO || '').toLowerCase();

                if (code.includes(query) || selo.includes(query)) {
                    matchLayer = layer;
                }
            });

            if (matchLayer) {
                state.map.fitBounds(matchLayer.getBounds(), { maxZoom: 19 });
                matchLayer.fire('click');
            }
        });

        document.getElementById('btnRefresh').addEventListener('click', async () => {
            const icon = document.querySelector('#btnRefresh i');
            icon.classList.add('fa-spin');
            showToast('Re-sincronizando dados com a tabela CSV...', 'info');

            await loadCSVData(CONFIG.csvPath);
            processAndRenderGeoJSON();
            populateFilterOptions();
            updateStatistics();

            setTimeout(() => {
                icon.classList.remove('fa-spin');
                showToast(`Sincronizado! ${state.rawGeoJSON.features.length} edificações atualizadas.`, 'success');
            }, 600);
        });

        const statsModal = document.getElementById('statsModal');
        document.getElementById('btnOpenStats').addEventListener('click', () => {
            statsModal.classList.add('active');
            updateStatistics();
        });

        document.getElementById('btnCloseStats').addEventListener('click', () => {
            statsModal.classList.remove('active');
        });

        statsModal.addEventListener('click', (e) => {
            if (e.target === statsModal) {
                statsModal.classList.remove('active');
            }
        });

        // Export Modal Listeners
        const exportModal = document.getElementById('exportModal');
        document.getElementById('btnExport').addEventListener('click', () => {
            populateExportAreaSelect();
            exportModal.classList.add('active');
        });

        document.getElementById('btnCloseExport').addEventListener('click', () => {
            exportModal.classList.remove('active');
        });

        exportModal.addEventListener('click', (e) => {
            if (e.target === exportModal) {
                exportModal.classList.remove('active');
            }
        });

        document.querySelectorAll('.export-format-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.export-format-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
        });

        document.getElementById('btnConfirmExport').addEventListener('click', async () => {
            const area = document.getElementById('exportAreaSelect').value;
            const format = document.querySelector('.export-format-btn.active').dataset.format;
            exportModal.classList.remove('active');
            await generateMapExport(area, format);
        });

        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('fileInput');

        dropzone.addEventListener('click', () => fileInput.click());

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--primary)';
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = 'var(--border-accent)';
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--border-accent)';
            if (e.dataTransfer.files.length > 0) {
                handleUploadedGeoJSON(e.dataTransfer.files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleUploadedGeoJSON(e.target.files[0]);
            }
        });
    }

    async function handleUploadedGeoJSON(file) {
        const name = file.name.toLowerCase();

        if (name.endsWith('.geojson') || name.endsWith('.json')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const newGeoJSON = JSON.parse(e.target.result);
                    if (newGeoJSON.type !== 'FeatureCollection') {
                        throw new Error('Arquivo GeoJSON inválido (deve ser um FeatureCollection).');
                    }
                    applyNewFeatures(newGeoJSON, file.name);
                } catch (err) {
                    showToast('Erro ao processar o GeoJSON enviado: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        } else if (name.endsWith('.kml')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const dom = new DOMParser().parseFromString(e.target.result, 'text/xml');
                    const newGeoJSON = toGeoJSON.kml(dom);
                    applyNewFeatures(newGeoJSON, file.name);
                } catch (err) {
                    showToast('Erro ao processar o KML: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        } else if (name.endsWith('.kmz')) {
            try {
                const zip = await JSZip.loadAsync(file);
                const kmlFileName = Object.keys(zip.files).find(n => n.toLowerCase().endsWith('.kml'));
                if (!kmlFileName) throw new Error('Nenhum arquivo .kml encontrado dentro do arquivo .kmz');
                
                const kmlText = await zip.files[kmlFileName].async('string');
                const dom = new DOMParser().parseFromString(kmlText, 'text/xml');
                const newGeoJSON = toGeoJSON.kml(dom);
                applyNewFeatures(newGeoJSON, file.name);
            } catch (err) {
                showToast('Erro ao processar o KMZ: ' + err.message, 'error');
            }
        } else {
            showToast('Por favor, selecione um arquivo válido .geojson, .kml ou .kmz', 'error');
        }
    }

    function applyNewFeatures(newGeoJSON, fileName) {
        if (!newGeoJSON || !newGeoJSON.features) {
            showToast('Nenhuma feição válida foi encontrada no arquivo.', 'error');
            return;
        }

        const layerId = 'user_layer_' + Date.now();

        const uploadedLayer = L.geoJSON(newGeoJSON, {
            style: {
                color: 'var(--primary)',
                weight: 3,
                fillColor: 'var(--primary)',
                fillOpacity: 0.2
            },
            onEachFeature: (feature, layer) => {
                if (feature.properties) {
                    let popupHtml = `<div style="font-family:Inter; font-size:12px; color:var(--text-main);"><b>Atributos (${fileName})</b><br><br>`;
                    popupHtml += '<table style="width:100%; border-collapse: collapse; text-align: left;">';
                    for (let key in feature.properties) {
                        if (['styleUrl', 'styleHash', 'styleMapHash', 'stroke', 'stroke-opacity', 'stroke-width', 'fill', 'fill-opacity'].includes(key)) continue;
                        popupHtml += `<tr>
                            <td style="border-bottom:1px solid var(--border-color); padding:4px 8px 4px 0; color:var(--text-muted);"><b>${key}:</b></td>
                            <td style="border-bottom:1px solid var(--border-color); padding:4px 0 4px 8px; color:var(--text-main);">${feature.properties[key]}</td>
                        </tr>`;
                    }
                    popupHtml += '</table></div>';
                    layer.bindPopup(popupHtml, { maxWidth: 400 });
                }
            }
        }).addTo(state.map);
        
        state.map.fitBounds(uploadedLayer.getBounds(), { maxZoom: 18 });
        
        state.userLayers.push({
            id: layerId,
            name: fileName,
            layer: uploadedLayer,
            visible: true
        });

        renderUserLayersList();
        showToast(`Nova camada "${fileName}" carregada com ${newGeoJSON.features.length} feições!`, 'success');
    }

    function renderUserLayersList() {
        const container = document.getElementById('userLayersContainer');
        if (!container) return;
        
        container.innerHTML = '';
        
        state.userLayers.forEach(ul => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.background = '#1e293b';
            row.style.padding = '8px';
            row.style.borderRadius = '6px';
            row.style.border = '1px solid #334155';
            
            const left = document.createElement('div');
            left.style.display = 'flex';
            left.style.alignItems = 'center';
            left.style.gap = '8px';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = ul.visible;
            checkbox.style.cursor = 'pointer';
            
            checkbox.addEventListener('change', (e) => {
                ul.visible = e.target.checked;
                if (ul.visible) {
                    ul.layer.addTo(state.map);
                } else {
                    state.map.removeLayer(ul.layer);
                }
            });
            
            const label = document.createElement('span');
            label.textContent = ul.name;
            label.style.fontSize = '12px';
            label.style.color = '#e2e8f0';
            label.style.whiteSpace = 'nowrap';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.maxWidth = '180px';
            
            left.appendChild(checkbox);
            left.appendChild(label);
            
            const btnRemove = document.createElement('button');
            btnRemove.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            btnRemove.style.background = 'none';
            btnRemove.style.border = 'none';
            btnRemove.style.color = '#ef4444';
            btnRemove.style.cursor = 'pointer';
            btnRemove.title = 'Remover camada';
            
            btnRemove.addEventListener('click', () => {
                if (state.map.hasLayer(ul.layer)) {
                    state.map.removeLayer(ul.layer);
                }
                state.userLayers = state.userLayers.filter(item => item.id !== ul.id);
                renderUserLayersList();
            });
            
            row.appendChild(left);
            row.appendChild(btnRemove);
            container.appendChild(row);
        });
    }

    function showToast(msg, type = 'info') {
        const toast = document.getElementById('toast');
        const toastMsg = document.getElementById('toastMessage');
        toastMsg.textContent = msg;

        toast.className = 'toast show';
        if (type === 'success') toast.style.borderColor = '#00b894';
        if (type === 'error') toast.style.borderColor = '#ff7675';
        if (type === 'info') toast.style.borderColor = '#38bdf8';

        setTimeout(() => {
            toast.className = 'toast';
        }, 4000);
    }

    function populateExportAreaSelect() {
        const dest = document.getElementById('exportAreaSelect');
        if (!dest || !state.rawGeoJSON) return;
        dest.innerHTML = '';

        const areas = new Map(); // areaCode => { name, lote }

        state.rawGeoJSON.features.forEach(f => {
            const props = f.properties || {};
            const code = props.cod_area || props.COD_AREA;
            if (code) {
                const cleanCode = String(code).trim();
                if (!areas.has(cleanCode)) {
                    const name = props._nome_area_resolvido || resolveAreaName(props);
                    const lote = props._lote_resolvido || state.areaToLoteMap.get(cleanCode) || '';
                    const loteFmt = (lote && lote !== 'N/A' && lote !== '-') 
                        ? (String(lote).toLowerCase().startsWith('lote') ? lote : `Lote ${lote}`) 
                        : '';
                    areas.set(cleanCode, { name, lote: loteFmt });
                }
            }
        });

        // Ordena por lote e depois por nome
        const sorted = [...areas.entries()].sort((a, b) => {
            if (a[1].lote && b[1].lote && a[1].lote !== b[1].lote) {
                return a[1].lote.localeCompare(b[1].lote, undefined, { numeric: true });
            }
            return a[1].name.localeCompare(b[1].name);
        });

        sorted.forEach(([code, data]) => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = data.lote ? `[${data.lote}] ${data.name} (${code})` : `${data.name} (${code})`;
            dest.appendChild(opt);
        });

        // Pré-seleciona a área ativa atual se for específica
        if (state.activeFilters.area && state.activeFilters.area !== 'ALL' && areas.has(state.activeFilters.area)) {
            dest.value = state.activeFilters.area;
        } else if (dest.options.length > 0) {
            dest.selectedIndex = 0;
        }
    }

    async function generateMapExport(areaCode, format) {
        if (!areaCode) {
            const selectEl = document.getElementById('exportAreaSelect');
            areaCode = selectEl ? selectEl.value : '';
        }

        if (!areaCode) {
            showToast('Por favor, selecione uma favela para exportar.', 'error');
            return;
        }

        showToast('Preparando mapa em alta definição...', 'info');
        
        // 1. Filtrar mapa para a área selecionada
        const selectArea = document.getElementById('selectArea');
        selectArea.value = areaCode;
        selectArea.dispatchEvent(new Event('change'));
        
        // Força sincronização de dimensões no Leaflet
        state.map.invalidateSize(true);

        // Aguarda processamento do filtro e GeoJSON
        await new Promise(r => setTimeout(r, 600));

        // Ajusta o zoom com precisão nos limites da favela (sem animação para manter o transform alinhado)
        if (state.geojsonLayer) {
            try {
                const bounds = state.geojsonLayer.getBounds();
                if (bounds.isValid()) {
                    state.map.fitBounds(bounds, { padding: [35, 35], maxZoom: 18, animate: false });
                }
            } catch (e) { /* continua */ }
        }

        state.map.invalidateSize(true);

        // Aguarda os tiles do satélite e o canvas do Leaflet renderizarem perfeitamente
        await new Promise(r => setTimeout(r, 2400));

        // 2. Extrair dados estatísticos da área selecionada
        const areaFeatures = state.rawGeoJSON ? state.rawGeoJSON.features.filter(f => {
            const props = f.properties || {};
            const a = props.cod_area || props.COD_AREA;
            return String(a).trim().toUpperCase() === String(areaCode).trim().toUpperCase();
        }) : [];

        const totalEdificacoes = areaFeatures.length;
        const domicilioFeatures = areaFeatures.filter(f => {
            const cat = f.properties.categoria || f.properties.CATEGORIA || 'Domicílio';
            return cat === 'Domicílio';
        });
        const totalDomicilios = domicilioFeatures.length;
        const totalNaoDomiciliares = totalEdificacoes - totalDomicilios;

        // Contagem de status dos domicílios
        const statusCounts = {
            'Imóvel Selado': 0,
            'Frente De Obras': 0,
            'Removido': 0,
            'Em Tratativas': 0,
            'Resistente': 0,
            'Não Informado': 0
        };
        domicilioFeatures.forEach(f => {
            const st = f.properties._status_simplificado || 'Não Informado';
            statusCounts[st] = (statusCounts[st] || 0) + 1;
        });

        // Contagem por categoria / uso do solo
        const categoryCounts = {};
        areaFeatures.forEach(f => {
            const cat = f.properties.categoria || f.properties.CATEGORIA || 'Domicílio';
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });

        const areaName = state.csvCodeToAreaNameMap.get(areaCode) || CONFIG.areaNames[areaCode] || areaCode;

        // 3. Montar HTML das listas e legendas
        let statusListHtml = '';
        Object.keys(CONFIG.statusColors).forEach(stKey => {
            const cfg = CONFIG.statusColors[stKey];
            const count = statusCounts[stKey] || 0;
            const pct = totalDomicilios > 0 ? ((count / totalDomicilios) * 100).toFixed(1) : '0';
            const borderStyle = (cfg.color === '#ffffff' || cfg.color === '#ffff00') ? 'border: 2px solid #64748b;' : `border: 1px solid ${cfg.border};`;
            
            statusListHtml += `
                <div class="print-status-row">
                    <div class="print-status-header">
                        <div class="print-status-label">
                            <span class="print-status-dot" style="background:${cfg.color}; ${borderStyle}"></span>
                            <span>${cfg.label}</span>
                        </div>
                        <div style="font-weight:700;">${count.toLocaleString('pt-BR')} <span style="font-weight:500; font-size:14px; color:#567F84;">(${pct}%)</span></div>
                    </div>
                    <div class="print-progress-track">
                        <div class="print-progress-fill" style="width:${pct}%; background:${cfg.color}; ${borderStyle}"></div>
                    </div>
                </div>
            `;
        });

        let catListHtml = '';
        Object.keys(CONFIG.categoryColors).forEach(catKey => {
            const count = categoryCounts[catKey] || 0;
            if (count > 0 || catKey === 'Domicílio') {
                const catCfg = CONFIG.categoryColors[catKey] || { color: '#00b894', border: '#00a383' };
                catListHtml += `
                    <div class="print-cat-item">
                        <div class="print-cat-item-left">
                            <span class="print-cat-swatch" style="background:${catCfg.color}; border: 1px solid ${catCfg.border};"></span>
                            <span>${catKey}</span>
                        </div>
                        <span class="print-cat-val">${count.toLocaleString('pt-BR')}</span>
                    </div>
                `;
            }
        });

        let legendItemsHtml = '';
        Object.keys(CONFIG.statusColors).forEach(stKey => {
            const cfg = CONFIG.statusColors[stKey];
            const borderStyle = (cfg.color === '#ffffff' || cfg.color === '#ffff00') ? 'border: 2px solid #475569;' : `border: 1px solid ${cfg.border};`;
            legendItemsHtml += `
                <div class="print-legend-item">
                    <span class="print-legend-swatch" style="background:${cfg.color}; ${borderStyle}"></span>
                    <span>${cfg.label}</span>
                </div>
            `;
        });

        const domPct = totalEdificacoes > 0 ? ((totalDomicilios / totalEdificacoes) * 100).toFixed(0) : '0';
        const naoDomPct = totalEdificacoes > 0 ? ((totalNaoDomiciliares / totalEdificacoes) * 100).toFixed(0) : '0';

        // 4. Injetar Seção Inferior Horizontal Completa
        const bottomContainer = document.getElementById('print-bottom-container');
        bottomContainer.innerHTML = `
            <!-- COLUNA 1: RESUMO & KPIS -->
            <div class="print-col print-col-1">
                <div class="print-card-title">
                    <span>Resumo Geral</span>
                    <span class="badge">${areaName}</span>
                </div>
                <div class="print-kpi-stack">
                    <div class="print-kpi-box main-kpi">
                        <div>
                            <div class="print-kpi-label">Edificações</div>
                            <div class="print-kpi-sub">Total Mapeado</div>
                        </div>
                        <div class="print-kpi-val">${totalEdificacoes.toLocaleString('pt-BR')}</div>
                    </div>
                    <div class="print-kpi-box">
                        <div>
                            <div class="print-kpi-label">Domicílios</div>
                            <div class="print-kpi-sub">${domPct}% do total</div>
                        </div>
                        <div class="print-kpi-val">${totalDomicilios.toLocaleString('pt-BR')}</div>
                    </div>
                    <div class="print-kpi-box">
                        <div>
                            <div class="print-kpi-label">Outros Usos</div>
                            <div class="print-kpi-sub">${naoDomPct}% não-domiciliar</div>
                        </div>
                        <div class="print-kpi-val">${totalNaoDomiciliares.toLocaleString('pt-BR')}</div>
                    </div>
                </div>
            </div>

            <!-- COLUNA 2: STATUS SIMPLIFICADO -->
            <div class="print-col print-col-2">
                <div class="print-card-title">
                    <span>Status Simplificado (Domicílios)</span>
                    <span style="font-size:14px; font-weight:600; color:#567F84;">${totalDomicilios} Domicílios</span>
                </div>
                <div class="print-status-list">
                    ${statusListHtml}
                </div>
            </div>

            <!-- COLUNA 3: USOS DO SOLO & LEGENDA CARTOGRÁFICA -->
            <div class="print-col print-col-3">
                <div class="print-card-title">
                    <span>Usos & Categorias</span>
                </div>
                <div class="print-cat-grid">
                    ${catListHtml}
                </div>

                <div class="print-card-title" style="margin-top: 6px; font-size: 16px; margin-bottom: 6px; padding-bottom: 4px;">
                    <span>Legenda Cartográfica</span>
                </div>
                <div class="print-legend-grid">
                    ${legendItemsHtml}
                </div>
            </div>
        `;

        // 5. Capturar Mapa em Alta Resolução (Scale: 2 para máxima nitidez)
        const mapEl = document.getElementById('map');
        let mapCanvas;
        try {
            mapCanvas = await html2canvas(mapEl, {
                useCORS: true,
                allowTaint: false,
                scale: 2,
                logging: false,
                ignoreElements: (node) => node.classList && (
                    node.classList.contains('leaflet-control-container') ||
                    node.classList.contains('map-legend') ||
                    node.classList.contains('update-info-badge') ||
                    node.classList.contains('sidebar') ||
                    node.classList.contains('toast') ||
                    node.classList.contains('modal-overlay')
                )
            });
        } catch (err) {
            console.error('[Exportar Mapa] Falha ao capturar canvas do Leaflet:', err);
            showToast('Erro ao capturar mapa. Tente novamente.', 'error');
            return;
        }

        // 6. Preencher Layout Oculto e Capturar Documento A4
        const printLayout = document.getElementById('print-layout');
        const printTitle = document.getElementById('print-title');
        const printDate = document.getElementById('print-date');
        const mapContainer = document.getElementById('print-map-container');

        printTitle.textContent = `Geoportal Urbanístico — ${areaName}`;
        printDate.textContent = `Atualizado em: ${CONFIG.lastUpdate ? CONFIG.lastUpdate.date : new Date().toLocaleDateString('pt-BR')}`;

        mapContainer.innerHTML = '';
        mapCanvas.style.width = '100%';
        mapCanvas.style.height = '100%';
        mapCanvas.style.objectFit = 'cover';
        mapContainer.appendChild(mapCanvas);

        printLayout.style.display = 'flex';

        try {
            const finalCanvas = await html2canvas(printLayout, {
                useCORS: true,
                scale: 1,
                width: 2970,
                height: 2100,
                logging: false
            });

            printLayout.style.display = 'none';
            mapContainer.innerHTML = ''; // Libera memória

            const safeFileName = `Mapa_${areaName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

            if (format === 'png') {
                const link = document.createElement('a');
                link.download = `${safeFileName}.png`;
                link.href = finalCanvas.toDataURL('image/png');
                link.click();
                showToast(`Download de "${safeFileName}.png" concluído!`, 'success');
            } else if (format === 'pdf') {
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF({
                    orientation: 'landscape',
                    unit: 'mm',
                    format: 'a4'
                });
                const pdfW = pdf.internal.pageSize.getWidth();
                const pdfH = pdf.internal.pageSize.getHeight();
                pdf.addImage(finalCanvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, pdfW, pdfH);
                pdf.save(`${safeFileName}.pdf`);
                showToast(`Download de "${safeFileName}.pdf" concluído!`, 'success');
            }

        } catch (err) {
            console.error('[Exportar Final] Erro ao gerar documento:', err);
            printLayout.style.display = 'none';
            mapContainer.innerHTML = '';
            showToast('Erro ao compor o documento para exportação.', 'error');
        }
    }
});
