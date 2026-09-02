# 2. Arquitectura general

**Documento relacionado:** [01-requisitos.md](01-requisitos.md) · [03-stack-tecnologico.md](03-stack-tecnologico.md)

---

## 2.1 Principios rectores

Cinco decisiones marcan el resto de la arquitectura. Todo lo demás se deriva de ellas.

1. **Local-first.** El cliente es la fuente de verdad durante la edición. El servidor es un punto de encuentro y un respaldo duradero, no el árbitro de cada pulsación. Esto no es una optimización: es la única forma de que RF-OFF-03 y RF-COL-01 coexistan sin dos rutas de código distintas.

2. **La sincronización no se resuelve con "último que escribe gana".** Editar sin conexión y colaborar en tiempo real son el mismo problema con distinta latencia. Se resuelve una sola vez, con un CRDT.

3. **El modelo UML es un dato estructurado y validado, no una imagen.** La IA y el reconocimiento de pizarra producen *propuestas de operaciones* sobre ese modelo, jamás lo escriben directamente.

4. **El generador consume una representación intermedia, no el documento colaborativo.** Entre el CRDT y las plantillas hay una normalización y una validación bloqueante.

5. **Todo sistema externo se aísla tras una capa anticorrupción.** Especialmente Architech Enterprise, cuyo contrato aún se desconoce.

---

## 2.2 Vista de contexto

```
                          ┌──────────────────────────┐
                          │   Architech Enterprise   │
                          │   (sistema externo)      │
                          └────────────▲─────────────┘
                                       │  contrato por definir (Q1)
                                       │  ↓ capa anticorrupción
┌───────────────┐         ┌────────────┴─────────────┐
│   Diseñador   │────────▶│   Herramienta            │
│  (navegador)  │◀────────│   colaborativa UML       │
└───────────────┘         └────────────┬─────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │  Proyecto Spring Boot    │
                          │  generado (ZIP / Git)    │
                          └──────────────────────────┘
```

---

## 2.3 Vista de contenedores

```
╔═══════════════════════ NAVEGADOR (PWA) ════════════════════════╗
║                                                                 ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │ UI React                                                   │ ║
║  │  Lienzo UML · Panel de propiedades · Chat del asistente    │ ║
║  │  Revisión de la propuesta de foto · Estado de sincronía    │ ║
║  └────────────────────────┬──────────────────────────────────┘ ║
║                           │ comandos / selectores               ║
║  ┌────────────────────────▼──────────────────────────────────┐ ║
║  │ Núcleo del modelo (documento CRDT)                         │ ║
║  │  Estado UML · Operaciones · Deshacer local · Presencia     │ ║
║  └───┬──────────────────┬──────────────────┬─────────────────┘ ║
║      │                  │                  │                    ║
║  ┌───▼────────┐  ┌──────▼───────┐  ┌───────▼──────────┐        ║
║  │ Persistencia│  │ Proveedor de │  │ Capa de IA local │        ║
║  │ IndexedDB   │  │ red (WS)     │  │ (Web Workers)    │        ║
║  └─────────────┘  └──────┬───────┘  └───────┬──────────┘        ║
║                          │                  │                    ║
║  ┌───────────────────────┴──────────────────┴──────────────┐   ║
║  │ Service Worker — App Shell, caché, Background Sync       │   ║
║  └───────────────────────┬──────────────────────────────────┘   ║
╚══════════════════════════╪══════════════════════════════════════╝
                           │ wss:// + https://
╔══════════════════════════╪═══════ NUBE ══════════════════════════╗
║  ┌───────────────────────▼──────────────────────────────────┐   ║
║  │ backend-tool (Node.js + Express)                          │   ║
║  │  api/    Rutas REST, autenticación, proyectos             │   ║
║  │  collab/ Servidor WebSocket, salas, presencia, autz       │   ║
║  │  sync/   Instantáneas, historial, resolución de arranque  │   ║
║  │  ai/     Interpretación NL→operaciones (con red)          │   ║
║  └───┬───────────────────┬────────────────────┬─────────────┘   ║
║      │                   │                    │                  ║
║  ┌───▼──────┐   ┌────────▼────────┐   ┌───────▼─────────────┐   ║
║  │PostgreSQL│   │ Almacén de      │   │ generator/          │   ║
║  │metadatos │   │ documentos      │   │ IR → validación →   │   ║
║  │+ docs    │   │ binarios (blob) │   │ plantillas → ZIP    │   ║
║  └──────────┘   └─────────────────┘   └─────────┬───────────┘   ║
║                                                  │               ║
║  ┌───────────────────────────────────────────────▼───────────┐  ║
║  │ Adaptador Architech (capa anticorrupción)                 │  ║
║  └───────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════╝
```

### Responsabilidad de cada contenedor

| Contenedor | Responsabilidad | No es responsable de |
|---|---|---|
| **UI React** | Renderizar el modelo y traducir gestos a comandos. | Contener estado de dominio propio. |
| **Núcleo del modelo** | Ser la única fuente de verdad del diagrama en el cliente. Aplicar y emitir operaciones. | Saber si hay red o no. |
| **Persistencia IndexedDB** | Durabilidad local del documento y de las operaciones pendientes. | Resolver conflictos. |
| **Proveedor de red** | Transportar operaciones entre cliente y servidor, reconectar, reintentar. | Interpretar la semántica de las operaciones. |
| **Capa de IA local** | Producir *propuestas* a partir de voz, texto o imagen. | Escribir en el modelo. |
| **Service Worker** | Servir el App Shell sin red, encolar peticiones diferidas. | Lógica de diagrama. |
| **backend-tool** | Autenticar, autorizar, retransmitir, persistir, orquestar. | Ser necesario para editar. |
| **generator** | Transformar un modelo validado en un proyecto compilable. | Conocer CRDT, WebSockets ni sesiones. |
| **Adaptador Architech** | Traducir entre el dominio propio y el externo. | Filtrar tipos externos hacia dentro. |

