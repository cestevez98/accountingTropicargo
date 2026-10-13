# Prompt — Sistema de Contabilidad Integrada Tropicargo (Next.js + Vercel)

> Copia todo lo que está debajo de la línea y pégalo en Claude Code (o en v0 / el agente que uses) dentro del repo `accountingTropicargo`. Adjunta también el archivo `TROPICARGO_Contabilidad_Integrada.xlsx`, porque el prompt pide importarlo.

---

## Rol y objetivo

Eres un desarrollador full‑stack senior con conocimientos de contabilidad. Vas a convertir el libro Excel **TROPICARGO_Contabilidad_Integrada.xlsx** en una aplicación web multiusuario, desplegada en **Vercel**, que sustituya al Excel. La app debe reproducir exactamente la lógica del libro: se registran operaciones (facturas, caja, bancos, proveedores) y de ellas salen solos el **Estado de Resultados (ER)**, el **Estado de Situación (ES)**, el **Flujo de Efectivo (EFE)** y el **Capital**. Toda la interfaz va en **español**, la moneda base es **USD**, y también se manejan **CUP** y **EUR**.

Empresa: Tropicargo Express (logística USA ↔ Cuba, compras asistidas, remesas, mensajería). Partes relacionadas: **Kaluch** y **Nextplus**.

## Stack obligatorio

- **Next.js 15** (App Router, Server Actions, TypeScript estricto) desplegado en **Vercel**.
- **Postgres en Neon** (integración del Marketplace de Vercel) con **Drizzle ORM** y migraciones versionadas.
- **Auth.js** (o Clerk) con roles: `admin`, `contador`, `cajero` (solo registra en su caja) y `lectura`.
- **Tailwind + shadcn/ui**, **TanStack Table** para las grillas (filtro, orden, edición en línea, paginación del lado del servidor) y **Recharts** para los gráficos.
- **SheetJS (xlsx)** para importar y exportar Excel; **Zod** para validar; **Vercel Blob** para guardar los extractos subidos.
- Todo cálculo de dinero en **`numeric(14,2)`** en BD y con `decimal.js` en el código. Nunca uses float.
- Los informes se calculan con **vistas SQL o consultas agregadas** (equivalentes a los SUMIFS), no en el navegador.

## Modelo de datos (mínimo)

