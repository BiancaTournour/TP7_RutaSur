# RutaSur · logística orientada a eventos

Plataforma de seguimiento de envíos en tiempo real para un operador de última milla ficticio (Programación Avanzada 2026).
Cada cambio de estado de un envío es un **evento**; los servicios reaccionan a esos eventos de forma independiente.

**Stack:** Apache Kafka (log de eventos, modo KRaft) · Node.js (servicios) · MongoDB (modelo de lectura, replica set de un nodo) · Next.js (interfaz) · Docker Compose.

## Arranque (un solo comando)

Requisitos: Docker con Compose v2.

```bash
docker compose up --build
```

Esperá ~1 minuto la primera vez (descarga de imágenes + `npm install`). Después:

| URL | Qué es |
|---|---|
| http://localhost:3000 | Torre de control (supervisor) |
| http://localhost:3000/analitica | Panel analítico (gerencia) |
| http://localhost:3000/demo | Panel de demo (botones de escenarios) |
| http://localhost:3000/tracking/ENV-000001 | Tracking público del destinatario |
| http://localhost:4000/estado | Estado del simulador |

Para empezar de cero (borra topics y colecciones): `docker compose down -v`.

## Arquitectura

Kafka es el **único punto de contacto** entre servicios: ninguno llama a otro. MongoDB guarda vistas derivadas; Next.js solo lee de ahí.

```
                          ┌──────────────┐  ┌─ proyector ───────► MongoDB (envios, alertas, notificaciones)
                          │              │  ├─ notificaciones ──► publica notificaciones.enviadas
 simulador ──────────────►│ Apache Kafka │──┼─ reprogramacion ──► publica envios.reprogramaciones
 (envios.estados,         │  6 topics    │  ├─ monitor-sla ─────► publica alertas.sla
  envios.promesas)        │              │  └─ analitica ───────► MongoDB (metricas_diarias)
                          └──────────────┘
                                                MongoDB ──(change streams + SSE)──► Next.js
```

| Servicio | Responsabilidad | Grupo de consumidores | Código |
|---|---|---|---|
| Simulador | Genera envíos, promesas y cambios de estado | no consume | `backend/src/simulator/` |
| Proyector | Mantiene `envios`, `alertas`, `notificaciones` | `proyector` | `backend/src/proyector/` |
| Notificaciones | Registra avisos ante fallos y alertas | `notificaciones` | `backend/src/notificaciones/` |
| Reprogramación | Decide el próximo intento tras un fallo | `reprogramacion` | `backend/src/reprogramacion/` |
| Monitor de SLA | Detecta envíos en riesgo y emite alertas | `monitor-sla` | `backend/src/monitor-sla/` |
| Analítica | Actualiza `metricas_diarias` | `analitica` | `backend/src/analitica/` |
| Analítica (4.º indicador) | Reprocesamiento: tiempo hub→reparto | `analitica-tiempo-hub` | `backend/src/analitica-tiempo-hub/` |
| Next.js | Torre de control, tracking, analítica, demo | no consume | `web/` |

Cada servicio es un **proceso Node.js separado** (un contenedor cada uno): se puede detener uno sin afectar a los demás.
La lógica de negocio pura (reglas, reductores de la proyección, núcleo del monitor) vive en `backend/src/common/` y está cubierta por tests.

### Catálogo de eventos

La clave de partición es siempre `shipmentId` (orden garantizado por envío). `envios.estados` tiene 3 particiones.

| Topic | Produce | Consume | Retención |
|---|---|---|---|
| `envios.estados` | Simulador | Proyector, monitor SLA, notificaciones, reprogramación, analítica | 30 días |
| `envios.promesas` | Simulador | Monitor SLA | compactado |
| `envios.reprogramaciones` | Reprogramación | Proyector | 30 días |
| `alertas.sla` | Monitor SLA | Proyector, notificaciones | 7 días |
| `notificaciones.enviadas` | Notificaciones | Proyector | 7 días |
| `envios.estados.dlq` | Cualquier consumidor | Revisión manual | 30 días |

