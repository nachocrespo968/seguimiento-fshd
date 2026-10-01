# NOVA Control Tower

Dashboard ejecutivo (tema oscuro, responsive) para analizar un CSV de expediciones. Funciona 100 % en el navegador: sin backend ni dependencias. Abre `index.html` o sírvelo con cualquier servidor estático.

## Qué muestra
- **OTIF global y por transportista** (objetivo 95 %). OTIF = entregado en fecha (`fecha_entrega ≤ fecha_prevista`) **y** completo (`unidades_entregadas ≥ unidades_pedidas`).
- **Retraso medio** en días de los envíos tardíos (y sobre el total).
- **Coste medio por envío**.
- **Incidencias por tipo**.
- **Tabla** ordenable y filtrable por cliente, país y transportista (los filtros afectan a todo el dashboard).
- **AI Insight**: 3 hallazgos y 3 acciones, generados por un motor de reglas local que prioriza por impacto (peor transportista/país/cliente en OTIF, sobrecoste, incidencia dominante, in-full).

## Formato del CSV
Separador `,` o `;`. Fechas `AAAA-MM-DD` o `DD/MM/AAAA`. Decimales con punto o coma.

| Columna | Obligatoria | Notas |
|---|---|---|
| `id_expedicion` | no | |
| `fecha_envio` | no | |
| `fecha_prevista` | sí | fecha comprometida |
| `fecha_entrega` | sí | vacía = pendiente (excluida de OTIF/retraso) |
| `cliente`, `pais`, `transportista` | sí | |
| `unidades_pedidas`, `unidades_entregadas` | no | sin ellas se asume entrega completa |
| `coste_eur` | no | |
| `incidencia` | no | tipo; vacía = sin incidencia |

También se aceptan alias en inglés (`carrier`, `customer`, `country`, `cost`, `delivery_date`, …).

`ejemplo_expediciones.csv` contiene 420 expediciones ficticias (botón **Usar datos de ejemplo**).
