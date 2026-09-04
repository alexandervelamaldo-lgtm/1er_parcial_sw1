export * from './model/uml.js';
export * from './model/type-catalog.js';
export * from './model/naming.js';
export * from './model/id.js';
export * from './model/factory.js';
export * from './ops/operations.js';
export * from './ops/impact.js';
export * from './ops/import-table.js';
export * from './ops/import-diagram.js';
export * from './crdt/document.js';
export * from './crdt/operations.js';
export * from './crdt/historial.js';
export * from './crdt/wire.js';
export * from './crdt/provider.js';
export * from './ai/grammar.js';
export * from './xmi/xml.js';
export * from './xmi/export.js';
export * from './xmi/import.js';
// `comun.js` no se reexporta: su `AvisoXmi` ya sale por `import.js`, y dos
// `export *` con el mismo nombre lo dejarían inaccesible para quien lo importe.
export * from './xmi/comunicacion.js';
// El análisis de casos de uso, su catálogo y su escritor para Enterprise
// Architect. Van en `shared` y no en `backend-tool` porque el catálogo describe
// el sistema entero —frontend incluido— y porque así el modelo y sus pruebas
// viven en el mismo sitio.
export * from './xmi/analisis.js';
export * from './xmi/casos-de-uso.js';
export * from './xmi/catalogo-md.js';
export * from './xmi/ea-comunicacion.js';
export * from './guia/corpus.js';
export * from './guia/buscar.js';
export * from './guia/prompt.js';
