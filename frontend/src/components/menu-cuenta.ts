import type { FilaPanel, Usuario } from '../services/api';

/**
 * Lo que el menú de cuenta puede decir de verdad sobre quien ha entrado.
 *
 * Vive aparte del componente por lo de siempre: sin jsdom no se monta un
 * navegador en las pruebas, así que la aritmética se saca del JSX.
 *
 * Sobre qué NO enseña esto
 * ------------------------
 * La maqueta traía un `UserProfileDropdown` con cuatro campos que aquí no
 * existen: una foto de perfil, un cargo («Arquitecto Empresarial»), una
 * «Credencial IAM» y un «Código Empleado». No hay ninguno en `Usuario`, que
 * tiene `id`, `email` y `displayName` y nada más, y ninguno se puede deducir.
 * Inventar un nivel de acceso llamado «IAM» en la esquina de la pantalla es
 * peor que no enseñar nada: parece que hay un control de accesos corporativo
 * detrás, y el control de accesos que hay de verdad es el rol por proyecto.
 *
 * Así que el menú enseña eso: el rol por proyecto, contado. Es el único dato de
 * permisos que este sistema conoce y ya viene en la respuesta de `/api/panel`.
 */
export interface ResumenCuenta {
  /** Proyectos de los que es dueño: los únicos que puede borrar o compartir. */
  propios: number;
  /** Invitado con permiso de escritura. */
  editor: number;
  /** Invitado solo para leer. */
  lector: number;
}

export function resumirCuenta(filas: FilaPanel[]): ResumenCuenta {
  const resumen: ResumenCuenta = { propios: 0, editor: 0, lector: 0 };
  for (const { proyecto } of filas) {
    if (proyecto.role === 'owner') resumen.propios += 1;
    else if (proyecto.role === 'editor') resumen.editor += 1;
    else resumen.lector += 1;
  }
  return resumen;
}

/**
 * Las iniciales, que sustituyen a la foto de perfil.
 *
 * No es una decisión estética. La maqueta pinta un `<img>` con una URL remota,
 * y esta aplicación promete funcionar sin conexión: en el escenario que el
 * proyecto se compromete a soportar, esa foto es un icono de imagen rota en la
 * esquina de todas las pantallas. Las iniciales se calculan aquí y no piden
 * nada a la red.
 *
 * Se sacan del nombre si lo hay y del correo si no, porque `displayName` puede
 * venir vacío: el registro no lo exige.
 */
export function iniciales(usuario: Pick<Usuario, 'displayName' | 'email'>): string {
  const nombre = usuario.displayName.trim();
  if (nombre !== '') {
    const palabras = nombre.split(/\s+/).filter((p) => p !== '');
    /*
      Dos iniciales como mucho. «María del Carmen Pérez» daría «MDCP», que ya no
      son iniciales sino una sigla ilegible en un círculo de 32 píxeles.
    */
    const letras = palabras.slice(0, 2).map((p) => [...p][0] ?? '');
    const juntas = letras.join('');
    if (juntas !== '') return juntas.toLocaleUpperCase('es');
  }

  /*
    Del correo se coge la primera letra de la parte local, no del dominio: en
    una organización todos comparten dominio y la inicial sería la misma para
    todo el mundo. Se usa `[...cadena][0]` y no `cadena[0]` porque un correo
    puede empezar por un carácter fuera del plano básico y `[0]` devolvería
    media pareja subrogada.
  */
  const local = usuario.email.split('@')[0] ?? '';
  const primera = [...local][0] ?? '';
  return primera === '' ? '?' : primera.toLocaleUpperCase('es');
}
