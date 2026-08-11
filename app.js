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
        extraLayers: {
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
            zoomControl: false
        });

        L.control.zoom({ position: 'topright' }).addTo(state.map);

        const container = document.getElementById('basemapContainer');
        container.innerHTML = '';

        CONFIG.baseMaps.forEach((bm, idx) => {
            const tileLayer = L.tileLayer(bm.url, {
                attribution: bm.attribution,
                maxZoom: bm.maxZoom
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
                        const lote = row['Lote'] || row['lote'] || row['LOTE'];

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
            
            // Pega o lote diretamente da coluna nome_lote do GeoJSON (base_selagem)
            props._lote_resolvido = props.nome_lote || props.NOME_LOTE || props.lote || props.LOTE || props.Lote || 'N/A';
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
            
            if (state.activeFilters.lote !== 'ALL' && lote !== state.activeFilters.lote) {
                return false;
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
        const lote = props.nome_lote || props.NOME_LOTE || '-';

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

        // Linha de tipo no tooltip: categoria real (nunca N/A)
        const catLabel = (cat && cat !== 'Domicílio') ? `<div style="font-size:10px; color:#475569; font-weight:600; margin-top:1px;">Categoria: ${cat}</div>` : '';

        layer.bindTooltip(`
            <div style="font-weight:700; font-size:12px;">${code}</div>
            <div style="font-size:11px; color:#1e293b; font-weight:600;">Favela/Área: ${areaName} (${areaCode})</div>
            ${catLabel}
            <div style="font-size:11px; margin-top:2px;">
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
                            <span class="popup-label">Uso / Categoria:</span>
                            <span class="popup-val">${cat}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Lote:</span>
                            <span class="popup-val">${lote}</span>
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

        const areas = new Map();
        const categories = new Set();
        const lotes = new Set();

        state.rawGeoJSON.features.forEach(f => {
            const props = f.properties || {};
            const areaCode = props.cod_area || props.COD_AREA;
            if (areaCode) {
                const name = props._nome_area_resolvido || resolveAreaName(props);
                areas.set(areaCode, name);
            }

            const cat = props.categoria || props.CATEGORIA;
            if (cat) categories.add(cat);
            
            const lote = props._lote_resolvido;
            if (lote && lote !== 'N/A') lotes.add(lote);
        });

        const selectArea = document.getElementById('selectArea');
        selectArea.innerHTML = '<option value="ALL">Todas as Áreas (Consolidado)</option>';
        areas.forEach((name, code) => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = `${name} (${code})`;
            selectArea.appendChild(opt);
        });

        const selectCat = document.getElementById('selectCategory');
        selectCat.innerHTML = '<option value="ALL">Todas as Categorias</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            selectCat.appendChild(opt);
        });

        const selectLote = document.getElementById('selectLote');
        if (selectLote) {
            selectLote.innerHTML = '<option value="ALL">Todos os Lotes</option>';
            // Ordena lotes alfabeticamente/numericamente
            [...lotes].sort((a, b) => String(a).localeCompare(String(b), undefined, {numeric: true})).forEach(l => {
                const opt = document.createElement('option');
                opt.value = l;
                opt.textContent = String(l).toLowerCase().includes('lote') ? l : `Lote ${l}`;
                selectLote.appendChild(opt);
            });
        }

        renderStatusFilterList();
        renderMapLegend();
    }

    /**
     * Renderiza a lista de Status na Barra Lateral com Quantitativos Dinâmicos por Área
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
            const lote = props._lote_resolvido || 'N/A';

            if (state.activeFilters.area !== 'ALL' && area !== state.activeFilters.area) {
                return false;
            }

            if (state.activeFilters.category !== 'ALL' && category !== state.activeFilters.category) {
                return false;
            }
            
            if (state.activeFilters.lote !== 'ALL' && lote !== state.activeFilters.lote) {
                return false;
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

    function renderMapLegend() {
        const container = document.getElementById('legendContainer');
        container.innerHTML = '';

        // Status dos domicílios
        Object.keys(CONFIG.statusColors).forEach(stKey => {
            const cfg = CONFIG.statusColors[stKey];
            const row = document.createElement('div');
            row.className = 'legend-row';
            row.title = cfg.desc || '';
            row.innerHTML = `
                <div class="legend-box" style="background:${cfg.color}; border:1px solid ${cfg.border}; opacity:${cfg.opacity}"></div>
                <span>${cfg.label}</span>
            `;
            container.appendChild(row);
        });

        // Separador
        const sep = document.createElement('div');
        sep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.1); margin:6px 0; padding-top:4px; font-size:0.7rem; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;';
        sep.textContent = 'Outras categorias';
        container.appendChild(sep);

        // Categorias não-domiciliares
        Object.keys(CONFIG.categoryColors).forEach(catKey => {
            const cfg = CONFIG.categoryColors[catKey];
            const row = document.createElement('div');
            row.className = 'legend-row';
            row.innerHTML = `
                <div class="legend-box" style="background:${cfg.color}; border:1px solid ${cfg.border}; opacity:${cfg.opacity}"></div>
                <span>${cfg.label}</span>
            `;
            container.appendChild(row);
        });
    }

    /**
     * 5. Painel de Estatísticas — base de cálculo: apenas Domicílios (excluindo garagens, anexos etc.)
     */
    function updateStatistics() {
        const features = state.filteredFeatures || (state.rawGeoJSON ? state.rawGeoJSON.features : []);
        // Base de porcentagem: apenas domicílios (imóveis selados de fato)
        const domicilioFeatures = features.filter(f => {
            const cat = f.properties.categoria || f.properties.CATEGORIA || 'Domicílio';
            return cat === 'Domicílio';
        });
        const total = domicilioFeatures.length;

        // Atualiza o nome da área no cabeçalho do Modal de Estatísticas
        const selectedAreaCode = state.activeFilters.area;
        let areaDisplayName = 'Todas as Áreas (Consolidado)';
        
        if (selectedAreaCode !== 'ALL') {
            const areaNameFound = state.csvCodeToAreaNameMap.get(selectedAreaCode) || CONFIG.areaNames[selectedAreaCode] || selectedAreaCode;
            areaDisplayName = `${areaNameFound} (${selectedAreaCode})`;
        }
        
        const areaBadge = document.getElementById('statsModalAreaName');
        if (areaBadge) {
            areaBadge.textContent = areaDisplayName;
        }

        const counts = {
            'Imóvel Selado': 0,
            'Frente De Obras': 0,
            'Removido': 0,
            'Em Tratativas': 0,
            'Resistente': 0,
            'Não Informado': 0
        };

        const areaCounts = {};

        // Contabiliza apenas domicílios nos KPIs e gráficos de status
        domicilioFeatures.forEach(f => {
            const st = f.properties._status_simplificado || 'Não Informado';
            counts[st] = (counts[st] || 0) + 1;

            const area = f.properties.cod_area || f.properties.COD_AREA || 'OUTROS';
            if (!areaCounts[area]) {
                areaCounts[area] = { 'Imóvel Selado': 0, 'Frente De Obras': 0, 'Removido': 0, 'Em Tratativas': 0, 'Resistente': 0, 'Não Informado': 0 };
            }
            if (areaCounts[area][st] !== undefined) {
                areaCounts[area][st]++;
            }
        });

        // KPI total: mostra total de domicílios (base) e o total geral entre parênteses
        const totalGeral = features.length;
        const kpiTotalEl = document.getElementById('kpiTotal');
        if (kpiTotalEl) kpiTotalEl.textContent = total.toLocaleString('pt-BR');
        const kpiTotalDesc = kpiTotalEl ? kpiTotalEl.closest('.kpi-card').querySelector('.kpi-percent') : null;
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
        renderBarChartArea(areaCounts);
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

    function renderBarChartArea(areaCounts) {
        const ctx = document.getElementById('barChartArea').getContext('2d');
        const areaCodes = Object.keys(areaCounts);

        const labels = areaCodes.map(code => {
            const resolvedName = state.csvCodeToAreaNameMap.get(code) || CONFIG.areaNames[code] || code;
            return `${resolvedName} (${code})`;
        });

        const datasets = [
            {
                label: 'Imóvel Selado',
                data: areaCodes.map(code => areaCounts[code]['Imóvel Selado']),
                backgroundColor: CONFIG.statusColors['Imóvel Selado'].color
            },
            {
                label: 'Frente de Obras',
                data: areaCodes.map(code => areaCounts[code]['Frente De Obras']),
                backgroundColor: CONFIG.statusColors['Frente De Obras'].color
            },
            {
                label: 'Removido',
                data: areaCodes.map(code => areaCounts[code]['Removido']),
                backgroundColor: CONFIG.statusColors['Removido'].color
            },
            {
                label: 'Em Tratativas',
                data: areaCodes.map(code => areaCounts[code]['Em Tratativas']),
                backgroundColor: CONFIG.statusColors['Em Tratativas'].color
            },
            {
                label: 'Resistente',
                data: areaCodes.map(code => areaCounts[code]['Resistente']),
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
                        ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    y: {
                        ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#f8fafc', font: { family: 'Inter', size: 11 } }
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

        document.getElementById('selectArea').addEventListener('change', (e) => {
            state.activeFilters.area = e.target.value;
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

        const selectLote = document.getElementById('selectLote');
        if (selectLote) {
            selectLote.addEventListener('change', (e) => {
                state.activeFilters.lote = e.target.value;
                processAndRenderGeoJSON();
                renderStatusFilterList();
                updateStatistics();
            });
        }

        // Toggles para as camadas adicionais
        let layerLimiteDTS = null;
        let layerLotesMananciais = null;

        const toggleDTS = document.getElementById('toggleLimiteDTS');
        if (toggleDTS) {
            toggleDTS.addEventListener('change', (e) => {
                if (e.target.checked && state.extraLayers.limiteDTS) {
                    layerLimiteDTS = L.geoJSON(state.extraLayers.limiteDTS, {
                        style: CONFIG.extraLayers.limiteDTS.style,
                        interactive: false // não bloqueia o mouse
                    }).addTo(state.map);
                    layerLimiteDTS.bringToBack();
                } else if (layerLimiteDTS) {
                    state.map.removeLayer(layerLimiteDTS);
                }
            });
        }

        const toggleLotes = document.getElementById('toggleLotesMananciais');
        if (toggleLotes) {
            toggleLotes.addEventListener('change', (e) => {
                if (e.target.checked && state.extraLayers.lotesMananciais) {
                    layerLotesMananciais = L.geoJSON(state.extraLayers.lotesMananciais, {
                        style: (feature) => {
                            const code = feature.properties.Codigo || feature.properties.codigo || feature.properties.lote || '1';
                            const color = CONFIG.extraLayers.lotesMananciais.colors[code] || '#333333';
                            return {
                                ...CONFIG.extraLayers.lotesMananciais.defaultStyle,
                                color: color,
                                fillColor: color
                            };
                        },
                        interactive: false // A camada de lotes serve apenas de visualização de fundo
                    }).addTo(state.map);
                    layerLotesMananciais.bringToBack();
                } else if (layerLotesMananciais) {
                    state.map.removeLayer(layerLotesMananciais);
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
});