1. **catalogo_categorias**: `nombre`, `grupo_er` (COSTO DE VENTAS | GASTOS OPERATIVOS | GASTOS FINANCIEROS | IMPUESTOS | NO AFECTA ER), `grupo_flujo` (Explotación | Inversión | Financiación | Interno), `orden`, `activa`. **Es la pieza central**: al elegir la categoría de un movimiento, el importe cae solo en el ER y en el EFE. El grupo nunca se escribe a mano en el movimiento; se deriva siempre del catálogo.
2. **cuentas**: cajas (Caja Cuba, Caja Miami) y cuentas bancarias o tarjetas (Bank of America, Regions, PayPal, Revolut, Square, Truist, AMEX Next Plus, BOFA Next Plus), con `tipo` (caja | banco | tarjeta_credito | pasarela), `moneda`, `geografia` (USA | CUBA) y `saldo_inicial` con su fecha.
3. **tasas_cambio**: `fecha`, `cup_por_usd`, `usd_por_eur`. Para convertir se usa la tasa vigente más reciente con fecha ≤ fecha del movimiento (así funciona el XLOOKUP del Excel).
4. **movimientos** (tabla única para caja y bancos): `fecha`, `cuenta_id`, `categoria_id`, `concepto`, `referencia`, `moneda`, `entrada`, `salida`, `mov_usd` (calculado: USD = entrada − salida; CUP = (entrada − salida) / cup_por_usd; EUR = (entrada − salida) × usd_por_eur), `observaciones`, `excluir_er` (bool, para no contar dos veces), `factura_ref` (vínculo opcional a una factura INV…), `metadata jsonb` (columnas propias de cada banco: MCC, titular/tarjeta, comisión, id de transacción, hora, tipo, fecha de depósito…) y `import_batch_id`. El saldo acumulado se calcula con una window function, no se guarda.
5. **facturas_venta** (hoja Facturación, unas 4.100 filas): `numero`, `cliente`, `f_emision`, `f_vencimiento`, `monto_usd`, `cobrado_usd`, `servicio`, `tipo_envio`, `subtipo`, `detalle_guias`, `estatus_sistema`, `afecta_er` y `notas`. Campos calculados: `pendiente = monto − cobrado`, `dias_vencidos = hoy − f_vencimiento` cuando hay pendiente, y `estado` (Cobrada si pendiente ≤ 0,01 | Vencida | Vigente). Regla: `afecta_er = false` cuando el cliente es «Tropicargo Express».
6. **conciliacion_cobros**: para cada factura `INV…`, se suman los movimientos de cualquier cuenta cuyo concepto u observaciones contengan el número. El resultado es «Cuadra» (diferencia ≤ 1), «Sin referencia en el libro», «Cobro no aplicado», «Movimiento compartido — revisar» o «Descuadre X». Hazlo como vínculo explícito `movimiento ↔ factura`, con un asistente que proponga los emparejamientos que hoy se buscan por texto.
7. **facturas_compra** (hoja Proveedores) y **pagos_proveedor** (hoja Pago a Proveedores): proveedor, nº de factura, fecha, descripción, monto, categoría, pagado y pendiente. Los pagos se enlazan a la factura y a la cuenta de la que sale el dinero.
8. **cxc_manual** (cobros que no pasan por el sistema) y **cxp** (facturas de proveedores pendientes): facturado, cobrado o pagado, pendiente, días vencidos y estado.
9. **intercompania**: fecha, contraparte (Kaluch | Nextplus), concepto, débito (le debemos), crédito (nos deben) y saldo acumulado. Si el saldo neto es positivo va al activo del ES; si es negativo, al pasivo.
10. **activos_fijos**: descripción, categoría, geografía, costo USD, vida útil, depreciación acumulada (calculada en línea recta por mes) y valor neto.
11. **paquetes_abandono**: nº KGT, cliente original, descripción, fecha de llegada a Miami, valor declarado, fecha de declaración de abandono, precio de venta, fecha de venta, estado (Disponible | Vendido) y comprador. Los disponibles cuentan como inventario en el ES.
12. **devengos**: fecha de pago, origen, concepto, categoría, importe USD, mes y año al que corresponde, y notas. En el ER se **resta del mes de pago** y se **suma al mes que corresponde**.
13. **capital**: aportes y retiros por mes. Hay un aporte de apertura de **94.449,68 USD al 31‑jul‑2026**.
14. **ajustes_manuales_mes**: por ejemplo «Otros ingresos no facturados» (pasajes, remesas, carros), «Depósitos y garantías», «Impuestos por pagar» y «Ajuste de apertura».
15. **auditoria**: quién creó o cambió qué, el valor anterior y el nuevo. Además, **cierre de mes**: un mes cerrado queda bloqueado para todos salvo el admin.

## Reglas de los informes (replicar el Excel)

Todos los informes van **mes a mes (Ene–Dic) para el año que se elija** en un selector global; en el Excel es `INICIO!C4`. Muestra la columna del total del año y deja hacer clic en cualquier cifra para ver los movimientos que la forman.

**ER (Estado de Resultados)**

- **Ingresos** = facturas con `afecta_er` y `f_emision` en el mes, más «Otros ingresos no facturados» del mes.
- **Costo de ventas**: «Proveedores Logísticos USA‑Cuba» y «Proveedor Delivery» salen de **facturas_compra** (por la fecha de la factura). «Compras Asistidas», «Mensajería Cuba» y «Pago Tarjeta de Crédito» salen de los **movimientos**.
- **Gastos operativos, financieros e impuestos**: se suman los movimientos de todas las cuentas por categoría, sin contar los que tienen `excluir_er`, y se aplican los ajustes de devengo.
- La cascada de resultados es: Utilidad bruta → EBIT → Utilidad antes de impuestos → Utilidad neta, más el margen bruto y el margen neto en %.
- **Bloque de control**: total por origen (facturas de compra + caja + bancos + devengo) frente a la suma de las secciones. La diferencia **debe dar 0**. Muestra también una alerta con las salidas que tienen grupo ER pero cuya categoría no tiene fila en el ER.
- **Convención de signos única**: gastos en positivo y restados. El Excel actual mezcla signos (ver «Errores del Excel»).

