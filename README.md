# A medias · Frontend Next.js

Frontend independiente para gestionar gastos compartidos desde el móvil o el ordenador. No depende de Vento ni hace llamadas a Vento. Es una nueva implementación en Next.js, no el HTML de la versión anterior renombrado.

## Alcance de este ZIP

Incluye Next.js con App Router, React, TypeScript, CSS responsive, componentes, cliente HTTP, validación de respuestas, pruebas y documentación para conectar un backend Java con Spring Boot.

**No incluye el backend Java, una base de datos, un servicio de usuarios ni una IA ejecutándose.** Los endpoints descritos son un contrato propuesto que debes implementar o adaptar en Spring Boot. No se han comprobado contra tu servidor real, porque todavía no se ha proporcionado.

### Funciones

- Capturar una foto desde el móvil o seleccionar un JPG, PNG o WebP de hasta 8 MB.
- Vista previa de la foto, sin enviarla automáticamente ni guardarla en el historial.
- Lectura IA bajo demanda a través del backend, nunca directamente desde el navegador.
- Desglose editable de productos, casillas para incluirlos o excluirlos y altas/bajas manuales.
- Selector por producto: compartido o 100 % para Adela o Martín.
- Descuentos como líneas negativas. Los importes son totales de línea, no precios unitarios.
- Pareja con identidades fijas Adela (`adela`) y Martín (`martin`); reparto igual o proporcional con pesos enteros positivos.
- Cálculos en céntimos, con distribución exacta del redondeo.
- Historial mensual, detalle de productos, eliminación confirmada y exportación JSON.
- Registro de quién sube cada ticket y quién ha pagado la compra. Se recuerda al registrador en este navegador.
- Subtotales compartidos e individuales y gasto por persona en el historial.
- Saldo neto pendiente entre ambos y casilla reversible «Pagado / Bizum hecho» en cada ticket.
- Filtro por moneda. EUR, USD y GBP; no se mezclan ni se convierten monedas.
- Modo demo explícito y modo API con pantalla de acceso por token Bearer.

## Productos compartidos e individuales

En cada línea, **¿Para quién?** permite elegir **Compartido** o **Solo [nombre]**. Los productos nuevos y los leídos de un ticket empiezan como compartidos; la IA no decide de quién son. Puedes cambiar la asignación durante la revisión.

- **Compartido**: se reparte a partes iguales o según los pesos elegidos.
- **Solo [nombre]**: se carga el 100 % a esa persona, sin aplicar pesos.
- **Casilla desmarcada**: se excluye de todos los totales, aunque conserve su propietario para cuando se vuelva a incluir.
- El resumen distingue subtotal compartido, individual y total seleccionado. La cuota final de cada persona suma su parte común y sus productos personales.
- Los descuentos pueden asignarse de la misma forma. No se permite guardar si dejan una cuota final negativa.
- Los nombres e identificadores de la pareja son constantes entre tickets; no se editan ni se eliminan desde el formulario. Puedes ajustar los pesos de reparto.

Ejemplo: 40 € compartidos y un producto de 10 € solo de Martín → **Adela: 20 €; Martín: 30 €**. Si Adela paga los 50 € en tienda, Martín le debe 30 €, no 25 €. Con pesos 60/40 → Adela: 24 €; Martín: 26 €. El coste propio y el dinero adelantado se muestran por separado.

La asignación se conserva en el historial y en la exportación JSON. El historial anterior sin `ownerId` sigue siendo válido: sus líneas incluidas se interpretan como compartidas.

**Cambio necesario en Spring Boot:** cada producto acepta y devuelve `ownerId`, con `null` para compartido y el id de un participante para individual. Debes persistirlo y recalcular en el backend con el algoritmo actualizado de `docs/CONTRATO-API.md`. Un backend antiguo que ignore el campo no es compatible con productos personales; el frontend rechaza una respuesta de guardado que pierda o cambie esa asignación. Si el servidor ya llegó a guardar, revisa el historial antes de repetir. El ZIP sigue sin incluir el backend Java.

Pruebas específicas de productos personales: `npm run test:e2e -- tests/e2e/ownership.spec.ts` en modo demo y `npm run test:e2e:api -- tests/e2e-api/ownership.spec.ts` con API simulada. Ambas configuraciones cubren escritorio y móvil. Las pruebas de dominio, persistencia y cliente HTTP se ejecutan con `npm test`.

## Quién registra, quién paga y cómo se liquida

Junto a «Empieza con un ticket» hay dos selectores. El primero permite elegir quién registra, Adela o Martín; se recuerda solo ese nombre en el navegador. Al cambiarlo, el pagador empieza con el mismo valor, pero puedes elegir al otro si solo estás subiendo su ticket. Esta elección no sustituye al login ni concede acceso a ninguna cuenta.

Cada ticket conserva `registeredById`, `paidById` y `settledAt`. El historial muestra total, subtotal compartido, individual y cuánto corresponde a cada persona. Todos los importes se refieren solo a los productos seleccionados. «Pagado en tienda» es el adelanto original de esos productos, no el gasto propio.