Campos comunes: `eventId`, `shipmentId`, `tipo`, `ocurridoEn` (reloj **simulado**), `secuencia`, `hubId`, `zonaId`, `repartidorId`, `version`.
Cada consumidor valida el esquema (`backend/src/common/validacion.js`); lo inválido va a la DLQ con el motivo y el consumo continúa.

### Modelo de datos en MongoDB

| Colección | Escribe | Índices |
|---|---|---|
| `envios` (estado actual, promesa, intentos, historial embebido, última secuencia) | Proyector | `shipmentId` único; `estado+zonaId`; `promesa.venceEn` |
| `alertas` | Proyector | `estado+prioridad`; `shipmentId` |
| `notificaciones` | Proyector | `shipmentId` |
| `metricas_diarias` (incrementos atómicos) | Analítica | `fecha+zonaId+franja` único |
| `eventos_procesados` | cada consumidor | `consumidor+eventId` único; TTL 7 días |
| `monitor_sla_estado`, `tiempos_hub_estado` | monitor / analítica 4.º | respaldo de estado interno |

Cualquier colección puede borrarse y reconstruirse leyendo Kafka desde el inicio (ver "Reconstrucción").

## Casos de uso: cómo está resuelto cada uno

**CU1 · Ciclo de vida.** El proyector aplica cada evento con su marca de "procesado" **en una transacción** de MongoDB (`common/idempotencia.js › unaVez`).
Duplicado → misma `eventId`, se ignora. Fuera de orden → `secuencia` ≤ última aplicada, se descarta (`common/proyeccion.js`). Malformado → DLQ.

**CU2 · Entrega fallida.** Un `ENTREGA_FALLIDA` lo leen **tres grupos independientes**: notificaciones (publica un aviso con opciones de reprogramación),
reprogramación (publica la decisión) y analítica (incrementa `metricas_diarias`). Los `eventId` derivados son deterministas (`notif:<id>`, `repro:<id>`):
si un servicio reprocesa, el evento sale idéntico y el proyector lo descarta. Reglas (`common/reglas.js`):

| Motivo | Resultado |
|---|---|
| `AUSENTE` | Nuevo intento el día hábil siguiente, en la franja opuesta a la del fallo |
| `DIRECCION_INCORRECTA` | `RETENIDO` hasta corrección |
| `RECHAZADO` | `DEVOLUCION_COMERCIO` |
| 3.er intento fallido (cualquier motivo) | `DEVOLUCION_COMERCIO` |

**CU3 · Riesgo de SLA.** El monitor mantiene una tabla por envío (último estado + vencimiento, desde `envios.estados` y `envios.promesas`), en memoria y respaldada en `monitor_sla_estado`.
Evalúa al recibir cada evento y con un barrido periódico (un "minuto simulado" = `60000/ACELERACION` ms). Usa el **reloj simulado** que viaja en los eventos, no el de la máquina.

| Regla | Condición | Prioridad |
|---|---|---|
| `SIN_INGRESO` | faltan < 10 h y no ingresó al hub | Media |
| `SIN_SALIDA` | faltan < 4 h y no está en reparto | Alta |
| `FALLO_DIA_LIMITE` | `ENTREGA_FALLIDA` y la promesa vence hoy | Alta |
| `VENCIDO` | pasó el vencimiento sin `ENTREGADO` | Crítica |

Una regla no repite sobre el mismo envío (`emitidas` persistido). Al llegar `ENTREGADO` se emiten los cierres. Los `eventId` de alerta son deterministas (`alerta:<envío>:<regla>:ABIERTA|CERRADA`), así que tras un reinicio no se pierden ni se duplican.

