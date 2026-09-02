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