- El **gasto mensual** se filtra por mes y moneda. Suma todos los tickets, también los liquidados.
- El **saldo pendiente** compensa los importes de todos los tickets cargados sin liquidar de esa moneda, incluidos otros meses. No se calcula contando tickets ni convirtiendo monedas.
- Ejemplo: Adela adelanta 60 € compartidos y Martín 20 € compartidos. Cada uno consume 40 €; Martín debe **20 € netos a Adela**.
- Marcar **«Pagado / Bizum hecho»** confirma que el reintegro completo de ese ticket ya se realizó o quedó compensado. No abre Bizum ni transfiere dinero. Desmarcarlo devuelve su deuda al saldo pendiente.
- Si habéis pagado un saldo neto que agrupa varios tickets, marcad **todos** los tickets incluidos, también los que se compensaron en sentido contrario. No se admiten pagos parciales en esta versión.
- Liquidar cambia únicamente lo pendiente: no borra el ticket, no reduce el gasto real y no altera los productos ni las cuotas. La fecha de liquidación queda guardada.
- Los tickets antiguos sin identidad/pagador se conservan, pero no se les inventa una deuda. Se avisa y se desactiva su liquidación. Otros nombres antiguos no se asignan por posición a Adela o Martín.
- La exportación JSON usa `a-medias-expenses-v2` e incluye identidad, propietario de cada producto y liquidación.

En demo todo esto persiste en `localStorage`, únicamente en ese navegador. Para sincronizar los gastos y liquidaciones entre los dos móviles necesitas implementar y conectar el backend. El frontend exige que Spring Boot conserve las identidades al guardar y confirme la liquidación; no marca pagos solo en memoria si la API falla.

Consulta también `docs/CONTRATO-API.md`: se añade **PATCH `/api/expenses/{id}/settlement`** y se amplían los DTO de guardado y respuesta. El ZIP no contiene su implementación Java.

## Inicio rápido

Necesitas Node.js 22.12 o posterior; se recomienda Node.js 24 LTS. npm instala el frontend, no Java.

```bash
cd a-medias-next
cp .env.example .env.local
npm ci
npm run dev
```

En PowerShell, usa `Copy-Item .env.example .env.local` en lugar de `cp`.

Abre `http://localhost:3000`. El archivo de ejemplo activa la demo. Pulsa **Cargar ticket de ejemplo** o introduce productos a mano. La demo no interpreta fotos: lo indica en pantalla y no hace llamadas a una IA ni a una API.

El historial de la demo usa `localStorage`, únicamente en ese navegador y dispositivo. No se sincroniza con tu pareja, se puede borrar, no es una base de datos compartida y no tiene autenticación. No introduzcas información sensible en un equipo compartido. Exporta el JSON para conservar una copia de los gastos; no hay importación implementada.

## Conectar con Java / Spring Boot

Configura estas variables **antes de compilar**:

```dotenv
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_API_URL=https://tu-backend.onrender.com
```

`NEXT_PUBLIC_API_URL` es la base del backend **sin `/api` al final**, salvo que tu despliegue añada un prefijo de contexto delante de `/api`. No pongas la URL de Vercel ni el dominio genérico de Render. Ejemplo local: `http://localhost:8080`.

Si ejecutas la web desde el móvil, `localhost` apunta al teléfono. Para conectar con un servidor fuera del mismo dispositivo, usa una URL HTTPS accesible. El cliente rechaza HTTP no local para evitar enviar contraseñas, tokens o tickets sin cifrado.

Next.js integra las variables `NEXT_PUBLIC_*` en el bundle al compilar. Modificarlas en el proveedor exige un nuevo despliegue. No contienen secretos.

### Contrato HTTP

| Método | Ruta | Uso |
| --- | --- | --- |
| POST | `/api/auth/login` | Email/contraseña → token de acceso |
| POST | `/api/receipts/analyze` | Foto multipart, campo `image` → ticket con productos |
| GET | `/api/expenses` | Hasta 500 últimos gastos de la unidad doméstica autorizada |
| POST | `/api/expenses` | Guardar selección y reparto; cabecera `Idempotency-Key` |
| PATCH | `/api/expenses/{id}/settlement` | Marcar o desmarcar liquidación; devuelve el ticket actualizado |
| DELETE | `/api/expenses/{id}` | Eliminar un gasto autorizado |

El contrato completo, ejemplos JSON, DTO Java sugeridos y requisitos de seguridad están en [`docs/CONTRATO-API.md`](docs/CONTRATO-API.md).

El token se mantiene **solo en memoria**. Recargar o cerrar la pestaña obliga a volver a iniciar sesión en modo API. No se almacenan contraseñas ni tokens en `localStorage`; el login no usa cookies. Al cerrar sesión, caducar o recibir un 401, se retiran también el borrador, la foto y el historial de la pestaña. El backend debe validar el token y los permisos en cada petición. Dos cuentas pueden compartir hogar si el backend implementa esa relación; el frontend no la crea.