**CU4 · Analítica.** Tres indicadores sobre `metricas_diarias` (tasa de entrega en primer intento por zona/franja/día; distribución de motivos por zona; cumplimiento de SLA por hub/día).
El cuarto (tiempo medio `INGRESADO_HUB → EN_REPARTO` por hub) lo calcula un **grupo nuevo** que lee `envios.estados` desde el offset 0.

## Simulador

Reemplaza a los sistemas de origen y es parte del entregable. Valores por defecto (todos configurables en `.env`, ver `.env.example`):

| Parámetro | Valor |
|---|---|
| Envíos por minuto | 20 |
| Factor de aceleración | 120 (1 h simulada = 30 s) |
| Tasa de fallo por zona | 5 % a 30 % (9 zonas en 3 hubs; la franja TARDE ×1,25) |
| Motivos | 60 % ausente · 20 % dirección · 15 % rechazo · 5 % zona |
| Demora en hub / duplicado / fuera de orden / malformado | 10 % / 2 % / 2 % / 1 % |
| Semilla | fija (`rutasur-2026`) |

Con semilla fija, el plan de cada envío depende solo de `(semilla, nº de envío)`: **la misma corrida se repite exactamente**.
Escenarios a pedido (panel de demo o `curl -X POST localhost:4000/escenarios/<nombre>`): `feliz`, `ausente`, `demorado`, `tercer-fallo`, `rafaga` (500 envíos), `malformado`.
Los escenarios comprimen tiempos y reintentos para que se vean en segundos.

## Guion de la demo (~15 min)

1. **Arranque.** `docker compose up --build` → http://localhost:3000: los contadores se mueven.
2. **Envío feliz.** Panel de demo → *Envío feliz* → abrir su tracking público y verlo llegar a `ENTREGADO`.
3. **Ausente.** *Ausente* → en el detalle del envío aparecen casi a la vez la notificación, la reprogramación y (en analítica) el incremento.
4. **Demorado.** *Demorado* → en ~15 s reales la alerta `SIN_SALIDA` (Alta) entra en la cola, antes del vencimiento.
5. **Caída de un servicio.**
   ```bash
   docker compose stop notificaciones
   docker compose run --rm tools src/tools/lag.js --watch     # el lag del grupo "notificaciones" crece
   docker compose start notificaciones                         # procesa lo pendiente sin duplicar avisos
   ```
   Mientras tanto el tracking y las alertas siguen funcionando.
6. **Evento inválido.** *Evento inválido* → `docker compose run --rm tools src/tools/ver-dlq.js` muestra el motivo; el flujo no se detuvo.
7. **Analítica.** http://localhost:3000/analitica → identificar la zona y la franja con más fallos (mejora: ofrecer franja vespertina en esa zona).
8. **Reprocesamiento.** `docker compose --profile replay up -d analitica-tiempo-hub` → un grupo nuevo lee el histórico y el 4.º indicador aparece con datos anteriores a su creación.

## Criterios de aceptación: cómo verificar cada uno

| Criterio | Cómo se verifica |
|---|---|
| Envío simulado visible en torre y tracking con estado correcto | Torre / `/tracking/<id>` tras el escenario *Envío feliz* |
| Duplicado no repite entrada en el historial | `idempotencia.js` + `proyeccion.js`; test `proyeccion.test.js`, `pipeline.test.js` |
| Fuera de orden no retrocede el estado | regla de `secuencia`; mismos tests |
| Malformado termina en la DLQ con su motivo | escenario *Evento inválido* + `ver-dlq.js` |
| `ENTREGA_FALLIDA` → exactamente 1 notificación y 1 reprogramación | `eventId` deterministas + marcas de procesado; `pipeline.test.js` |
| Cada motivo aplica su regla / tercer fallo → devolución | `reglas.test.js`; escenarios *Ausente* y *Tercer fallo* |
| Detener un servicio no afecta a los otros | paso 5 de la demo |
| Cada regla de SLA genera su alerta con su prioridad | `monitor.test.js`; escenario *Demorado* |
| Una regla no alerta dos veces / se cierra al entregar | `monitor.test.js`, `pipeline.test.js` |
| Reiniciar el monitor no pierde ni repite alertas | `docker compose restart monitor-sla` (estado en `monitor_sla_estado`, ids deterministas) |
| Los 3 indicadores coinciden con un recuento manual (semilla fija) | `docker compose run --rm tools src/tools/recuento.js` (espera lag 0 antes) |
| El 4.º indicador se completa sin reiniciar los demás | paso 8 de la demo |
| Borrar `envios` y reprocesar deja el mismo estado | ver "Reconstrucción" |
| Todo el sistema con un solo comando | `docker compose up --build` |
| Latencia evento→pantalla < 2 s | Kafka → proyector → change stream → SSE → refresco agrupado a 300 ms; verificable con el escenario *Envío feliz* |

