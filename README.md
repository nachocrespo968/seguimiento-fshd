# seguimiento-fshd

## Planos catastrales georreferenciados

En `parcelas/` hay una herramienta web independiente (sin backend, sin build) para
generar planos de fincas rústicas georreferenciados:

1. Sube uno o varios archivos **GML del Catastro** (esquema INSPIRE, descargados
   desde la Sede Electrónica del Catastro).
2. La herramienta parsea el GML en el propio navegador, extrae la referencia
   catastral y la superficie de cada parcela, y reproyecta la geometría de
   ETRS89/UTM (EPSG:25828-25831) a WGS84 con `proj4js`.
3. Las parcelas se dibujan con `Leaflet` sobre la ortofoto oficial **PNOA** del
   Instituto Geográfico Nacional (servicio WMS), con OpenStreetMap como capa
   base alternativa.
4. El resultado se puede imprimir o exportar a PDF (con cajetín, escala
   gráfica y listado de parcelas) y el listado de parcelas se puede exportar
   a CSV.

Para usarla, abre `parcelas/index.html` en un navegador (o sírvelo con
cualquier servidor estático). Requiere conexión a internet para cargar la
ortofoto del IGN; el resto del procesado ocurre localmente.