Las llamadas tienen espera máxima de 120 segundos, y 150 segundos para leer fotos. No se reintentan automáticamente, para evitar lecturas de IA duplicadas o gastos repetidos. Un fallo de red al guardar puede producir un resultado incierto: consulta el historial antes de repetir. Para un reenvío del mismo borrador, el cliente conserva la misma clave de idempotencia mientras no se modifiquen sus datos. El backend debe implementar esa garantía; una cabecera sola no evita duplicados.

El gasto se guarda solo al pulsar **Guardar gasto**, después de revisar la extracción. Una respuesta con solo comercio, fecha y total no es suficiente para los checks por producto: el lector también debe devolver `items` con su importe de línea.

### Gemini y costes

La clave del proveedor de IA pertenece **exclusivamente al backend**. Nunca crees una variable `NEXT_PUBLIC_GEMINI_API_KEY` ni pegues una clave en el código del frontend. Este proyecto no fija un modelo Gemini, no usa Vertex AI desde el navegador y no contiene código Spring AI.

El backend deberá escoger un modelo de visión vigente, validar su JSON y controlar su cuota. No se garantiza un número de peticiones gratuitas, disponibilidad de Gemini 1.5 Flash ni despliegue gratuito permanente de ningún proveedor. Configura límites, rechaza las llamadas al agotar la cuota y evita un paso automático a servicios facturables. El frontend maneja 429 y permite continuar manualmente. Ese comportamiento de UI no constituye una garantía de coste cero de tu servidor.

Antes de usar tickets reales, revisa las condiciones de privacidad del proveedor de IA. La foto puede salir de tu servidor si eliges una IA externa. Este frontend no persiste fotos, pero el backend debe aplicar su propia política de retención y no registrar imágenes o credenciales en logs.

## Desplegar el frontend en Vercel

1. Sube el contenido de `a-medias-next/` a un repositorio Git propio, sin `node_modules`, `.next` ni `.env.local`.
2. Importa el repositorio en Vercel y selecciona Next.js. Si mantienes una carpeta contenedora, elígela como Root Directory.
3. Configura Node.js 24, `NEXT_PUBLIC_DEMO_MODE=false` y `NEXT_PUBLIC_API_URL` con la URL HTTPS real de tu backend.
4. Usa la instalación `npm ci` y la compilación `npm run build`.
5. Añade en Spring Boot el **origen exacto** asignado a tu frontend. Los dominios de Preview de Vercel son distintos: autorízalos de manera explícita solo si los necesitas.
6. Comprueba login, lectura, guardado y persistencia real en tu base de datos antes de usarlo con datos personales.

Para compartir solo una demostración, despliega con `NEXT_PUBLIC_DEMO_MODE=true`; cada navegador tendrá su historial separado. Publicar una URL no instala ni crea el backend ni hace privada la demo.

Los planes, sus límites y sus costes dependen del proveedor. Este ZIP no crea cuentas, no despliega servicios y no activa suscripciones ni facturación.

## Tu propio servidor

```bash
npm ci
npm run build
npm start
```

Configura las variables públicas antes de `build`, no únicamente al arrancar. Ejecuta el proceso con tu supervisor de servicios y un proxy inverso HTTPS. El frontend usa el puerto 3000 por defecto; no expongas directamente un servidor de desarrollo a Internet.

## Pruebas

El resultado concreto de las comprobaciones de esta entrega y sus limitaciones está en [`VERIFICACION.md`](VERIFICACION.md).

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Las pruebas de navegador construyen la demo en el puerto 3100. No necesitan Java, Gemini ni una base de datos. Para comprobar el flujo autenticado contra una API **simulada**:

```bash
npm run test:e2e:api
```

Estas pruebas también compilan el frontend, ahora en modo API. No uses `test:e2e` y `test:e2e:api` simultáneamente, porque comparten `.next` y puerto. Si vas a ejecutar `npm start` después, vuelve a compilar con las variables de tu entorno real.

## Estructura

```text
src/app/                    Página, layout, metadatos, icono y estilos
src/components/             Interfaz, captura, edición, reparto e historial
src/lib/domain.ts           Tipos, schemas, importes y reparto exacto
src/lib/api.ts              Contrato HTTP y tratamiento de errores
src/lib/demo.ts             Persistencia local de demostración
docs/CONTRATO-API.md         Integración y requisitos del backend Java
tests/unit/                 Importes, reparto, validación, cliente HTTP y demo
tests/e2e/                  Flujos de navegador en modo demo
tests/e2e-api/              Flujos de navegador con backend simulado
```

El ZIP incluye el lockfile para instalaciones reproducibles. No incluye dependencias descargadas, compilaciones, fotos, tickets reales, credenciales, claves de IA ni llamadas propietarias de Vento.
