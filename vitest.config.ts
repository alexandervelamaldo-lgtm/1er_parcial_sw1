import { defineConfig } from 'vitest/config';

// Configuración explícita en la raíz del proyecto. Sin ella, Vitest asciende por
// el árbol de directorios y encuentra un vite.config.js ajeno al proyecto.
export default defineConfig({
  // PostCSS inline por el mismo motivo: evita que Vite encuentre el
  // postcss.config.js del directorio padre, que depende de Tailwind.
  css: { postcss: { plugins: [] } },
  test: {
    root: __dirname,
    css: false,
    // El frontend entra aquí solo con sus módulos puros —la geometría del
    // lienzo—, que no tocan el DOM y corren en Node como los demás. Las pruebas
    // de componente necesitan jsdom y siguen pendientes de instalarlo.
    //
    // El `.tsx` no contradice lo anterior: un elemento de React es un objeto
    // hasta que alguien lo pinta, así que `iconos.test.tsx` llama al componente
    // como a una función y mira lo que devuelve, sin DOM por medio. Lo que sigue
    // necesitando jsdom es renderizar de verdad y disparar eventos.
    include: ['{shared,generator,backend-tool,frontend}/src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['{shared,generator,backend-tool}/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/fixtures/**'],
    },
  },
});
