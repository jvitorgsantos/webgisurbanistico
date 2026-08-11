/**
 * Configuração Central do Geoportal WebGIS
 * Edificações Seladas e Intervenções Urbanísticas em Favelas de SP
 */

const CONFIG = {
    title: "GEOPORTAL - SELAGEM HABITACIONAL",
    subtitle: "Cobrape / Projeto Urbanístico - Favelas de São Paulo",
    
    // Informações da última atualização
    lastUpdate: {
        date: "11/08/2026",
        description: "Novas áreas: Chácara Flórida, Guaicuri e Alto da Alegria"
    },

    // Caminhos padrão dos arquivos na pasta
    geojsonPath: "./base_selagem.geojson",
    csvPath: "./Status_Simplificado_v1.csv",
    
    // Chave primária para o cruzamento de dados (Join)
    joinKey: "COD_GERAL",
    
    // Configurações de Mapeamento de Cores e Opacidades Padrão
    statusColors: {
        "Imóvel Selado": {
            color: "#ffffff",       // Branco
            border: "#94a3b8",
            opacity: 0.50,          // 50%
            label: "Imóvel Selado",
            desc: "Imóveis identificados na selagem fora da frente de obras prioritária",
            badgeClass: "badge-selado"
        },
        "Frente De Obras": {
            color: "#484848",       // Cinza
            border: "#1e293b",
            opacity: 1.00,          // 100%
            label: "Frente de Obras",
            desc: "Imóveis localizados em frente de obras, sem tratativas em andamento",
            badgeClass: "badge-obras"
        },
        "Removido": {
            color: "#349a1a",       // Verde
            border: "#1e6e0f",
            opacity: 1.00,          // 100%
            label: "Removido",
            desc: "Imóveis removidos cujas famílias já foram atendidas",
            badgeClass: "badge-removido"
        },
        "Em Tratativas": {
            color: "#ffff00",       // Amarelo
            border: "#b2b200",
            opacity: 1.00,          // 100%
            label: "Em Tratativas",
            desc: "Imóveis cujas famílias estão em tratativas com a Equipe Social",
            badgeClass: "badge-tratativas"
        },
        "Resistente": {
            color: "#f91313",       // Vermelho
            border: "#900000",
            opacity: 1.00,          // 100%
            label: "Resistente",
            desc: "Imóveis cujas famílias não aceitam os atendimentos ofertados",
            badgeClass: "badge-resistente"
        },
        "Não Informado": {
            color: "transparent",   // Sem preenchimento
            border: "#000000",      // Contorno preto
            opacity: 0,             // 0%
            label: "Sem Status / Não Informado",
            desc: "Imóveis sem informação de status simplificado cadastrada",
            badgeClass: "badge-indefinido"
        }
    },

    // Cores por Categoria (para feições não-domiciliares)
    categoryColors: {
        "Garagem": {
            color: "#f39c12",   // Laranja
            border: "#b7770d",
            opacity: 0.85,
            label: "Garagem"
        },
        "Anexo": {
            color: "#9b59b6",   // Roxo
            border: "#6c3483",
            opacity: 0.85,
            label: "Anexo"
        },
        "Construção": {
            color: "#1abc9c",   // Verde-água
            border: "#148f77",
            opacity: 0.85,
            label: "Construção"
        },
        "Imóvel Vazio": {
            color: "#3498db",   // Azul
            border: "#1a6fa8",
            opacity: 0.85,
            label: "Imóvel Vazio"
        },
        "Terreno Vazio": {
            color: "#795548",   // Marrom
            border: "#4e342e",
            opacity: 0.85,
            label: "Terreno Vazio"
        }
    },

    // Nomes oficiais das Áreas (Favelas)
    areaNames: {
        "CDV": "Costa do Valado",
        "ENL": "Enlevo",
        "JA2": "Jardim Ângela II",
        "JAR": "Jararaú",
        "JMV": "João Manoel Vaz",
        "LNL": "Lar Novo Lar",
        "VDJ": "Vila Dom José"
    },

    // Três Mapas de Fundo (Base Maps)
    baseMaps: [
        {
            id: "satellite",
            name: "Satélite HD (Google)",
            url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
            attribution: "&copy; Google",
            maxZoom: 20
        },
        {
            id: "light",
            name: "Mapa Vetorial Claro (Positron)",
            url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
            maxZoom: 20
        },
        {
            id: "dark",
            name: "Mapa Escuro (Dark Matter)",
            url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
            attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
            maxZoom: 20
        }
    ],

    // Estilos das Camadas Adicionais
    extraLayers: {
        limiteDTS: {
            path: "./limite_dts_extremosul.geojson",
            style: {
                color: "#00ffff", // Ciano
                weight: 4,
                dashArray: "10, 10",
                fillOpacity: 0
            }
        },
        lotesMananciais: {
            path: "./lotes_mananciais.geojson",
            colors: {
                "1": "#66c2a5",
                "2": "#fc8d62",
                "3": "#8da0cb",
                "4": "#e78ac3",
                "5": "#a6d854",
                "6": "#ffd92f",
                "7": "#e5c494",
                "8": "#b3b3b3"
            },
            defaultStyle: {
                weight: 2,
                fillOpacity: 0.1
            }
        }
    }
};
