# Tropicargo — Contabilidad integrada

Sistema web que sustituye al libro `TROPICARGO_Contabilidad_Integrada.xlsx`. Se registran las operaciones (movimientos de caja y bancos, facturas, facturas de proveedores, devengos, asientos) y de ellas salen solos el **Estado de Resultados**, el **Flujo de Caja**, el **Estado de Situación**, **Capital** y **Bancos**, mes a mes y con detalle hasta cada movimiento.

La contabilidad empieza el **1 de agosto de 2026**. Todo lo anterior entra como saldo de apertura (capital de apertura 94.449,68 USD).

## Cómo funciona

- **Libro mayor de partida doble** (`lib/ledger.ts`). Cada documento genera líneas balanceadas:
  - Movimiento de caja/banco: tesorería contra la contrapartida de su categoría (cuenta de resultado si afecta el ER; si no, CxC, CxP, intercompañía, fondos de clientes, tránsito…).
  - Factura de venta (Afecta ER): CxC contra «Ingresos facturados», en la fecha de emisión.
  - Factura de proveedor: gasto de su categoría contra CxP, en la fecha de la factura. El pago es el movimiento «Pago de CxP».
  - Devengo: saca el gasto del mes de pago y lo pone en el mes al que corresponde.
  - Depreciación mensual en línea recta de los activos con costo y vida útil.
  - Saldos de apertura y asientos manuales.
- Como todo es partida doble, **el Estado de Situación cuadra siempre**. Lo que falta por aclarar se ve en «Partidas por clasificar», «Partidas en tránsito» y «Ajuste de apertura», y en la lista de pendientes del panel.
- La **categoría** decide todo: su grupo del ER, su grupo de flujo y su contrapartida en el balance se configuran en *Configuración → Categorías*.

## Diferencias con el Excel (decisiones contables)

| Tema | Excel | Sistema |
| --- | --- | --- |
| Signos del ER | Mezclados (ene–jul restaba, ago–sep sumaba) | Ingresos en positivo, gastos en negativo, siempre |
| Grupo Flujo en Listados | Desfasado una fila desde «Compra de activo fijo» | Corregido (Compra/Venta de activo → Inversión; aportes, retiros y préstamos → Financiación; cambios, traspasos, depósitos → Interno) |
| Facturas de proveedores | Solo algunas categorías iban al ER | Todas van al ER en su fecha; el pago se registra como «Pago de CxP» (por eso sep tiene −4.440 en Gastos bancarios y ago −150,84 en Otros gastos) |
| Square | ES con 3.486 a mano; Bancos en 0 | El detalle de Square no se importa: sus liquidaciones ya están en Truist como «Cobro cliente» |
| Intercompañía | Vínculos a otros libros | Saldos de apertura como asientos manuales; los movimientos «Préstamo/Deuda Kaluch/Nextplus» mueven la cuenta |
| Categorías fuera del catálogo | «EXTERNO MOV IVAN», «Deuda Kaluch», «PAGO PROVEEDOR NO AFECTA ER»… | Añadidas al catálogo con su contrapartida |
| Pago Tarjeta de Crédito | Costo de ventas | Movimiento interno (las compras ya están en la tarjeta) |
| CUP sin tasa | `#VALUE!` | Se usa la tasa vigente más reciente; aviso de tasas sin confirmar |

La página **Importar** muestra la comparación completa con los totales del Excel.

## Roles

- **Administrador**: todo, incluidos usuarios, importación, cierre de meses y catálogo.
- **Contador**: registra y corrige todo (menos usuarios, importación y catálogo).
- **Cajero**: solo ve y registra movimientos en las cajas que se le asignen.
- **Solo lectura**: ve informes y registros.

Los meses cerrados solo los puede modificar el administrador. Todo cambio queda en *Auditoría*.

## Almacenamiento

Los datos se guardan en **Vercel Blob privado** como colecciones JSON comprimidas y versionadas (`lib/store.ts`). Cada escritura crea una versión nueva y actualiza un manifiesto con control optimista (`ifMatch`), así dos usuarios que guardan a la vez no se pisan. Se conservan las 5 versiones anteriores de cada tabla como respaldo. Sin `BLOB_READ_WRITE_TOKEN` se usa la carpeta `.data/` (desarrollo).

## Desarrollo

```bash
npm install
cp .env.example .env.local   # rellena AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run dev
npm test                     # tests de la lógica contable
npm run import:excel -- TROPICARGO_Contabilidad_Integrada.xlsx   # convierte el Excel y muestra la paridad
```

## Despliegue (Vercel)

Variables de entorno: `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `BLOB_READ_WRITE_TOKEN` (se crea al conectar un Blob store privado al proyecto). El primer inicio de sesión con `ADMIN_EMAIL`/`ADMIN_PASSWORD` crea la cuenta de administrador; después se gestionan los usuarios desde la aplicación.

## PayPal (API)

«Extractos → Traer de PayPal» descarga las transacciones con la Transaction Search API y las revisa igual que un extracto.
Variables en Vercel: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` (sensibles) y `PAYPAL_ENV=live`. La app de PayPal necesita «Transaction search» activada.
Los cargos «PAYPAL *» de las tarjetas que recargan PayPal se clasifican como «Traspaso entre cajas» (reglas), y el gasto se registra del lado de PayPal.
