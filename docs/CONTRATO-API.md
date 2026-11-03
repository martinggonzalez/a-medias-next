# Contrato propuesto para el backend Spring Boot

Este documento es la especificación que consume el frontend. **No es una implementación del backend** ni afirma que ya exista. Si tus controladores usan otras rutas o DTO, adapta `src/lib/api.ts` y `src/lib/domain.ts` o implementa un adaptador en Java.

## Reglas generales

- HTTPS obligatorio fuera de localhost.
- JSON UTF-8, salvo el multipart de la foto.
- Nombres de propiedades en `camelCase`.
- Importes como enteros en céntimos: `2485` equivale a `24,85 EUR`. No uses `double` para dinero.
- Monedas admitidas: EUR, USD y GBP, todas con dos decimales. El frontend no convierte divisas.
- Fechas `YYYY-MM-DD` y `createdAt` ISO 8601 con zona, por ejemplo `2026-10-19T10:30:00Z`.
- Hasta 100 líneas; dos identidades fijas en los tickets nuevos de la pareja y compatibilidad de lectura con 2–8 participantes en datos antiguos. Nombres de producto de 120 caracteres y de persona de 60.
- Cada importe de línea admite entre -100.000.000 y +100.000.000 céntimos. Los descuentos son negativos.
- Token Bearer obligatorio en todo salvo el login. Las cuentas y hogares se crean por un mecanismo que debes implementar en el backend; no se simulan con un usuario incrustado.
- El servidor determina el hogar autorizado a partir de la identidad. Nunca confíes en un id de hogar enviado por el navegador.
- Devuelve ids únicos y persistentes, no posiciones de una lista.
- No devuelvas imágenes, prompts, claves, contraseñas ni trazas internas en respuestas o errores.

## POST /api/auth/login

```json
{ "email": "persona@example.com", "password": "introducida-por-la-persona" }
```

Respuesta 200:

```json
{ "accessToken": "token-firmado-emitido-por-tu-backend", "expiresIn": 3600 }
```

`expiresIn` está en segundos y debe estar entre 1 y 86400. El frontend guarda el token en memoria, no implementa refresh token, y descarta la sesión al caducar o recibir 401. El servidor debe aplicar caducidad, firma, emisor, audiencia y permisos según su mecanismo de autenticación. Valida la contraseña con un hash adaptativo y aplica límites de intentos; nunca almacenes contraseñas en claro.

## POST /api/receipts/analyze

Cabecera `Authorization: Bearer <accessToken>`.

Contenido `multipart/form-data`; campo **`image`** con el archivo JPEG, PNG o WebP, de hasta 8 MB. El navegador establece el `Content-Type` y el boundary automáticamente. El backend debe validar firma real del archivo, peso y dimensiones máximas de la imagen, no fiarse solo del MIME o de la extensión. Configura un límite de petición multipart ligeramente mayor que 8 MB para permitir las cabeceras y el boundary, manteniendo un límite de archivo de 8 MB.

Respuesta 200:

```json
{
  "merchant": "La despensa",
  "date": "2026-10-19",
  "currency": "EUR",
  "totalCents": 2485,
  "items": [
    { "name": "Verduras de temporada", "amountCents": 645 },
    { "name": "Pasta fresca", "amountCents": 390 },
    { "name": "Aceite de oliva", "amountCents": 795 },
    { "name": "Café molido", "amountCents": 455 }
  ],
  "warnings": []
}
```

`amountCents` es el importe final de la línea, ya teniendo en cuenta cantidad, promociones y descuentos aplicables; **no el precio unitario**. No mezcles impuestos ya incluidos como si fueran productos adicionales. Para un descuento independiente, devuelve una línea con importe negativo. No inventes precios ni fechas ilegibles: devuelve 422 si falta un dato obligatorio o pide revisión mediante `warnings` cuando pueda corregirse sin inventar datos.

`totalCents` es el total leído del ticket completo. Puede diferir de la suma de líneas y la UI avisará; el usuario revisará antes de guardar. El importe compartido se calcula solo con los productos seleccionados, no con este total original.

La extracción debe devolver productos, no únicamente un total: las casillas funcionan sobre `items`. El frontend no conoce el modelo Gemini elegido. Mantén la API key y el control de cuota en el servidor. Envía 429 al agotar el límite; no cambies a un proveedor de pago automáticamente. Limita frecuencia y concurrencia por usuario/hogar. No guardes la foto por defecto.

## POST /api/expenses

Cabeceras:

```text
Authorization: Bearer <accessToken>
Content-Type: application/json
Idempotency-Key: <uuid-de-la-operacion>
```

