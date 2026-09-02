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
    include: ['{shared,generator,backend-tool,frontend}/src/**/*.{test,spec}.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['{shared,generator,backend-tool}/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/fixtures/**'],
    },
  },
});