## Operación

```bash
# lag de cada grupo (mensajes pendientes por partición)
docker compose run --rm tools src/tools/lag.js            # una vez
docker compose run --rm tools src/tools/lag.js --watch    # cada 2 s

# ver la DLQ
docker compose run --rm tools src/tools/ver-dlq.js

# recuento manual vs metricas_diarias
docker compose run --rm tools src/tools/recuento.js

# logs: cada servicio registra eventId, partición y offset
docker compose logs -f proyector
```

### Reconstrucción (borrar y reprocesar)

```bash
docker compose run --rm tools src/tools/checksum.js       # huella ANTES
docker compose stop proyector
docker compose run --rm tools src/tools/reconstruir.js    # vacía envios/alertas/notificaciones y reinicia los offsets
docker compose start proyector                            # reprocesa los topics desde el principio
docker compose run --rm tools src/tools/checksum.js       # huella DESPUÉS: debe ser idéntica
```

Es idéntica porque la proyección no usa el reloj de la máquina (solo datos del evento) y es independiente del orden de llegada entre topics (hay un test que prueba 200 intercalados distintos).
Nota: las marcas de idempotencia caducan a los 7 días (TTL); el script borra las del proyector antes de reprocesar.

## Decisiones de diseño (para la defensa)

| Decisión | Elección | Motivo | Alternativa descartada |
|---|---|---|---|
| Garantía de entrega | Al menos una vez + consumidores idempotentes | Simple y no pierde eventos | Exactamente una vez con transacciones: más complejo de lo que el caso necesita |
| Confirmación de offsets | Manual, **después** de escribir | Un fallo a mitad de proceso reintenta el evento | Automática: puede perder eventos |
| Particiones de `envios.estados` | 3 | Muestra reparto de carga y rebalanceo | 1 partición: no permite paralelismo |
| Formato | JSON + validación de esquema en cada consumidor | Legible, sin componentes extra | Avro + Schema Registry (extensión) |
| Monitor de SLA | Consumidor propio, estado en memoria respaldado en MongoDB | Lógica visible y fácil de explicar | Kafka Streams / ksqlDB (extensión) |
| Kafka en local | Un broker KRaft | Un contenedor, sin ZooKeeper | Clúster de 3 brokers |
| Tiempo real en la UI | Change streams + SSE | El frontend no depende de Kafka | Consumir Kafka desde Next.js |

Cómo se logra "al menos una vez + idempotente" según el efecto del consumidor:
- **Escribe en MongoDB** (proyector, analítica): marca + efecto en una transacción (`unaVez`).
- **Publica en Kafka** (notificaciones, reprogramación, monitor): publica con `eventId` determinista y luego marca; un reproceso emite el mismo evento y el proyector lo descarta.

## Supuestos y extensiones sobre la especificación

El PDF no define todo; estos son los criterios adoptados:

