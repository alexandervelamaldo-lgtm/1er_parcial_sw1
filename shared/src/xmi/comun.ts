import { attr, hijos, type XmlNode } from './xml.js';

/**
 * Lo que comparten los dos lectores de XMI: el de diagramas de clases
 * (`import.ts`) y el de diagramas de comunicación (`comunicacion.ts`).
 *
 * Están aquí y no en `import.ts` para que el segundo lector no tenga que
 * importar del primero: `import.ts` ya llama a `comunicacion.ts`, y con las
 * ayudas en cualquiera de los dos habría un ciclo. Tampoco están en `xml.ts`,
 * que no sabe nada de UML y no debería: `tipoUml` o `idDe` solo tienen sentido
 * sobre un documento XMI.
 */

export interface AvisoXmi {
  /** `error` impide importar; `aviso` solo se muestra. */
  readonly severidad: 'error' | 'aviso';
  readonly mensaje: string;
}

export function sinPrefijo(valor: string): string {
  const corte = valor.indexOf(':');
  return corte === -1 ? valor : valor.slice(corte + 1);
}

/** Tipo UML del elemento, venga como atributo o como nombre de la etiqueta. */
export function tipoUml(nodo: XmlNode): string {
  const declarado = attr(nodo, 'xmi:type', 'xsi:type');
  if (declarado !== undefined && declarado !== '') return sinPrefijo(declarado);
  return nodo.name;
}

export function idDe(nodo: XmlNode): string | undefined {
  const id = attr(nodo, 'xmi:id', 'xmi.id', 'id');
  return id !== undefined && id !== '' ? id : undefined;
}

/**
 * Referencia a otro elemento, en cualquiera de las formas que se usan: atributo
 * directo, o un hijo con el mismo nombre que lleva el `idref`.
 *
 * La búsqueda es **exacta**, sin la tolerancia de prefijos de `attr`, y no es un
 * detalle. Un `<ownedAttribute xmi:type="uml:Property">` lleva un `xmi:type`
 * cuyo nombre local también es `type`: preguntando con tolerancia, el tipo del
 * atributo se resolvería como «uml:Property» en vez de mirar el hijo `<type>`,
 * y todas las columnas importadas acabarían siendo String sin que nada fallara
 * de forma visible.
 */
export function refDe(nodo: XmlNode, ...nombres: string[]): string | undefined {
  for (const nombre of nombres) {
    const directo = nodo.attributes[nombre];
    if (directo !== undefined && directo !== '') return directo;
  }
  for (const nombre of nombres) {
    for (const hijo of hijos(nodo, sinPrefijo(nombre))) {
      const ref =
        hijo.attributes['xmi:idref'] ?? hijo.attributes['idref'] ?? hijo.attributes['xmi.idref'];
      if (ref !== undefined && ref !== '') return ref;
    }
  }
  return undefined;
}

export function esVerdadero(valor: string | undefined): boolean {
  return valor === 'true' || valor === '1';
}

/**
 * Índice de todo el documento por `xmi:id`.
 *
 * Sin filtrar por nombre de elemento a propósito. Los lectores tienen que
 * saltar de un mensaje a su ocurrencia, de ahí a la línea de vida, de ahí al
 * rol y de ahí al clasificador, y cada eslabón es un elemento distinto. Una
 * lista blanca de nombres se quedaría corta en cuanto una herramienta usara
 * otro; el analizador ya limita el documento a 200 000 nodos, así que
 * recorrerlo entero está acotado.
 *
 * Gana la primera aparición: en un XMI bien formado los identificadores son
 * únicos, y si se repiten, quedarse con el primero es al menos determinista.
 */
export function indexarPorId(raiz: XmlNode): Map<string, XmlNode> {
  const porId = new Map<string, XmlNode>();
  const pendientes: XmlNode[] = [raiz];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    const id = idDe(actual);
    if (id !== undefined && !porId.has(id)) porId.set(id, actual);
    for (const hijo of actual.children) pendientes.push(hijo);
  }
  return porId;
}