Solicitud:

```json
{
  "merchant": "La despensa",
  "date": "2026-10-19",
  "currency": "EUR",
  "items": [
    { "id": "line-1", "name": "Verduras de temporada", "amountCents": 645, "selected": true, "ownerId": null },
    { "id": "line-2", "name": "Pasta fresca", "amountCents": 390, "selected": true, "ownerId": null },
    { "id": "line-3", "name": "Aceite de oliva", "amountCents": 795, "selected": true, "ownerId": "adela" },
    { "id": "line-4", "name": "Café molido", "amountCents": 455, "selected": false, "ownerId": "martin" }
  ],
  "participants": [
    { "id": "adela", "name": "Adela", "weight": 50 },
    { "id": "martin", "name": "Martín", "weight": 50 }
  ],
  "splitMode": "equal",
  "registeredById": "adela",
  "paidById": "adela"
}
```

Respuesta 201, o 200 al recuperar una operación idempotente:

```json
{
  "id": "expense-1",
  "merchant": "La despensa",
  "date": "2026-10-19",
  "currency": "EUR",
  "items": [
    { "id": "line-1", "name": "Verduras de temporada", "amountCents": 645, "selected": true, "ownerId": null },
    { "id": "line-2", "name": "Pasta fresca", "amountCents": 390, "selected": true, "ownerId": null },
    { "id": "line-3", "name": "Aceite de oliva", "amountCents": 795, "selected": true, "ownerId": "adela" },
    { "id": "line-4", "name": "Café molido", "amountCents": 455, "selected": false, "ownerId": "martin" }
  ],
  "participants": [
    { "id": "adela", "name": "Adela", "weight": 50 },
    { "id": "martin", "name": "Martín", "weight": 50 }
  ],
  "splitMode": "equal",
  "totalCents": 1830,
  "shares": [
    { "participantId": "adela", "name": "Adela", "amountCents": 1313 },
    { "participantId": "martin", "name": "Martín", "amountCents": 517 }
  ],
  "createdAt": "2026-10-19T10:30:00Z",
  "registeredById": "adela",
  "paidById": "adela",
  "settledAt": null
}
```

### Validación e idempotencia

El servidor debe validar nombres, ids, límites, fecha, moneda, pesos, número de personas y líneas. No debe aceptar totales o repartos enviados por el cliente como fuente de verdad. Los ids de línea y participante se preservan en la respuesta; no son ids de usuarios ni conceden permisos. Rechaza ids duplicados y nombres de participantes iguales tras recortar espacios e ignorar mayúsculas.

Calcula `totalCents` sumando solo líneas `selected=true`, tanto compartidas como individuales, y exige que sea mayor que cero. Guarda todos los productos para mantener la revisión, incluidos los excluidos.

Cada línea tiene `ownerId`: `null` o ausente significa compartida; una cadena debe coincidir exactamente con el `id` de un elemento de `participants` y significa que esa persona asume el 100 %. Rechaza ids de propietarios desconocidos, incluso en líneas excluidas. No uses el nombre como referencia. No confundas el propietario del producto con quien adelanta el pago ni con un id de usuario autenticado.

Persiste `ownerId` como campo nullable y devuélvelo en guardado e historial, sin eliminarlo ni sustituirlo. En gastos anteriores, su ausencia equivale a `null`. El frontend comprueba tanto el reparto como la conservación de propietarios al guardar; no basta con aceptar el campo y seguir dividiendo el total de la compra. El contrato del lector IA no cambia: devuelve productos sin propietario; los asigna la persona al revisar.

Implementa idempotencia de forma transaccional con una restricción única, al menos para `(hogar autorizado, Idempotency-Key)`, más un hash canónico de la solicitud y el resultado. Misma clave y mismo cuerpo → mismo gasto; misma clave y distinto cuerpo → 409. Evita dos inserciones incluso si llegan simultáneamente. El frontend no puede garantizar por sí solo esta propiedad. Una clave nueva puede crear otro gasto; el control de idempotencia no es un detector semántico de tickets duplicados.

### Algoritmo de reparto