**EFE (Flujo de Efectivo)**

- Saldo inicial; luego Explotación, Inversión, Financiación e Internos, cada uno sumado por la categoría del movimiento según su `grupo_flujo`.
- Variación neta y saldo final, encadenando el saldo final de un mes como saldo inicial del siguiente.
- **Comprobación**: el movimiento total de tesorería del mes menos la variación neta **debe dar 0**.

**ES (Estado de Situación) al cierre de cada mes**

- **Activo corriente**: caja Cuba y caja Miami (en USD), bancos y tarjetas (saldo acumulado de cada cuenta), CxC del sistema (pendiente de las facturas), CxC manual, CxC intercompañía, Square por liquidar e inventario de paquetes disponibles.
- **Activo no corriente**: costo de los activos fijos menos la depreciación acumulada, más depósitos y garantías.
- **Pasivo**: CxP de proveedores, CxP intercompañía e impuestos por pagar.
- **Patrimonio**: capital más aportes, resultado acumulado (la suma de la utilidad neta del ER) y ajuste de apertura.
- **CUADRE** = Activo − Pasivo − Patrimonio. **Debe dar 0**. Si no da 0, se muestra en rojo con la diferencia.

**Capital**: saldo inicial + aportes − retiros = saldo final. El resultado del mes viene de la utilidad neta del ER, y el resultado acumulado es su suma desde enero.

**Bancos**: tabla consolidada con el saldo de las 8 cuentas a fin de cada mes.

**Gastos**: vista de solo lectura que une todas las salidas de caja y bancos, con columnas origen, categoría, grupo ER, grupo flujo, USD y moneda.

**Dashboard**: KPIs del mes (ingresos, utilidad neta, margen, efectivo total, CxC vencida, CxP vencida), alertas (movimientos «Por clasificar», cuadres distintos de cero, meses sin tasa, activos sin costo) y gráficos de tendencia.

## Importación

1. **Importador inicial** del Excel completo, con un script idempotente `pnpm import:excel <archivo>`. Debe leer las tablas por su nombre (`Tabla16`, `Facturas_de_compra`, `Pagos1`, `Efectivo`, `BOFA_Mov`, `PayPal_Mov`, `Revolut_Mov`, `Square_Mov`, `EC_Regions`, `Truist_Mov`, `AMERICAN_EXPRESS_NEXT_PLUS__2`, `BOFA_NEXT_PLUS__2`, `Devengo`) y las hojas con rangos fijos (Listados, Tasas, CxCobrar, CxPagar, Intercompañía, Activos, Paq. Abandono, Capital, y las filas de entrada manual del ER y del ES). Ignora las columnas calculadas y vuelve a calcularlas. Al terminar, genera un **informe de validación** que compare los totales mensuales del ER, el ES y el EFE de la app contra los valores que tiene guardados el Excel.
2. **Importadores recurrentes** de extractos (CSV o XLSX) por banco, con un mapeo de columnas guardado para cada banco y **detección de duplicados** por fecha + importe + referencia.
3. **Reglas de autoclasificación**: si el concepto contiene un texto o el MCC coincide → se propone una categoría (por ejemplo `GOOGLE *ADS` → Comunicación y Marketing; `AMAZON` → Compras Asistidas). Lo que no encaje queda en «Por clasificar», con una bandeja para revisarlo.
4. La **subida de facturas** desde el sistema de facturación hace upsert por número de factura.
5. **Exportar** a Excel cada informe y cada tabla.

## Errores e inconsistencias del Excel que NO debes copiar (corrígelos y documéntalos)

