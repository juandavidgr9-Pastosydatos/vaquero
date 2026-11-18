# Vaquero - Pastos & Datos

App instalable (PWA) para el vaquero, funciona sin internet. Los datos viven solo en el equipo (IndexedDB "vaquero"); el respaldo es el Excel que descarga la app. Basada en Corral 5.2.0.

Publicada en: https://juandavidgr9-pastosydatos.github.io/vaquero/

## Pestañas
- **Inventario**: tabla por lote × categoría (VP, VS, NV, HL, CH, CM, ML, TR) con total de cada lote y de cada categoría. Botones Inicial (como se cargó el Excel) y Actual (con movimientos); lo que cambió va en color y el total muestra ± frente al inicial. Al tocar un lote se ven sus animales.
- **Buscar**: por número o chapeta con el teclado numérico. Ficha según el tipo:
  - Vacas (VP, VS, NV): básica + reproductiva (estado, días de gestación, días abiertos, #P, UIEP, detalle y fecha del último tacto) y crías al pie.
  - Toros: edad, lote, chapeta, color.
  - Crías: edad en meses y días, sexo, lote, color, madre (avisa si la madre está en otro lote).
  - Levante (HL/ML): último peso y fecha, GMD anterior, edad en meses.
  - Los comentarios de SG salen destacados y se marcan palabras clave: HUÉRFANO, DESCARTE, VENTA, ENFERMO, COJERA, MASTITIS, ABORTO, ADOPTADO, etc. (lista `CLAVES` al inicio de `app.js`).
- **Movimientos**: busca el animal, elige el lote destino (botones rápidos con los últimos lotes usados) y mueve. Si es una vaca con crías registradas (CH/CM con ese "# Madre"), **la cría se mueve siempre con la madre**. Deshacer en el aviso. Arriba, "Ver movimientos realizados": resumen origen → destino, cuántos quedan en el lote de origen y últimos movimientos con "Deshacer".
- **Conteo**: elige el lote y toca el botón grande; cada toque suena fuerte y vibra, cada 10 suena un tono doble. Muestra si coincide con el inventario actual del lote (faltan / sobran). −1, Reiniciar, Sonido sí/no. Los conteos guardados van al Excel.
- **Archivo**: subir Excel de SG (pide nombre de finca y fecha de creación del Excel, DD/MM/AAAA), descargar Excel, enviar por WhatsApp/Drive.

## Alerta de copia
Arriba aparece "⚠ N sin descargar". Cada 10 cambios y al abrir la app con cambios pendientes recuerda descargar el Excel como copia (`CFG.recordarCada` en `app.js`).

## Excel descargado
Hojas: Inventario, Movimientos (historial completo), Resumen movimientos, Inv. lote inicial, Inv. lote actual, Conteos y la hoja oculta `_respaldo` (APP_VAQUERO) para continuar en otro equipo. Vaquero no lee archivos de avance de Corral (ni al revés).

## Reglas para no chocar con Corral (mismo dominio github.io)
- Base IndexedDB "vaquero". Cachés del service worker con prefijo "vaquero-"; al actualizar solo borra las que empiezan por "vaquero-".
- Si Corral 5.2.0 borra la caché de Vaquero, Vaquero la vuelve a llenar sola la próxima vez que se abra con internet.
- Al cambiar archivos, subir el número de `CACHE` en `sw.js` (ej. `vaquero-v1.0.1`) y `VERSION` en `app.js`.

## Versión 1.0.0
- Primera versión.