1. Ignora en todos los cálculos las líneas `selected=false`. Suma por separado el subtotal compartido (`ownerId=null` o ausente) y el subtotal personal de cada propietario.
2. Para repartir **solo el subtotal compartido**, en `equal` cada peso efectivo es 1; en `weighted`, usa cada `weight`, entero entre 1 y 10000. Los pesos no tienen que sumar 100.
3. Trabaja con el valor absoluto del subtotal compartido. Calcula para cada persona el cociente entero de `(abs(subtotalCompartido) × peso) / sumaPesos` y conserva el resto.
4. Reparte los céntimos que falten a los mayores restos; en empate, primero quien aparece antes en `participants`. Si el subtotal compartido era negativo por descuentos, cambia el signo de esas cuotas después de distribuir los céntimos.
5. A cada cuota compartida súmale íntegro el subtotal personal de su propietario. Los descuentos personales solo reducen el importe de esa persona; no se dividen. Si una cuota final queda negativa, rechaza el gasto con 400 y pide revisar la asignación de descuentos.
6. Devuelve `shares` **en el mismo orden que `participants`**, con ids y nombres coincidentes. Su suma debe coincidir exactamente con `totalCents`. Se admiten gastos sin productos compartidos y cuotas individuales de cero.

Ejemplos: 101 céntimos compartidos entre dos → 51 y 50; 2485 céntimos compartidos a pesos 60/40 → 1491 y 994. Si hay 4000 céntimos compartidos y 1000 solo de Ana, a partes iguales son 3000 para Ana y 2000 para Alex; con pesos 60/40, 3400 y 1600. En Java, `long` cubre los límites de este contrato y sus productos por peso; si conviertes importes decimales de la IA, usa `BigDecimal.movePointRight(2).longValueExact()`, no redondeo binario con `double`.

## GET /api/expenses

Devuelve 200 con `{"items": [...]}`, donde cada elemento tiene el esquema completo de la respuesta de guardado. Máximo 500 últimos gastos autorizados, ordenados por `createdAt` descendente. No devuelvas una lista raíz ni el formato paginado de Spring Data sin adaptarlo.

El frontend filtra por mes y moneda sobre esta ventana. No es un historial ilimitado ni obtiene automáticamente gastos anteriores a esos 500. Si necesitas más, añade paginación explícita al contrato y a la interfaz.

## Identidad y saldo pendiente de la pareja

Esta versión de la interfaz utiliza las identidades estables `adela` / Adela y `martin` / Martín. Mantén ambos ids y nombres en `participants` entre tickets, conservando su orden para los céntimos sobrantes. Se siguen admitiendo respuestas históricas sin los campos nuevos para no perder datos.

Las solicitudes nuevas incluyen `registeredById` y `paidById`; ambos son uno de esos dos ids y deben pertenecer al reparto. Persiste y devuelve ambos, junto con `settledAt: null` en un gasto nuevo. No asumas que quien registra es siempre quien ha adelantado el dinero. La foto y la IA no deciden estos campos.

Estos campos son atribución contable, **no autenticación ni autorización**. Autoriza la petición usando el token y el hogar, y conserva el actor autenticado en la auditoría del servidor. Elegir «Martín» en un selector nunca concede sus permisos.

Para un ticket pendiente, el importe a devolver al pagador es la cuota completa de la otra persona, incluidos sus productos individuales. El saldo de una persona suma lo que adelantó por el otro menos lo que el otro adelantó por ella, solo en tickets no liquidados. Un saldo positivo significa que tiene dinero por recibir; uno negativo, por pagar. Se calcula por moneda, sin mezclar divisas. Compensa céntimos, no cantidades de tickets.

Los gastos por persona (`shares`) y los totales incluyen también tickets liquidados; un Bizum no es un descuento ni otro gasto. El filtro de mes solo limita el gasto mostrado: las deudas incluyen todo el historial cargado de esa moneda (actualmente hasta 500 gastos). Si necesitas un saldo completo más allá de ese límite, implementa paginación o un agregado en el servidor antes de aumentar el volumen.

Un gasto histórico sin pagador no se atribuye por defecto al primer participante ni a quien esté usando la app. No cuenta como deuda conocida y no se puede liquidar. Un nombre antiguo reconocible puede contribuir al gasto mensual, pero eso no demuestra quién pagó.

## PATCH /api/expenses/{id}/settlement

Cabeceras: `Authorization: Bearer <accessToken>` y `Content-Type: application/json`.

```json
{ "settled": true }
```

`true` registra una liquidación completa; `false` la revierte. Exige un booleano, no una cadena. No es una orden de transferencia ni una conexión a Bizum. Comprueba el hogar autorizado y un pagador conocido, y aplica el cambio en transacción.

Devuelve **200 y el objeto `ExpenseResponse` completo** con `settledAt` en ISO-8601 (fecha del servidor) o `null` si se desmarca. No devuelvas 204 ni solo un booleano. Conserva id, fecha de creación, registrador, pagador, productos, participantes, pesos, total y cuotas sin cambios: el cliente rechaza modificaciones colaterales. La fecha del primer marcado se conserva al repetir `true`; `false` deja `null`, de modo que la operación es idempotente por estado.

