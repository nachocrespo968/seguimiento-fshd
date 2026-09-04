# seguimiento-fshd

## Planos catastrales georreferenciados

En `parcelas/` hay una herramienta web para generar planos de fincas rústicas
georreferenciados:

1. Escribe una o varias **referencias catastrales**, o sube uno o varios
   archivos **GML del Catastro** (esquema INSPIRE, descargados desde la Sede
   Electrónica del Catastro) como alternativa manual.
2. La herramienta obtiene el GML de cada referencia (vía `api/catastro.js`,
   una función serverless de Vercel que hace de proxy al WFS del Catastro,
   necesaria porque ese servicio no permite llamadas directas desde el
   navegador por CORS), lo parsea, extrae la referencia catastral y la
   superficie de cada parcela, y reproyecta la geometría de ETRS89/UTM
   (EPSG:25828-25831) a WGS84 con `proj4js`.
3. Las parcelas se dibujan con `Leaflet` sobre la ortofoto oficial **PNOA** del
   Instituto Geográfico Nacional (servicio WMS), con OpenStreetMap como capa
   base alternativa.
4. El resultado se puede imprimir o exportar a PDF (con cajetín, escala
   gráfica y listado de parcelas) y el listado de parcelas se puede exportar
   a CSV.
5. Opcionalmente ("Mostrar parcelas colindantes", desactivado por defecto) la
   herramienta consulta también todas las parcelas catastrales que rodean a
   las cargadas (consulta espacial `BBOX` al mismo WFS, con un margen de 50 m)
   y las dibuja en otro color, sin incluirlas en el listado ni en la
   superficie total — solo como referencia visual.

**Despliegue en Vercel** (recomendado): al desplegar el repo completo, Vercel
detecta automáticamente `api/catastro.js` como función serverless — no
requiere configuración adicional. La carga por referencia catastral necesita
este proxy; si la app se sirve como archivos estáticos puros (sin backend),
la carga por referencia caerá automáticamente a una llamada directa al
Catastro (que puede fallar por CORS) y conviene usar la alternativa de subir
el GML manualmente.

Requiere conexión a internet para consultar el Catastro y cargar la ortofoto
del IGN; el resto del procesado ocurre en el navegador.