1. **Signos del ER mezclados**: de enero a julio (C:I) se usa `Utilidad bruta = Ingresos − Costo`, y en agosto o septiembre (J/K) se usa `+`. Lo mismo pasa con el EBIT, la UAI y la utilidad neta. El costo a veces viene en negativo (de los movimientos) y a veces en positivo (`-SUMIFS` de facturas de compra). Hay que normalizarlo.
2. **Listados, columna «Grupo Flujo» desfasada una fila** desde «Compra de activo fijo»: Compra de activo fijo figura como Explotación, Aporte de capital como Inversión, Cambio de divisas como Financiación, y sobra un «Interno» en D48. Los valores correctos son: Compra y Venta de activo fijo → Inversión; Aporte, Retiro, Préstamo Kaluch y Préstamo Nextplus → Financiación; Cambio de divisas, Reembolso, Traspaso, Depósito, Anticipo, Saldo inicial y Por clasificar → Interno. **Pide confirmación al usuario** antes de fijarlo.
3. **Categorías usadas que no están en el catálogo**: «Servicio Turístico» y «Salarios» (filas del EFE), «EXTERNO MOV IVAN» (BOFA Next Plus). Añádelas o recategoriza los movimientos, pero que ninguna quede huérfana: el catálogo debe ser una FK obligatoria.
4. El **saldo inicial de Truist** no tiene grupo ER ni grupo flujo.
5. **Square**: el ES tiene 3.486 escrito a mano y en Bancos la fila de Square es 0, aunque existe `Square_Mov`. Calcúlalo desde los movimientos y registra su liquidación contra Truist como traspaso interno.
6. **Intercompañía** enlaza con libros externos (`[1]👤 Deuda KALUCH`, `[2]👤 Deuda NEXTPLUS`). Tienen que ser registros propios de la app.
7. **Doble conteo**: el ER suma la misma categoría desde Gastos, Caja y Bancos, y se apoya en marcar una «X» a mano. En la app, cada movimiento existe una sola vez. Cuando se pague una factura de compra cuyo costo ya entró por facturas_compra, el movimiento del banco se clasifica como «Pago de CxP».
8. **Devengo**: la fila del 02‑sep (EASTCP, 2.581,06) dice «corresponde a Sep» pero la nota dice agosto. Márcala para que la revisen.
9. **Tasas**: solo julio (620) y agosto (675) son reales, y el resto está fijo en 705. Muestra una alerta por cada mes sin tasa confirmada.
10. Los **pendientes de INICIO** se convierten en tareas dentro de la app: los 6 movimientos de Truist por 154.572 USD «Por clasificar», el wire de 5.000 de KGT GLOBAL en Regions, los 25 activos de Cuba sin costo y el CUADRE del ES distinto de 0 (el ER arranca en abril y la tesorería en julio, así que hace falta un ajuste de apertura).

## Entregables y criterios de aceptación

- Repo con `README` (instalación local, variables de entorno y despliegue), `drizzle/` con migraciones, `scripts/import-excel.ts`, *seed* del catálogo y **tests (Vitest)** de los cálculos: conversión de moneda, devengo, ER, EFE, ES y cuadres.
- **Test de paridad**: después de importar el Excel, cada total mensual del ER, del EFE y de Bancos coincide con el Excel con una tolerancia de ±0,01 USD. Las diferencias solo se aceptan donde se corrigió uno de los errores listados arriba, y quedan explicadas en el informe.
- El **CUADRE** del ES y los controles del ER y del EFE se ven en el dashboard.
- Despliegue en **Vercel**: Neon conectada por la integración, `DATABASE_URL` y `AUTH_SECRET` como variables de entorno, migraciones ejecutadas en el build (`drizzle-kit migrate`), *preview deployments* por PR, y un cron de Vercel para el recordatorio diario de los movimientos «Por clasificar».
- Seguridad: todas las rutas son privadas, los permisos se comprueban por rol en las server actions y hay rate‑limit en el login. Ningún dato financiero se envía a servicios de terceros.
- Responsive: el registro de caja tiene que poder usarse desde el móvil, porque los cajeros de Cuba y Miami lo harán desde el teléfono.

## Orden de trabajo

1. Esquema de BD, catálogo y autenticación. **Despliega en Vercel desde el primer día.**
2. Importador del Excel e informe de paridad.
3. Movimientos (caja y bancos) con autoclasificación, más facturas de venta y de compra.
4. Informes ER, EFE, ES, Capital y Bancos, con el drill‑down hasta los movimientos.
5. CxC, CxP, intercompañía, activos, paquetes y devengo.
6. Dashboard, alertas, cierre de mes, auditoría y exportación.

Antes de escribir código, preséntame el esquema de BD y la lista de decisiones abiertas (los puntos 2, 3, 7 y 8 de «Errores del Excel») para que los confirme.
