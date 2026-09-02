import { describe, expect, it } from 'vitest';
import {
  isSafeRelativePath,
  isValidJavaIdentifier,
  isValidJavaPackage,
  isValidSqlIdentifier,
  pluralize,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
} from './naming.js';

describe('isValidJavaIdentifier', () => {
  it('acepta identificadores normales', () => {
    expect(isValidJavaIdentifier('Factura')).toBe(true);
    expect(isValidJavaIdentifier('_interno')).toBe(true);
    expect(isValidJavaIdentifier('cliente2')).toBe(true);
  });

  it('rechaza palabras reservadas de Java', () => {
    expect(isValidJavaIdentifier('class')).toBe(false);
    expect(isValidJavaIdentifier('int')).toBe(false);
    expect(isValidJavaIdentifier('record')).toBe(false);
  });

  it('rechaza intentos de inyección', () => {
    expect(isValidJavaIdentifier('User; DROP TABLE--')).toBe(false);
    expect(isValidJavaIdentifier('../../etc/passwd')).toBe(false);
    expect(isValidJavaIdentifier('a b')).toBe(false);
    expect(isValidJavaIdentifier('')).toBe(false);
    expect(isValidJavaIdentifier('2clase')).toBe(false);
  });
});

describe('isValidSqlIdentifier', () => {
  it('rechaza palabras reservadas de SQL', () => {
    expect(isValidSqlIdentifier('user')).toBe(false);
    expect(isValidSqlIdentifier('order')).toBe(false);
    expect(isValidSqlIdentifier('select')).toBe(false);
    expect(isValidSqlIdentifier('table')).toBe(false);
  });

  it('acepta nombres válidos', () => {
    expect(isValidSqlIdentifier('facturas')).toBe(true);
    expect(isValidSqlIdentifier('linea_pedido')).toBe(true);
  });

  it('respeta el límite de 63 caracteres de PostgreSQL', () => {
    expect(isValidSqlIdentifier('a'.repeat(63))).toBe(true);
    expect(isValidSqlIdentifier('a'.repeat(64))).toBe(false);
  });

  it('rechaza inyección SQL', () => {
    expect(isValidSqlIdentifier("x'; DROP TABLE users; --")).toBe(false);
    expect(isValidSqlIdentifier('a"b')).toBe(false);
  });
});

describe('isValidJavaPackage', () => {
  it('acepta paquetes válidos', () => {
    expect(isValidJavaPackage('com.ejemplo.proyecto')).toBe(true);
    expect(isValidJavaPackage('app')).toBe(true);
  });

  it('rechaza paquetes con segmentos reservados o mal formados', () => {
    expect(isValidJavaPackage('com.class.proyecto')).toBe(false);
    expect(isValidJavaPackage('com..proyecto')).toBe(false);
    expect(isValidJavaPackage('Com.Ejemplo')).toBe(false);
    expect(isValidJavaPackage('com.ejemplo.')).toBe(false);
  });
});

describe('isSafeRelativePath', () => {
  it('acepta rutas normales', () => {
    expect(isSafeRelativePath('src/main/java/App.java')).toBe(true);
  });

  it('rechaza el escape de directorio', () => {
    expect(isSafeRelativePath('../../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('src/../../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeRelativePath('C:\\Windows\\System32')).toBe(false);
    expect(isSafeRelativePath('src\\..\\..\\x')).toBe(false);
  });

  it('rechaza bytes nulos y rutas vacías', () => {
    expect(isSafeRelativePath('a\0b')).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
  });
});

describe('conversión de mayúsculas y minúsculas', () => {
  it('convierte desde varias convenciones de origen', () => {
    expect(toPascalCase('linea_pedido')).toBe('LineaPedido');
    expect(toPascalCase('lineaPedido')).toBe('LineaPedido');
    expect(toPascalCase('linea-pedido')).toBe('LineaPedido');
    expect(toCamelCase('LineaPedido')).toBe('lineaPedido');
    expect(toSnakeCase('LineaPedido')).toBe('linea_pedido');
    expect(toKebabCase('LineaPedido')).toBe('linea-pedido');
  });

  it('trata las siglas de forma razonable', () => {
    expect(toSnakeCase('HTTPServer')).toBe('http_server');
    expect(toCamelCase('XMLParser')).toBe('xmlParser');
  });
});

describe('pluralize', () => {
  it('aplica las reglas habituales', () => {
    expect(pluralize('Factura')).toBe('Facturas');
    expect(pluralize('Category')).toBe('Categories');
    expect(pluralize('Box')).toBe('Boxes');
    expect(pluralize('Address')).toBe('Addresses');
    expect(pluralize('Leaf')).toBe('Leaves');
  });

  it('cubre los irregulares frecuentes', () => {
    expect(pluralize('Person')).toBe('People');
    expect(pluralize('child')).toBe('children');
  });

  it('es determinista', () => {
    expect(pluralize('Pedido')).toBe(pluralize('Pedido'));
  });
});
