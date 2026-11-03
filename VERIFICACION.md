# Verificación · Identidades, saldos y liquidaciones

Entrega del 20 de octubre de 2026. Frontend independiente Next.js + TypeScript; no incluye implementación Java ni una conexión a Bizum.

## Comprobaciones realizadas

| Comprobación | Resultado |
| --- | --- |
| Pruebas unitarias completas | 93 superadas en 5 archivos, incluidas 27 nuevas de identidad, saldos y API de liquidación |
| TypeScript | `npm run typecheck` superado |
| ESLint | `npm run lint` superado sin avisos |
| Compilación de producción | Next.js con `npm run build -- --webpack` superada para los modos demo y API |
| Navegador en demo | 22 pruebas superadas: 11 en escritorio y 11 en móvil emulado |
| Navegador con API simulada | 6 pruebas superadas: 3 en escritorio y 3 en móvil emulado; incluye rechazo sin alterar el saldo |
| Revisión visual | Capturas de nuevo gasto e historial generadas en escritorio y móvil; historial revisado visualmente en ambos tamaños |

## Qué cubren los casos nuevos

- Identificadores estables `adela` y `martin`, nombres constantes y preferencia del registrador persistida en el navegador.
- Diferencia entre registrar un ticket y adelantar el dinero de esa compra.
- Cuotas compartidas, proporcionales, productos personales, productos excluidos, descuentos y reparto exacto de céntimos.
- Compensación monetaria de compras pagadas por cada persona; no se cuentan simplemente los tickets de uno y otro.
- Gasto mensual y saldo global de todo el historial cargado separados. Las deudas antiguas no desaparecen al cambiar el mes.
- Monedas segregadas, tickets de saldo cero y conservación de gastos anteriores sin inventar quién pagó.
- Marcar una liquidación completa, cancelarla, repetirla, deshacerla, recargar el navegador y exportar identidad, propietarios y estado.
- El gasto real, los productos y las cuotas no cambian al marcar un Bizum. El saldo pendiente sí cambia.
- En el cliente HTTP: PATCH autenticado, confirmación del estado, rechazo de respuestas que pierden identidad o cambian el ticket, ausencia de reintentos y rechazo de operaciones sin pagador/token.
- Conservación del propietario y del reparto personal en los casos de navegador de la versión anterior, adaptados a los nombres fijos.

## Cómo reproducirlo

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build -- --webpack
npx playwright install chromium
npm run test:e2e -- tests/e2e/ownership.spec.ts tests/e2e/settlements.spec.ts
npm run test:e2e:api -- tests/e2e-api/ownership.spec.ts tests/e2e-api/settlements.spec.ts
```

En este entorno se ha usado Chromium del sistema, un trabajador y un perfil temporal escribible mediante configuraciones locales de Playwright. Esas configuraciones y los artefactos de compilación no se incluyen en el ZIP. Las configuraciones normales incluidas instalan/usan el navegador de Playwright y preparan cada modo de forma independiente.

## Límites

- No se ha conectado un backend Spring Boot, base de datos, login, cámara física, proveedor de IA ni servicio de pagos reales. Las pruebas API usan respuestas simuladas del contrato documentado.
- La emulación móvil es Chromium; no acredita una prueba en Safari o en un teléfono físico.
- No se da por superada toda la suite heredada de navegador: aquí se ejecutan los casos de productos personales y los nuevos de liquidación. El ticket de ejemplo heredado declara 24,85 € pero sus líneas suman 22,85 €; la interfaz muestra esa diferencia y las pruebas nuevas usan compras manuales coherentes, sin modificar ese fixture ajeno al cambio.
- La demo solo guarda en ese navegador y no sincroniza con el móvil de la otra persona. Necesita el backend para una cuenta compartida real.
- Debes implementar el nuevo PATCH y persistir/devolver las identidades y `settledAt` en Spring Boot. Se incluye el contrato y los DTO orientativos, no código Java ejecutable.
- Una liquidación es total por ticket. No hay pagos parciales. Si pagáis un saldo neto que agrupa varios tickets, debéis marcar todos los incluidos en esa compensación.
- El saldo abarca el historial cargado de la moneda elegida, actualmente hasta 500 gastos. No es un agregado ilimitado de una base de datos.
- Una marca manual no demuestra ni ejecuta un Bizum. El servidor debe autorizar por hogar y conservar auditoría del actor autenticado.
- Se conservan las versiones de dependencias y el lockfile del ZIP anterior. No se ha realizado una nueva auditoría de seguridad de dependencias.