---

## 2.4 Modelo de datos y CRDT

### 2.4.1 El modelo de dominio

Los tipos viven en `shared/` y son la fuente única de verdad para frontend, backend y generador (RNF-MAN-04).

```ts
// shared/src/model/uml.ts

type Id = string;                       // ULID, generado en cliente

interface ClassDiagram {
  id: Id;
  name: string;
  classes: Record<Id, UmlClass>;
  relations: Record<Id, UmlRelation>;
  meta: DiagramMeta;
}

interface UmlClass {
  id: Id;
  name: string;
  kind: 'class' | 'interface' | 'enum' | 'abstract';
  attributes: Attribute[];              // orden significativo
  methods: Method[];
  literals?: string[];                  // solo kind === 'enum'
  position: { x: number; y: number };
  size: { w: number; h: number };
}

interface Attribute {
  id: Id;
  name: string;
  type: TypeRef;
  visibility: '+' | '-' | '#' | '~';
  multiplicity?: Multiplicity;
  defaultValue?: string;
  isStatic: boolean;
  isFinal: boolean;
  isIdentifier: boolean;                // marca de clave primaria
}

interface UmlRelation {
  id: Id;
  kind: 'association' | 'aggregation' | 'composition'
      | 'inheritance' | 'realization' | 'dependency';
  source: EndPoint;
  target: EndPoint;
  name?: string;
}

interface EndPoint {
  classId: Id;
  role?: string;
  multiplicity: Multiplicity;           // '1' | '0..1' | '1..*' | '*' | 'n..m'
  navigable: boolean;
}
```

Dos decisiones deliberadas:

- **`Record<Id, T>` en lugar de arrays** para clases y relaciones. Dos usuarios que insertan una clase a la vez en un array producen un conflicto de índice; en un mapa indexado por identificador, no hay conflicto posible. Los atributos sí son un array porque su orden es semántico, y ahí se usa un tipo de secuencia CRDT.
- **Los identificadores se generan en el cliente** (ULID). Un cliente sin conexión debe poder crear elementos sin pedir permiso al servidor.

### 2.4.2 Por qué un CRDT

El requisito RF-OFF-06 (convergencia) combinado con RF-COL-03/04 descarta las alternativas sencillas:

| Estrategia | Por qué no sirve |
|---|---|
| Última escritura gana por documento | Pierde el trabajo del colaborador entero. Incumple RF-COL-03. |
| Última escritura gana por campo | Reduce la pérdida pero no la elimina, y no converge con reordenaciones. |
| Bloqueo de elementos | Inviable sin conexión: no se puede pedir un bloqueo sin red. |
| Diff y merge con resolución manual | Traslada el problema al usuario. Incumple RF-OFF-05. |
| Transformación operacional (OT) | Converge, pero exige servidor autoritativo y orden global. Incompatible con edición offline prolongada. |
| **CRDT** | Converge sin coordinación central y admite desconexión arbitraria. |