La interfaz espera confirmación del servidor antes de reflejar el cambio. Si falla o caduca la sesión, no da el ticket por liquidado. Tras un corte de red puede haber resultado incierto: actualiza el historial antes de repetir; no hay reintentos automáticos. Registra una auditoría de cambios para producción y decide una política de concurrencia para dos sesiones modificando el mismo ticket.

Si una transferencia liquida el saldo neto de varios tickets, hay que marcar todos los tickets incluidos en la compensación, no solo el que adelanta dinero a favor del receptor. No se implementan importes parciales ni transferencias independientes en este contrato.

## DELETE /api/expenses/{id}

Solo para un gasto del hogar autorizado. Devuelve 204 sin cuerpo. Para no revelar recursos ajenos, la política de 403/404 debe ser coherente. El cliente pide confirmación y no hace reintentos automáticos.

## Errores

La UI no muestra el cuerpo de los errores del servidor para no filtrar detalles internos. Usa códigos HTTP adecuados:

| Estado | Caso |
| --- | --- |
| 400 | Datos inválidos |
| 401 | Login o token no válido / caducado |
| 403 | Operación no autorizada |
| 404 | Gasto no encontrado o no accesible |
| 409 | Conflicto de idempotencia |
| 413 | Imagen demasiado grande |
| 415 | Formato de imagen no admitido |
| 422 | Ticket ilegible o sin datos obligatorios fiables |
| 429 | Límite de peticiones o cuota de IA agotada |
| 502 / 503 | Servicio de lectura o backend no disponible |

No guardes un gasto a medias si la validación falla. Usa transacciones para gasto, líneas, reparto e idempotencia.

## CORS no es autenticación

Configura el origen **completo y exacto** de tu frontend, por ejemplo `https://tu-proyecto.vercel.app`, no el dominio genérico `https://vercel.app`. En desarrollo añade `http://localhost:3000` solo donde corresponda. No autorices `*` ni todos los subdominios de Vercel para una app privada.

En Spring Security, integra un `CorsConfigurationSource` con la cadena de seguridad y permite los preflight OPTIONS sin exigir token. Fragmento orientativo (necesita los imports de Spring, `java.util.List` y configuración real):

```java
@Bean
CorsConfigurationSource corsConfigurationSource(
        @Value("${app.frontend-origin}") String frontendOrigin) {
    CorsConfiguration cors = new CorsConfiguration();
    cors.setAllowedOrigins(List.of(frontendOrigin));
    cors.setAllowedMethods(List.of("GET", "POST", "PATCH", "DELETE", "OPTIONS"));
    cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key"));
    cors.setAllowCredentials(false);
    cors.setMaxAge(3600L);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/api/**", cors);
    return source;
}
```

No basta con añadir `@CrossOrigin` a un controlador si el filtro de seguridad rechaza el preflight. CORS limita ciertos accesos desde navegadores; **no impide llamadas directas con curl u otra aplicación**. Necesitas autenticación, autorización por hogar y límites de uso. `robots: noindex` del frontend tampoco protege datos.

## DTO Java sugeridos

Esquema orientativo, sin anotaciones de validación, entidades, controladores o servicios. Ajusta límites con Bean Validation y valida las invariantes también en el servicio:

```java
record LoginRequest(String email, String password) {}
record LoginResponse(String accessToken, long expiresIn) {}
record ReceiptItem(String name, long amountCents) {}
record ReceiptResponse(String merchant, LocalDate date, String currency,
        long totalCents, List<ReceiptItem> items, List<String> warnings) {}
record ExpenseItem(String id, String name, long amountCents, boolean selected, String ownerId) {}
record Participant(String id, String name, int weight) {}
record Share(String participantId, String name, long amountCents) {}
enum SplitMode { equal, weighted }
record ExpenseRequest(String merchant, LocalDate date, String currency,
        List<ExpenseItem> items, List<Participant> participants, SplitMode splitMode,
        String registeredById, String paidById) {}
record ExpenseResponse(String id, String merchant, LocalDate date, String currency,
        List<ExpenseItem> items, List<Participant> participants, SplitMode splitMode,
        long totalCents, List<Share> shares, Instant createdAt,
        String registeredById, String paidById, Instant settledAt) {}
record SettlementRequest(Boolean settled) {}
record ExpenseListResponse(List<ExpenseResponse> items) {}
```

Usa una base de datos persistente propia para el modo real. No dependas del almacenamiento efímero del contenedor de un proveedor para conservar gastos. No incluyas claves de IA, contraseñas de base de datos ni tokens de servicio en el repositorio o en variables públicas del frontend.