- **`ZONA_INACCESIBLE`** no tiene regla en la consigna: se trata como `AUSENTE` (el bloqueo suele ser temporal).
- **Campos extra en los eventos** (permitidos, no alteran los comunes): `intento` (1–3) en `CLASIFICADO`/`EN_REPARTO`/`ENTREGADO`/`ENTREGA_FALLIDA`; `promesaVenceEn` en `CREADO` y en los resultados (así el proyector conoce la promesa sin consumir `envios.promesas`, y la analítica calcula el cumplimiento de SLA); `motivo` en `ENTREGA_FALLIDA`.
- **Estados posteriores al fallo** (`REPROGRAMADO`, `RETENIDO`, `DEVOLUCION_COMERCIO`) no están en `envios.estados`: los publica el servicio de reprogramación en `envios.reprogramaciones` y el proyector los refleja en `envios.estado` (`secuencia` = la del fallo que los originó).
- **Franjas:** `MANANA` (< 14:00 UTC) y `TARDE`; los repartidores salen a las 09:00 y 15:00 UTC. Todo el tiempo simulado es UTC. La simulación arranca el lunes 05/01/2026 y los días hábiles son lunes a viernes.
- **Anomalías del simulador** se añaden al flujo (un duplicado es una copia extra; un malformado es un mensaje extra), así los eventos válidos no se alteran y el recuento manual es exacto.
- **DLQ:** cada consumidor que rechaza un evento inválido deja su propio rastro, por eso un malformado puede aparecer varias veces (una por consumidor, con el campo `consumidor`).
- **Monitor y `eventos_procesados`:** el monitor es idempotente por secuencia y por `eventId` determinista de alerta, así que no escribe marcas por evento.
- **Escenarios de demo** comprimen los reintentos (+1 h simulada) para verse en segundos; el flujo continuo respeta la regla del día hábil siguiente.
- **Reiniciar el simulador** repite la misma corrida (misma semilla): los eventos repetidos llegan de nuevo a Kafka y los consumidores los descartan por idempotencia. Para una corrida limpia: `docker compose down -v`.
- Fuera de alcance, como indica la consigna: GPS/mapa, optimización de rutas, autenticación, envío real de correos/SMS, nube/HA, pruebas de carga. Las extensiones opcionales no se implementaron.

## Tests

```bash
cd backend && npm install && npm test     # Node >= 20, sin necesidad de Kafka ni Mongo
```

36 tests sobre la lógica de dominio: reglas de reprogramación, validación de esquemas, reductores de la proyección (duplicados, desorden, reconstrucción idempotente),
núcleo del monitor de SLA (4 reglas, sin repetición, reloj simulado), determinismo y tasas del simulador, y un flujo completo en memoria
(simulador → validación → reprogramación → proyección → analítica → SLA).

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| La torre de control está vacía un rato | Normal al arrancar: los primeros envíos tardan unos segundos en pasar por Kafka y el proyector |
| `docker compose up` falla en `kafka-init` | El broker aún no estaba listo; repetir el comando (los topics se crean una sola vez) |
| Los servicios reinician en bucle diciendo que no encuentran Mongo | El replica set tarda ~15 s en inicializarse; esperar. Si persiste: `docker compose down -v` y volver a levantar |
| El 4.º indicador no aparece | Falta activarlo: `docker compose --profile replay up -d analitica-tiempo-hub` |
| `recuento.js` muestra diferencias | El sistema todavía procesa: esperar a que el lag sea 0 (`lag.js`) y repetir |
| Cambié `.env` y no pasa nada | `docker compose up -d simulador monitor-sla` (las variables se leen al arrancar) |

## Estructura

```
rutasur/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile · package.json
│   ├── src/
│   │   ├── common/        catálogo, validación, reglas, proyección, monitor, kafka, mongo, idempotencia
│   │   ├── simulator/     rng, planificador, servicio + API de escenarios
│   │   ├── proyector/ notificaciones/ reprogramacion/ monitor-sla/ analitica/ analitica-tiempo-hub/
│   │   └── tools/         init-topics, lag, ver-dlq, reconstruir, checksum, recuento
│   └── test/              36 tests
└── web/                   Next.js: torre, detalle, tracking, analítica, demo, SSE
```
