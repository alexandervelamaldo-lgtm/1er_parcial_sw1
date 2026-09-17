-- Esquema de la herramienta.
--
-- Se aplica solo al arrancar con DATABASE_URL. Todo es `if not exists` porque
-- esto corre en cada arranque: es un esquema idempotente, no una migración.
-- Cuando el proyecto tenga que cambiar una columna existente hará falta una
-- herramienta de migraciones de verdad; hasta entonces, esto evita el paso
-- manual de «entra por psql y pega el fichero» que siempre se olvida.
--
-- Los nombres van en español porque el resto del dominio también.

-- Usuarios ------------------------------------------------------------------
--
-- `hash` es scrypt sobre la contraseña con `sal`, exactamente como en la
-- implementación de fichero. La base de datos no ve nunca la contraseña.

create table if not exists usuarios (
  id          uuid primary key,
  correo      text not null unique,
  nombre      text not null,
  sal         text not null,
  hash        text not null,
  creado_en   timestamptz not null default now()
);

-- Código de recuperación de un solo uso.
--
-- Va con `alter table` y no dentro del `create table` de arriba a propósito: ese
-- `create` lleva `if not exists`, así que en una base que ya existía no habría
-- añadido nada y estas dos columnas no aparecerían nunca. `add column if not
-- exists` sí es idempotente de verdad y sirve para los dos casos.
--
-- Son `null` cuando no hay código pendiente. Se guarda el hash, igual que con la
-- contraseña: quien lea la tabla no puede recuperar cuentas con lo que ve.
alter table usuarios add column if not exists sal_recuperacion  text;
alter table usuarios add column if not exists hash_recuperacion text;

-- Proyectos -----------------------------------------------------------------

create table if not exists proyectos (
  id             uuid primary key,
  nombre         text not null,
  descripcion    text not null default '',
  propietario_id uuid not null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- `propietario_id` y `miembros.usuario_id` NO llevan clave foránea contra
-- `usuarios`, y no es un descuido.
--
-- El almacén de proyectos y el proveedor de identidad son dos interfaces
-- independientes (`ProjectStore`, `IdentityProvider`), y esa independencia es
-- deliberada: la identidad definitiva la aportará Architech Enterprise
-- (Arquitectura §2.9, decisión D8), con sus usuarios fuera de esta base de
-- datos. Una foránea aquí haría imposible esa combinación —proyectos en
-- PostgreSQL, usuarios en el proveedor externo— justo cuando toque hacerla.
--
-- Dentro de un mismo almacén sí se usan, porque ahí no hay frontera que cruzar.

create table if not exists miembros (
  proyecto_id uuid not null references proyectos(id) on delete cascade,
  usuario_id  uuid not null,
  rol         text not null check (rol in ('owner', 'editor', 'viewer')),
  primary key (proyecto_id, usuario_id)
);

-- Listar «mis proyectos» es la consulta de la pantalla inicial y va por
-- usuario, que es justo el lado por el que la clave primaria no ayuda.
create index if not exists miembros_por_usuario on miembros (usuario_id);

-- Documentos colaborativos --------------------------------------------------
--
-- `estado` es el documento Yjs entero codificado con `Y.encodeStateAsUpdate`:
-- binario opaco, no consultable. Vive aparte de `proyectos` porque los ciclos
-- de vida no se parecen —los metadatos cambian una vez al mes y el documento
-- cada dos segundos— y porque una fila con un `bytea` grande reescrito
-- constantemente es exactamente lo que no conviene tener pegado a la tabla que
-- se consulta para pintar la lista de proyectos.
--
-- La clave es `text` y no `uuid`, y sin foránea contra `proyectos`: para el
-- almacén de documentos el identificador de sala es una cadena opaca. Hoy
-- coincide con el del proyecto, pero `DocumentStore` no lo exige y las pruebas
-- usan identificadores sintéticos. El borrado no queda huérfano porque
-- `RoomManager.discard()` lo hace explícito al eliminar el proyecto.

create table if not exists documentos (
  sala_id        text primary key,
  estado         bytea not null,
  actualizado_en timestamptz not null default now()
);

-- Tablón del proyecto -------------------------------------------------------
--
-- El módulo de comunicación interna: un hilo por proyecto, con mensajes de
-- texto y notas de voz. No vive en el documento Yjs porque un hilo no es un
-- CRDT; ver la cabecera de `storage/tablon.ts`.
--
-- `autor_id` es `text` y sin foránea contra `usuarios`, por la misma razón que
-- `miembros.usuario_id`: la identidad definitiva la aportará un proveedor
-- externo (decisión D8) y sus identificadores no estarán en esta base.

create table if not exists tablon_mensajes (
  id          uuid primary key,
  proyecto_id uuid not null references proyectos(id) on delete cascade,
  autor_id    text not null,
  -- Ordena el hilo; no cambia nunca.
  secuencia   bigint not null,
  -- Cursor del sondeo; vuelve a asignarse al retirar. Son dos cosas distintas
  -- y usar una sola rompe el orden del hilo o la entrega de las retiradas.
  version     bigint not null,
  creado_en   timestamptz not null default now(),
  tipo        text not null check (tipo in ('texto', 'voz')),
  texto       text not null default '',
  audio_tipo  text check (audio_tipo in ('audio/webm', 'audio/ogg', 'audio/mp4')),
  audio_bytes integer,
  audio_ms    integer,
  retirado    boolean not null default false,
  -- Dos mensajes del mismo proyecto no pueden compartir número: si el contador
  -- se corrompiera, es preferible que la inserción falle a que el hilo empiece
  -- a barajarse sin que nadie lo note.
  unique (proyecto_id, secuencia),
  unique (proyecto_id, version)
);

-- Las tres consultas del tablón van todas por proyecto y luego por uno de los
-- dos números. Sin estos índices, sondear cada pocos segundos significa un
-- recorrido completo de la tabla por cada cliente conectado.
create index if not exists tablon_por_secuencia on tablon_mensajes (proyecto_id, secuencia);
create index if not exists tablon_por_version   on tablon_mensajes (proyecto_id, version);

-- Los bytes del audio, en su propia tabla.
--
-- Mismo motivo que separa `documentos` de `proyectos`: una columna `bytea`
-- grande pegada a la tabla que se consulta cada pocos segundos para sondear es
-- exactamente lo que no conviene. Aquí se lee una vez, cuando alguien pulsa
-- reproducir. El `on delete cascade` es lo que hace que retirar un mensaje o
-- borrar el proyecto se lleve el audio sin un segundo borrado que se pueda
-- olvidar.

create table if not exists tablon_audios (
  mensaje_id uuid primary key references tablon_mensajes(id) on delete cascade,
  datos      bytea not null
);

-- Contador por proyecto.
--
-- Va en su propia tabla y no se calcula con `max(version) + 1`: entre el
-- `select` y el `insert` caben dos mensajes simultáneos, y los dos se
-- llevarían el mismo número. Un `insert … on conflict do update … returning`
-- sobre esta fila es una sola sentencia atómica, y la restricción de unicidad
-- de arriba es la red por si alguna vez deja de serlo.

create table if not exists tablon_contadores (
  proyecto_id uuid primary key references proyectos(id) on delete cascade,
  contador    bigint not null default 0
);