**Decisión: CRDT, con biblioteca madura, no implementación propia.** Escribir un CRDT correcto es un proyecto en sí mismo; los errores de convergencia aparecen semanas después y son casi imposibles de reproducir. Ver [03-stack-tecnologico.md](03-stack-tecnologico.md#33-sincronización-y-colaboración) para la elección concreta.

### 2.4.3 Dos capas de estado

No todo el estado va al CRDT.

| Estado | Dónde vive | Persistencia |
|---|---|---|
| Clases, atributos, relaciones, posiciones | Documento CRDT | Duradera, sincronizada |
| Cursor, selección, usuario conectado | Canal de conciencia (*awareness*) | Efímera, no se persiste |
| Zoom, desplazamiento, panel abierto | Estado local de UI | `localStorage`, nunca se sincroniza |
| Propuestas de la IA pendientes de confirmar | Estado local de UI | Efímera |

Meter la selección o el zoom en el documento colaborativo es un error frecuente: genera tráfico constante, contamina el historial y hace que el deshacer de un usuario mueva la vista de otro.

---

## 2.5 Sincronización y modo offline

### 2.5.1 El principio: no hay "modo offline"

La arquitectura no distingue entre trabajar con red y sin ella. **Siempre** se escribe en el documento local y **siempre** se persiste en IndexedDB. La red es un transporte oportunista que, cuando está disponible, propaga lo mismo que ya se ha aplicado localmente.

```
Interacción del usuario
        │
        ▼
  Comando de dominio  ──▶  Documento CRDT (local, síncrono)
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              IndexedDB      Re-render UI   Proveedor de red
             (< 100 ms)                    (si hay conexión)
                                                 │
                                          ┌──────▼──────┐
                                          │  Servidor   │
                                          │  de sala    │
                                          └──────┬──────┘
                                                 │ difusión
                                          otros clientes
```

Consecuencia: el camino crítico de una edición nunca toca la red. RNF-REND-04 (50 fps) y RF-OFF-03 se cumplen por construcción, no por optimización.

### 2.5.2 Ciclo de vida de la conexión

| Estado | Qué ocurre | Indicador (RF-COL-06) |
|---|---|---|
| `online` | Operaciones enviadas y confirmadas en tiempo real. | "Sincronizado" |
| `offline` | Operaciones acumuladas localmente. Persistencia intacta. | "Sin conexión — N cambios pendientes" |
| `reconnecting` | Reintento con retroceso exponencial y *jitter*. | "Reconectando…" |
| `syncing` | Intercambio de vectores de estado y diferencias. | "Sincronizando…" |
| `synced` | Convergencia alcanzada. | "Sincronizado" |

La reconciliación al reconectar **no es una fusión manual**: se intercambia un vector de estado, cada lado calcula qué le falta al otro y se envían solo esas diferencias. No hay una pantalla de "resolver conflictos" porque el CRDT no produce conflictos irresolubles.

### 2.5.3 Estrategia de caché del Service Worker

| Recurso | Estrategia | Motivo |
|---|---|---|
| App Shell (HTML, JS, CSS) | Precache, *cache first* con revalidación | RNF-REND-02: arranque sin red en < 1 s |
| Fuentes e iconos | *Cache first*, inmutables | No cambian entre versiones |
| Modelos de IA (`.onnx`, pesos) | *Cache first*, caché aparte con expulsión propia | Son grandes; no deben desalojar el App Shell |
| Contenido de diagramas | **No pasa por el Service Worker** | Vive en IndexedDB, gestionado por el CRDT |
| Peticiones de generación | *Network only* + Background Sync | RF-OFF-09: se encolan y reintentan |
| Llamadas a la API | *Network first* con respaldo en caché | Datos frescos si hay red |

Punto importante: **el contenido de los diagramas no se cachea como respuestas HTTP.** Mezclar la caché del Service Worker con la persistencia del CRDT produce estados divergentes entre lo que sirve el caché y lo que tiene IndexedDB. Cada uno cubre una capa distinta.

### 2.5.4 Persistencia local

- Un documento CRDT por diagrama, almacenado de forma incremental en IndexedDB.
- Compactación periódica del historial de operaciones para respetar RNF-OFF-04 (< 5 MB por diagrama).
- Solicitud de `navigator.storage.persist()` al abrir el primer diagrama, para evitar el desalojo automático (RF-OFF-11).
- Vigilancia de la cuota con `navigator.storage.estimate()` y aviso al usuario al superar el 80 % (RF-OFF-10).

### 2.5.5 Escalado del servidor de colaboración

RNF-ESC-03 exige que el estado de sala no viva en la memoria de un único proceso. Con varias instancias detrás de un balanceador, dos clientes de la misma sala pueden caer en instancias distintas.

Dos opciones, en orden de preferencia:

1. **Afinidad de sala por encaminamiento consistente.** Todas las conexiones de una sala se dirigen a la misma instancia. Simple y eficiente; el coste es una redistribución al perder una instancia.
2. **Bus de mensajes entre instancias.** Las instancias se suscriben a los canales de las salas activas. Más resistente, más partes móviles.

Se adopta la opción 1 en v1 y se deja la 2 documentada como evolución, porque con los volúmenes de RNF-ESC-01 no se justifica la complejidad añadida.

Instantáneas periódicas del documento a almacenamiento duradero para cubrir RNF-ESC-05 (RPO ≤ 1 h). En la práctica, el RPO real es mucho mejor: cada cliente conectado conserva una réplica completa.

---

## 2.6 Frontend PWA

### 2.6.1 Organización

```
frontend/src/
├── components/
│   ├── canvas/        # Lienzo, formas, enrutado de líneas, selección
│   ├── inspector/     # Panel de propiedades de la clase o relación
│   ├── assistant/     # Chat, botón de voz, previsualización de propuestas
│   ├── vision/        # Captura, revisión de elementos reconocidos
│   └── shell/         # Navegación, estado de sincronía, gestión de proyectos
├── services/
│   ├── model/         # Documento CRDT, comandos de dominio, deshacer
│   ├── persistence/   # Enlace con IndexedDB
│   ├── network/       # Proveedor WebSocket, reconexión, presencia
│   └── api/           # Cliente REST tipado desde shared/
├── ai/
│   ├── speech/        # Reconocimiento y síntesis de voz
│   ├── nlu/           # Intención → operaciones de dominio
│   └── vision/        # Pipeline de reconocimiento de pizarra
└── workers/
    ├── service-worker.ts
    ├── vision.worker.ts
    └── nlu.worker.ts
```

### 2.6.2 Regla de flujo de datos

La UI **no muta el modelo directamente**. Emite comandos de dominio (`addClass`, `renameAttribute`, `connectClasses`) que el núcleo aplica sobre el CRDT. Esto da tres cosas gratis: el asistente de IA usa exactamente el mismo canal que el ratón, el deshacer funciona igual para ambos, y las operaciones son auditables.

```
Ratón / teclado ─┐
Asistente de voz ─┼─▶ Comando de dominio ─▶ CRDT ─▶ Render
Propuesta de foto ┘        (validado)
```

Que la IA y el usuario compartan el mismo camino no es elegancia: es lo que hace que RF-IA-05 (deshacer atómico de una operación del asistente) sea trivial en vez de un caso especial.

### 2.6.3 Rendimiento del lienzo

RNF-REND-04 pide 50 fps con 100 clases. Medidas previstas:

- Renderizado en Canvas o WebGL, no en DOM/SVG con un nodo por elemento. Con SVG, 300 clases con sus atributos superan los 10 000 nodos y el navegador no mantiene el tipo.
- Culling por viewport: solo se dibuja lo visible.
- Recalculo del enrutado de líneas únicamente para las relaciones afectadas por un movimiento.
- Los trabajos pesados (layout automático, visión) van a Web Workers para no bloquear el hilo principal.

---

## 2.7 Motor de generación

### 2.7.1 Canalización

El generador **nunca lee el documento CRDT**. Lee una representación intermedia normalizada.

```
Documento CRDT
      │  exportar (elimina metadatos colaborativos)
      ▼
Modelo UML canónico  ── shared/
      │  normalizar (resolver herencia, inferir claves ajenas,
      │              aplicar convenciones de nombre)
      ▼
   IR de generación
      │  VALIDAR ── ¿errores? ──▶ bloquear y reportar (RF-GEN-11)
      │  ok
      ▼
Renderizado de plantillas
      │
      ▼
Árbol de archivos ──▶ formatear ──▶ empaquetar ZIP
```

La representación intermedia existe por una razón concreta: las plantillas deben ser tontas. Si una plantilla tiene que decidir si una relación es bidireccional o cuál es el lado propietario, esa lógica queda duplicada en cada plantilla y es imposible de probar. La IR toma esas decisiones una vez y las deja explícitas.

### 2.7.2 Validaciones bloqueantes

| Validación | Motivo |
|---|---|
| Toda entidad persistente tiene identificador | Sin `@Id`, JPA no arranca |
| Los tipos de atributo pertenecen al catálogo soportado | Un tipo desconocido genera código que no compila |
| Sin ciclos de composición | Cascada de borrado infinita |
| Sin herencia múltiple entre clases | Java no lo admite |
| Nombres válidos y no reservados en Java y en SQL | `class`, `user`, `order` rompen el código o el DDL |
| Sin colisiones de nombre tras aplicar convenciones | Dos clases distintas no pueden generar el mismo archivo |
| Multiplicidades coherentes en ambos extremos | `1..*` contra `1..*` sin tabla intermedia es ambiguo |
| Cardinalidad de relación resoluble a una anotación JPA | Evita generar mapeos imposibles |

Los errores bloquean; los avisos (falta de índices, nombres en plural, ausencia de campos de auditoría) no.

### 2.7.3 Correspondencia UML → Spring Boot

| Elemento UML | Resultado generado |
|---|---|
| Clase | `@Entity` + tabla + repositorio + servicio + controlador + DTOs |
| Interfaz | Interfaz Java; no genera tabla |
| Enumeración | `enum` Java + `@Enumerated(EnumType.STRING)` |
| Clase abstracta | Clase base con estrategia de herencia JPA configurable |
| Atributo | Campo + `@Column` + tipo PostgreSQL + validaciones Bean Validation |
| Atributo marcado como identificador | `@Id` + `@GeneratedValue` |
| Asociación 1..1 | `@OneToOne` con lado propietario explícito |
| Asociación 1..* | `@OneToMany` / `@ManyToOne` con `mappedBy` |
| Asociación *..* | `@ManyToMany` + tabla de unión |
| Composición | Asociación con `cascade = ALL` y `orphanRemoval = true` |
| Agregación | Asociación sin cascada de borrado |
| Herencia | `@Inheritance(strategy = …)` |
| Realización | `implements` |
| Operación de una interfaz | Método del contrato Java; la clase que la realiza recibe el esbozo |
| Operación pública de una clase | Firma en la **capa 3**, no en la entidad (ver 2.7.3.1) |

Todas las colecciones se mapean `LAZY`. Un `EAGER` en una entidad es una decisión que solo puede tomarse sabiendo cómo se consulta, y el diagrama no lo dice; dejarlo perezoso es reversible caso por caso, mientras que un `EAGER` generado arrastra la mitad del grafo en cada consulta y nadie sabe por qué.

Los DTOs serializan el **identificador** de la entidad relacionada, no el objeto. Exponer el objeto abriría el ciclo `Pedido → Cliente → pedidos → Pedido`, que en JSON no termina.

#### 2.7.3.1 Dónde acaban las operaciones del diagrama

Una operación dibujada sobre una clase ordinaria —a mano, dictada por voz, o deducida al importar un diagrama de comunicación— **no se emite en la entidad**. La entidad es un artefacto de persistencia; `confirmar()` no lo es. La firma se declara en la interfaz del servicio y la implementación generada lanza:

```java
@Override
public void confirmar() {
    throw new UnsupportedOperationException(
            "Sin implementar: «confirmar» viene del diagrama, que no dice qué hace.");
}
```

Lanzar en lugar de devolver un valor por defecto es deliberado. El diagrama declara la firma pero no su comportamiento; un `return null` compilaría, pasaría desapercibido y reventaría más tarde y en otro sitio. Así el fallo ocurre donde está la causa y con el nombre del método puesto.

Estas operaciones **no se exponen como endpoints**. Un método del que no se sabe qué hace no puede tener un verbo HTTP asignado sin inventárselo.

Tres casos se descartan con aviso en lugar de generarse:

| Aviso | Cuándo |
|---|---|
| `METHOD_NOT_PUBLIC` | La operación no es `+`: no forma parte del contrato del servicio |
| `METHOD_CLASHES_WITH_CRUD` | Se llama `findAll`, `findById`, `create`, `update` o `delete` |
| `METHOD_IS_ACCESSOR` | Coincide con un getter o setter que la entidad ya genera |

Son avisos y no errores: el diagrama sigue siendo válido y el proyecto se genera igual. Pero se dicen, porque un método dibujado en el lienzo que no aparece por ningún lado del código generado es exactamente la clase de silencio que hace desconfiar de un generador.

### 2.7.4 Estructura del proyecto generado (4 capas)

Lo que sale de verdad para el diagrama de referencia «Tienda» (6 clases → 51 ficheros):

```
com.ejemplo.tienda/
├── Application.java
├── domain/          #  Capa 1 — entidades JPA y enumeraciones
│   ├── Cliente.java  Pedido.java  LineaPedido.java  Producto.java  Categoria.java
│   └── EstadoPedido.java                          (enum del diagrama)
├── repository/      #  Capa 2 — interfaces Spring Data JPA
│   └── ClienteRepository.java  …                  (uno por entidad)
├── service/         #  Capa 3 — contrato
│   ├── ClienteService.java  …
│   └── impl/        #           implementación, @Service @Transactional
│       └── ClienteServiceImpl.java  …
├── controller/      #  Capa 4 — REST, @RestController
│   └── ClienteController.java  …
├── dto/             #  Obligatorio, pero no es una capa: es la frontera de la 4
│   ├── ClienteRequest.java  ClienteResponse.java  …   (records)
│   └── mapper/ClienteMapper.java  …
└── exception/       #  ResourceNotFoundException, ErrorResponse,
                     #  GlobalExceptionHandler (@RestControllerAdvice)

src/main/resources/
├── application.yml
└── db/migration/V1__esquema_inicial.sql            (Flyway, RF-GEN-10)
```

La dependencia entre capas es estrictamente descendente: `controller → service → repository → domain`. El controlador **nunca nombra la entidad**: no la devuelve, no la acepta y no la importa. El mapeador traduce entre DTO y dominio (RF-GEN-09).

Las mismas cuatro capas para una sola clase, `Pedido`, recortadas a lo esencial:

```java
// Capa 1 — domain/Pedido.java
@Entity @Table(name = "pedidos")
public class Pedido {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Enumerated(EnumType.STRING) @Column(nullable = false)
    private EstadoPedido estado;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "cliente_id", nullable = false)
    private Cliente cliente;
    @OneToMany(mappedBy = "pedido", cascade = CascadeType.ALL, orphanRemoval = true,
               fetch = FetchType.LAZY)
    private Set<LineaPedido> lineas = new HashSet<>();
}

// Capa 2 — repository/PedidoRepository.java
@Repository
public interface PedidoRepository extends JpaRepository<Pedido, Long> { }

// Capa 3 — service/PedidoService.java   (+ impl/PedidoServiceImpl.java)
public interface PedidoService {
    Page<PedidoResponse> findAll(Pageable pageable);
    PedidoResponse findById(Long id);
    PedidoResponse create(PedidoRequest request);
    PedidoResponse update(Long id, PedidoRequest request);
    void delete(Long id);

    // Operaciones declaradas en el diagrama (ver 2.7.3.1).
    void confirmar();
    BigDecimal calcularTotal();
}

// Capa 4 — controller/PedidoController.java
@RestController @RequestMapping("/api/pedidos")
public class PedidoController {
    private final PedidoService service;          // inyección por constructor
    @PostMapping
    public ResponseEntity<PedidoResponse> create(@Valid @RequestBody PedidoRequest request,
                                                 UriComponentsBuilder uriBuilder) { … }
}
```

Detalles que no se ven en el recorte y sí importan:

- **`@OneToMany` lleva `mappedBy`; el lado propietario es el del `@JoinColumn`.** El propietario es el que tiene la clave ajena, que en `1..*` es siempre el lado `*`.
- **`cascade = ALL, orphanRemoval = true` solo en composición.** Una asociación normal no propaga el borrado: si `Cliente` lo hiciera, borrar un cliente arrastraría sus pedidos y su histórico de facturación con ellos.
- **La composición se propaga en dos sitios, y hacen falta los dos.** La cascada de JPA solo actúa si el borrado pasa por el repositorio; la clave ajena lleva además `ON DELETE CASCADE` para que un `DELETE` en SQL no choque contra la restricción. Durante un tiempo faltó la segunda mitad, y el síntoma era engañoso: por la aplicación funcionaba, y la incoherencia solo salía por el camino que nadie prueba. La causa era mirar el campo equivocado —la cascada de JPA vive en el lado **inverso**, que no tiene clave ajena—, así que la composición `1..*` emitía `NO ACTION` mientras la `1..1` emitía `CASCADE`: la misma relación UML con dos semánticas según la multiplicidad. Hoy el lado propietario lleva una bandera propia (`partOfComposition`), separada a propósito de `cascade`: ponerla en el mismo campo habría anotado `CascadeType.ALL` en el `@ManyToOne` de la parte, y entonces borrar **una línea** habría borrado su pedido entero.
- **`equals`/`hashCode` correctos para JPA**: comparan por identificador y devuelven un `hashCode` constante, para que una entidad no cambie de casilla en un `HashSet` cuando Hibernate le asigna el id al persistirla.
- **Cada repositorio importa solo lo que nombra.** Los tipos de los atributos viven en la entidad; volcarlos también aquí dejaba media docena de imports muertos por fichero.
- **`ddl-auto: validate`.** El esquema lo crea Flyway; Hibernate solo comprueba que coincide. Dejar que Hibernate genere el esquema haría de la migración un adorno.

### 2.7.5 Seguridad del generador

RNF-SEG-06 merece un párrafo propio porque es el fallo más probable de esta arquitectura. **Todo nombre que viene del diagrama es entrada no confiable.** Un usuario puede llamar a una clase `User; DROP TABLE--` o `../../../etc/passwd`. Antes de tocar una plantilla:

- Validar cada identificador contra una expresión regular estricta de identificador Java y SQL.
- Rechazar palabras reservadas de ambos lenguajes.
- Normalizar y verificar cada ruta de archivo generada dentro del directorio de salida (evita el escape de directorio al empaquetar el ZIP).
- Escapar según el contexto de destino (Java, SQL, YAML, XML), no con un único escape genérico.

**Nunca sanear quitando caracteres.** Es la trampa de este requisito y merece el ejemplo: `toCamelCase('borrar; DROP TABLE pedidos')` devuelve `borrarDropTablePedidos`, un identificador Java perfectamente válido. Validar *después* de normalizar convierte una entrada hostil en una inocente y la deja pasar. La comprobación va sobre el **texto crudo**, y lo que no la supera se rechaza con el original citado en el aviso, para que quien revisa vea lo que traía el fichero.

Cómo está implementado hoy:

- El identificador se valida contra lista blanca en `validation/validate.ts`, **antes** de llegar a una plantilla, a un nombre de fichero o a una sentencia SQL.
- La ruta de cada fichero se comprueba dos veces: `isSafeRelativePath` sobre el paquete completo, y además `resolve()` contra la raíz de salida en `writeToDisk`, que lanza si el destino no cuelga del directorio pedido. Una de las dos bastaría; hay dos porque el ZIP y el volcado a disco son caminos distintos y el barato es el que se olvida.
- Las plantillas usan `{{{ }}}` en todas partes. No es un descuido: el escape de Handlebars es para HTML y convertiría `Set<Pedido>` en `Set&lt;Pedido&gt;`. La defensa real es la lista blanca de arriba, no el escape de la plantilla.
- Los literales del `data.sql` se escapan en `normalize.ts`, no en la plantilla, por la misma razón: Handlebars no sabe de SQL.

### 2.7.6 Verificación

RNF-MAN-02 exige que el código generado compile. El corpus de referencia vive en `generator/src/fixtures/corpus.ts` y cubre un camino de mapeo distinto por diagrama: `tienda` (uno-a-muchos, muchos-a-muchos, composición, enum, campo único, operaciones de negocio), `rrhh` (herencia, realización de interfaz, uno-a-uno, auto-referencia) y `minimo` (una entidad, sin relaciones). Cuando aparece un caso de mapeo nuevo se añade **antes** de tocar el normalizador; si no, la regresión no se detecta.

**Estado real de la verificación, sin adornos:**

| Nivel | Estado |
|---|---|
| Los tres diagramas generan sin errores de validación | ✅ 51 / 44 / 18 ficheros, cero avisos |
| El Java generado **parsea** | ✅ `javac` sobre los 3 proyectos |
| Sin redeclaraciones, imports duplicados ni tipos incompatibles | ✅ cero errores de esa familia |
| Suite de pruebas del generador sobre el texto generado | ✅ 58 pruebas |
| **`mvn compile` real, con las dependencias resueltas** | ❌ **no verificado** |

La última fila es la importante y merece la explicación completa. **Maven no está instalado en la máquina de desarrollo**, así que el proyecto generado nunca se ha compilado de verdad. Lo que sí se hizo: `javac` sobre todos los ficheros de cada proyecto sin las dependencias de Spring y Jakarta en el classpath. Eso no es una compilación, pero tampoco es nada: `javac` **parsea el fichero entero antes de resolver símbolos**, de modo que un error de sintaxis, una llave sin cerrar o un import repetido aparecerían igualmente. Los 155 errores obtenidos son exclusivamente `cannot find symbol` y `package … does not exist`, y **ninguno** de la familia `already defined` / `duplicate` / `expected` / `illegal` / `incompatible types`.

Conclusión honesta: **el código generado es sintácticamente válido y no tiene colisiones de nombres; que además enlace contra Spring Boot 3 sigue sin comprobarse.** Queda pendiente instalar Maven y ejecutar `mvn -q compile` sobre los tres proyectos del corpus, que es lo que RNF-MAN-02 pide de verdad.

Mientras tanto las pruebas trabajan sobre el **texto generado**: presencia de cada anotación, `mappedBy` en el lado inverso y no en el propietario, `cascade` solo donde hay composición, imports completos y sin sobras, el controlador sin mencionar la entidad, y las operaciones del diagrama en el servicio y no en el endpoint.

### 2.7.7 Qué queda fuera a propósito

El generador produce un CRUD honesto, no una aplicación terminada. Lo que **no** genera, y no por descuido:

| Fuera | Por qué |
|---|---|
| **Seguridad** (Spring Security, JWT, roles) | La API queda abierta. El diagrama de clases no dice quién puede leer qué, y generar un esquema de permisos inventado es peor que no generar ninguno: da la sensación de estar protegido |
| **Auditoría** (`createdAt`, `createdBy`, `@EntityListeners`) | Requiere decidir de dónde sale el usuario actual, que depende de la seguridad que no hay |
| **Borrado lógico** | Cambia el significado de todas las consultas generadas; es una decisión del proyecto, no del diagrama |
| **Pruebas del proyecto generado** | Se genera el código, no sus pruebas. Probar un CRUD generado prueba el generador, y eso ya se hace aquí |
| **Cuerpo de las operaciones del diagrama** | Lanzan `UnsupportedOperationException` (2.7.3.1) |
| **Índices más allá de los únicos y las claves** | Dependen de las consultas reales, que aún no existen |
| **Caché, transacciones distribuidas, eventos** | Fuera del alcance de un modelo de clases |
| **Frontend del proyecto generado** | El alcance es el backend |

Sí está, y conviene saberlo porque suele darse por ausente: **paginación** (`Page<T>` + `Pageable` en las cuatro capas), **validación** (Bean Validation derivada de multiplicidades y `isNullable`), **manejo de errores** (`@RestControllerAdvice` con respuesta uniforme), **`Location` en el 201**, **migraciones versionadas** y **`docker-compose.yml`** con PostgreSQL listo para arrancar.

---

## 2.8 Capa de inteligencia artificial

### 2.8.1 Regla transversal

Ningún modelo escribe en el diagrama. Todos producen una **propuesta** que pasa por validación de esquema y por confirmación del usuario (RF-IA-04, RF-VIS-05, RNF-IA-06).

```
Voz / texto / imagen ─▶ Modelo ─▶ Propuesta ─▶ Validación ─▶ Confirmación ─▶ Comandos ─▶ CRDT
                                                    │              │
                                                 rechazo        rechazo
```

### 2.8.2 Asistente conversacional

El problema real: interpretar lenguaje natural abierto requiere un modelo grande, y RNF-IA-01 fija un presupuesto local de 150 MB. Un modelo que quepa en ese presupuesto no interpreta bien lenguaje libre.

**Arquitectura híbrida, con dos niveles declarados:**

| Condición | Motor | Cobertura |
|---|---|---|
| Con conexión | Modelo de lenguaje en servidor (`backend-tool/src/ai/`) | Lenguaje natural abierto |
| Sin conexión | Gramática de comandos local | Subconjunto acotado y documentado (RF-IA-08) |

La clave para que esto no sea frágil: el modelo del servidor **no devuelve texto ni código**, devuelve un JSON de operaciones conforme a un esquema estricto. Se valida contra el esquema antes de mostrarlo. Si no valida, se descarta y se pide reformular. Esto acota el daño de una alucinación a "no pasa nada" en lugar de "corrompe el diagrama".

```jsonc
// Esquema de salida del intérprete
{
  "operations": [
    { "op": "addClass", "name": "Factura", "kind": "class" },
    { "op": "addAttribute", "classRef": "Factura",
      "name": "total", "type": "BigDecimal", "visibility": "-" }
  ],
  "confidence": 0.92,
  "clarification": null   // pregunta al usuario si algo es ambiguo
}
```

La voz se resuelve en dos escalones: la API de voz del navegador cuando está disponible (coste cero, sin descarga), y un modelo de transcripción local como alternativa cuando no lo está o cuando se exige privacidad. Ver [03-stack-tecnologico.md](03-stack-tecnologico.md#35-inteligencia-artificial).

### 2.8.3 Reconocimiento de pizarra

**Es el componente de mayor riesgo del proyecto.** Se aborda como canalización de etapas, cada una verificable y sustituible por separado, para que un fallo no obligue a rehacer el conjunto.

```
Fotografía
   │ 1. Preproceso: escala de grises, corrección de perspectiva,
   │                binarización adaptativa, eliminación de reflejos
   ▼
Imagen normalizada
   │ 2. Detección de estructura: rectángulos (clases) y segmentos (relaciones)
   ▼
Cajas y líneas
   │ 3. OCR por región, no sobre la imagen completa
   ▼
Texto por caja
   │ 4. Segmentación: nombre / atributos / métodos por posición vertical
   ▼
Clases candidatas
   │ 5. Inferencia de relaciones: extremo de flecha → tipo (RF-VIS-07)
   ▼
Propuesta con confianza por elemento ──▶ revisión del usuario (RF-VIS-06)
```

Decisiones que reducen el riesgo:

- **OCR por región recortada**, no sobre la foto entera. El OCR de propósito general falla con texto disperso; recortado a una caja funciona mucho mejor.
- **Confianza por elemento**, mostrada en la UI. El usuario corrige lo dudoso en lugar de desconfiar de todo.
- **Todo en un Web Worker.** Son cientos de milisegundos a segundos de cómputo; en el hilo principal congelaría la interfaz.
- **Degradación explícita.** Si la etapa 2 falla, aún se puede ofrecer el OCR en bruto para que el usuario construya a mano. Es peor que el objetivo, pero no es un callejón sin salida.

El plan de sprints incorpora un spike acotado en S1 precisamente para medir si las etapas 2 y 3 alcanzan los umbrales RNF-IA-03/04 antes de comprometer un sprint completo.

---

## 2.9 Integración con Architech Enterprise

> **Diseño provisional.** El contrato de Architech Enterprise no está disponible (pregunta abierta Q1). Lo que sigue define la *forma* de la integración, no su contenido.

### 2.9.1 Capa anticorrupción

```
   Dominio propio                    │  Adaptador  │      Architech
   (shared/src/model)                │             │
                                     │             │
   ProjectSummary  ◀── traducir ─────┤  Puerto     ├──▶  ¿? formato externo
   DiagramModel    ──── traducir ────▶  (interfaz) │
   GeneratedArtifact ── traducir ────▶             │
                                     │             │
        Ningún tipo externo cruza esta línea ──────┘
```

El puerto se define en el dominio; el adaptador lo implementa. Consecuencias prácticas: el desarrollo avanza contra un doble de pruebas sin esperar al contrato real, y cuando el contrato llegue —o cambie— el cambio queda contenido en un módulo.

### 2.9.2 Puntos de integración previstos

| Punto | Requisito | Incógnita |
|---|---|---|
| Identidad / SSO | RF-INT-01 | ¿OIDC, SAML, propietario? (Q2) |
| Importar modelo | RF-INT-02 | ¿Qué formato? (Q4) |
| Publicar diagrama o backend | RF-INT-03 | ¿Dirección real de la integración? (Q3) |
| Catálogo de proyectos y permisos | RF-INT-04 | ¿Architech es la autoridad de permisos? |
| Auditoría | RF-INT-05 | ¿Formato de evento esperado? |

### 2.9.3 Postura ante la incertidumbre

Hasta resolver Q1–Q4:

1. Autenticación propia detrás de una interfaz `IdentityProvider`, sustituible por SSO sin tocar el resto.
2. Importación y exportación en un formato canónico propio, con los adaptadores como módulos aparte.
3. Ninguna decisión de modelo de dominio se toma "porque Architech quizá lo pida".

---

## 2.10 Vistas transversales

### 2.10.1 Recorrido de una edición sin conexión

```
1. Usuario sin red renombra la clase "Cliente" a "Persona"
2. UI emite renameClass(id, "Persona")
3. Núcleo valida y aplica la operación al CRDT local
4. UI se redibuja                                    (< 16 ms)
5. Persistencia escribe la operación en IndexedDB    (< 100 ms)
6. Proveedor de red está desconectado → la operación queda pendiente
7. Indicador: "Sin conexión — 1 cambio pendiente"
   ── el usuario cierra el navegador y se va a casa ──
8. Al reabrir, el documento se rehidrata desde IndexedDB, con el cambio
9. Vuelve la red → estado 'syncing'
10. Intercambio de vectores de estado con el servidor
11. Mientras tanto, otro usuario había añadido un atributo a esa misma clase
12. El CRDT integra ambos cambios: la clase se llama "Persona" y tiene el atributo nuevo
13. Estado 'synced'. Sin diálogo de conflicto, sin pérdida.
```

El paso 12 es la razón de todo el capítulo 2.4. Con "último que escribe gana" se habría perdido el renombrado o el atributo.

### 2.10.2 Recorrido de una generación

```
1. Usuario pulsa "Generar backend"
2. El cliente exporta el modelo canónico desde el CRDT
3. ¿Hay conexión?
   No  → RF-OFF-08: acción deshabilitada con explicación, o encolada (RF-OFF-09)
   Sí  → POST /api/projects/:id/generate
4. El servidor verifica permisos (RNF-SEG-02)
5. El generador normaliza a IR
6. Validación → si hay errores, respuesta 422 con la lista de problemas por elemento
7. Renderizado de plantillas → formateo → empaquetado ZIP
8. Respuesta con enlace de descarga temporal
9. Vista previa (RF-GEN-13) o descarga directa
```

### 2.10.3 Observabilidad

RNF-ESC-06 pide poder diagnosticar un fallo de sincronización concreto. Mínimos:

- Identificador de correlación por sesión de cliente, propagado a los registros del servidor.
- Métricas de sala: clientes conectados, operaciones por segundo, retardo de difusión.
- Registro de cada ciclo de reconciliación: duración, operaciones intercambiadas, resultado.
- Métricas del generador: tasa de éxito, causas de fallo de validación agregadas por tipo.
- Alerta ante una tasa anómala de reconexiones, señal temprana de inestabilidad en el servidor de salas.

---

## 2.11 Decisiones registradas

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| D1 | CRDT para el estado del diagrama | OT, última escritura gana | Único enfoque que cubre offline prolongado y convergencia |
| D2 | Biblioteca CRDT existente | Implementación propia | Los errores de convergencia son carísimos de detectar |
| D3 | Local-first: la red no está en el camino crítico | Servidor autoritativo | RF-OFF-03 y RNF-REND-04 a la vez |
| D4 | IR intermedia entre modelo y plantillas | Plantillas sobre el modelo directo | Plantillas sin lógica, validación en un solo sitio |
| D5 | IA híbrida: servidor con red, gramática sin red | Solo local; solo servidor | Presupuesto de 150 MB contra calidad de interpretación |
| D6 | La IA emite propuestas, nunca escribe | Aplicación directa | Contiene el daño de una salida errónea |
| D7 | Canvas/WebGL para el lienzo | SVG con nodos DOM | 300 clases superan lo que el DOM sostiene a 50 fps |
| D8 | Capa anticorrupción para Architech | Integración directa | El contrato se desconoce y probablemente cambiará |
| D9 | Migraciones versionadas en el código generado | `hibernate.ddl-auto` | `ddl-auto` no es aceptable fuera de desarrollo |
| D10 | Afinidad de sala en v1 | Bus de mensajes entre instancias | Complejidad no justificada al volumen previsto |
