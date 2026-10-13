# Kaluch Accounting

Contabilidad centralizada de la cadena Kaluch Market (Casa Matriz, Almacén Central, KM 12, KM 26, San Lázaro, Ayestarán, Cerro y Tienda Web). Sustituye al libro «Operaciones KM-xx»: cada tienda sube su Excel (o se trae del TPV AxisPOS) y el sistema genera solo el **Estado de Resultados**, el **Estado de Situación**, el **Flujo de Efectivo** y **Capital**, mes a mes, por tienda o consolidado, en USD o CUP.

Diseño tomado del prototipo de Figma Make «Kaluch Accounting» (navy/esmeralda, Inter, cifras tabulares).

## Cómo funciona

- **Libro mayor de partida doble** (`lib/mayor.ts`). Cada documento genera líneas balanceadas, tienda a tienda, así que el balance cuadra siempre:
  - Movimiento de caja/banco: efectivo (por moneda o cuenta) contra la cuenta de su categoría (renglón del ER o cuenta de balance).
  - Ventas del TPV (hoja «Ventas»): ventas por depositar contra *Venta* (a la tasa de venta de la tienda, Toque + 15) e *Ingreso por tasa de cambio* (hasta la tasa Toque); costo de ventas contra inventario. Mermas y consumo interno, gasto contra inventario.
  - Compras: inventario contra proveedores; lo pagado en el exterior y los movimientos entre mercados, contra Casa Matriz. Las compras hasta el 13-jun-2026 son el inventario inicial aportado como capital (hoja Capital).
  - Cobros de ventas en caja/banco (categoría VENTAS) saldan «Ventas por depositar».
  - Impuesto sobre ventas: 11 % de lo cobrado por banco cada mes.
  - Revaluación al cierre de mes del efectivo en CUP/EUR/MLC (resultado por tenencia de moneda).
  - Al cerrar cada mes se declara como dividendo la parte del beneficio que no se reinvierte.
- La **categoría** decide todo (Catálogos → Categorías): renglón del ER, cuenta de balance y grupo del flujo.
- **Importar**: valida antes de guardar (categorías, tasa del día, duplicados, saltos de consecutivo), deja importar solo las filas válidas y se puede deshacer. Los archivos grandes (> 3,5 MB) se suben directo a Vercel Blob desde el navegador.
- **AxisPOS / AxisCloud** (`lib/axispos.ts`, SyncApi v2.1 de https://doc.axissoft.cloud/api/): token de 24 h reutilizado, GZIP detectado por los primeros bytes, estado del cuerpo comprobado aunque llegue un 200. `ExportOperations` por área (ObjectCode) con las tres marcas de agua → ventas, mermas, consumo, devoluciones, compras, cobros (opcional) y gastos/ingresos de caja (CashbookSyncs). También lee las áreas (`ImportExportLocations`) y el catálogo de mercancías (`ImportExportItems`). Se activa con la dirección del tenant y el usuario en Integraciones, `AXISPOS_PASSWORD` en Vercel y el área de cada tienda.

## Diferencias con el Excel KM-26 (ver Reportes → Comparación con el Excel)

| Renglón | Excel | Sistema |
| --- | --- | --- |
| Venta, ingreso por tasa, salarios, comunicación, consumo interno, bonos, gastos financieros | — | Coinciden al centavo |
| Costo de ventas | Líneas sin costo cuentan 0 | Se costean al costo promedio de compra |
| Merma (sep) | No suma las filas «MERMA » (con espacio) | Las suma |
| Transporte / Otros gastos | MENSAJERIA, NAVES, RRHH, PAGO ADIESTRAMIENTO… no van al ER | Van al ER |
| Nómina pagada por Casa Matriz (jun) | No va al ER | Gasto administrativo |
| Resultado por tenencia de moneda | No existe | Revaluación mensual del efectivo en CUP/EUR (desactivable) |
| Cuentas por pagar «Generales» | Cifra de cuadre (Activo − Patrimonio − …) | Cuentas reales: proveedores, Casa Matriz, impuestos, dividendos, ventas por depositar |

## Roles

Propietario, Administrador, Comercial (compras e inventario), Contador de tienda (solo su tienda), Contador fiscal (bancos fiscales y reportes) y Solo lectura. Los meses cerrados solo los modifica el propietario. Todo cambio queda en Catálogos → Auditoría.

## Desarrollo

```bash
cd kaluch
npm install
npm run dev            # sin BLOB_READ_WRITE_TOKEN los datos van a .data/
KM_XLSX=/ruta/Operaciones_KM-26.xlsx npm test   # incluye la paridad con el Excel real
npm run paridad -- /ruta/Operaciones_KM-26.xlsx
```

## Despliegue (Vercel)

Proyecto `kaluch-accounting` (Root Directory `kaluch`). Variables: `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (crean la primera cuenta de propietario), `BLOB_READ_WRITE_TOKEN` (Blob privado conectado al proyecto) y, para el TPV, `AXISPOS_PASSWORD`.

## Sincronización con AxisPOS (modo ensayo)

Cada dato tiene un dueño. Kaluch manda en el catálogo (precios por tienda y web, códigos de barras), la tasa y las compras del Almacén Central (área 1). AxisPOS manda en las ventas, las compras de los locales, los traslados del día y las cajas de los mercados.

- **Solo lectura**: mientras `AXISPOS_ESCRITURA` no valga `1`, el cliente de la API rechaza toda escritura (`guardarMonedas`, `guardarUbicaciones`, `importarOperaciones`).
- **Sincronización** (`/sincronizacion`): compara catálogo, tasa, compras al central y existencias con el TPV y enseña lo que se enviaría. No envía nada.
- **Precios por tienda**: el `PriceGroup` de cada área decide la lista. 1 es el minorista (`Price`) y del 2 al 9 son `Price1`…`Price8`. Comprobado con ventas reales: KM 26 → Price1, KM 12 → Price2, San Lázaro → Price3.
- **Cada noche** (Vercel Cron, 03:00 hora de Cuba) se llama a `/api/cron/sync` con `CRON_SECRET`. Trae las novedades del TPV y descarta lo que caiga en meses cerrados.

## Tiendas

- **Conteo a ciegas** (`/conteo`):
  - El lector de códigos funciona como teclado y no se muestra la existencia del sistema.
  - Al cerrar el conteo se compara con `ExportAvailable` del TPV, y solo administración ve el resultado.
  - Los códigos que no están en el catálogo se buscan en MiBarcode y quedan pendientes de alta en Catálogos → Productos.
- **Arqueo** (`/arqueo`):
  - Se cuenta por billetes y se lee lo último del TPV de esa tienda.
  - El esperado es el saldo de su caja en Kaluch.
  - Genera un comprobante numerado en `/imprimir/arqueo`.
- **Cuadre de cajas** (Caja y Banco → Cuadre de cajas):
  - Muestra cobrado, gastos, entregado y saldo de cada mercado.
  - Una entrega a la caja central genera dos movimientos de TRASPASO con el mismo comprobante, que se borran juntos.
- **Rol dependiente**: solo conteo y arqueo de su tienda.

## Catálogo para la web

`GET /api/web/catalogo` con `Authorization: Bearer $WEB_CATALOGO_TOKEN` devuelve:
- Por producto: código, nombre, grupo, códigos de barras, foto, descripción, precio web (costo del central + `margenWeb`) y precio de cada tienda.
- Con `?existencias=1`: lo disponible para envío (Almacén Central) y para recogida en cada local, leído del TPV.
