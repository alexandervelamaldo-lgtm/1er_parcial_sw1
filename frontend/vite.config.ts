import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configuración del frontend.
 *
 * El servidor de desarrollo hace de intermediario hacia el backend en lugar de
 * que el navegador lo llame directamente. Así la aplicación usa rutas relativas
 * (`/api/...`, `/colaboracion`) tanto en desarrollo como en producción, donde
 * todo se sirve desde el mismo origen. La alternativa —una URL absoluta con el
 * puerto del backend— arrastra CORS, cookies de otro origen y una variable de
 * entorno más que se puede olvidar al desplegar.
 */
// El puerto tiene que coincidir con el que trae por defecto `backend-tool`
// (`PORT`, 3001). Si se cambia allí, hay que exportar `BACKEND_URL` aquí.
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // El paquete compartido se consume como fuente TypeScript: no hay paso de
      // compilación intermedio, así que un cambio en el protocolo se ve en el
      // navegador al guardar y no después de reconstruir otra cosa.
      '@app/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    /*
     * `host` no se pone aquí a propósito, y no es un olvido.
     *
     * Sin él Vite escucha solo en `localhost`, así que desde el móvil no se
     * alcanza ni poniendo la IP del portátil. Para eso está `npm run
     * dev:frontend:lan`, que arranca lo mismo con `--host` y escucha en todas
     * las interfaces.
     *
     * Se deja como una orden aparte en vez de fijarlo aquí porque este servidor
     * no solo sirve la interfaz: hace de intermediario hacia el backend, con la
     * sesión y los proyectos detrás, y sirve el código fuente con sus mapas.
     * Encenderlo en el fichero significa exponer todo eso en **cualquier** red a
     * la que se conecte el portátil —la de la facultad, la de una cafetería—,
     * durante todo el rato, se necesite o no. Escribir cuatro caracteres más el
     * día que hace falta el móvil sale más barato que eso.
     *
     * Detalle útil: con `--host` basta abrir el 5173 en el cortafuegos, no el
     * 3001. El teléfono habla solo con Vite, y es Vite —desde el portátil— quien
     * llama al backend por `localhost`. El proxy de abajo se encarga también del
     * WebSocket de colaboración.
     */
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      // `ws: true` es imprescindible: sin él el proxy contesta el apretón de
      // manos con un 200 normal y la colaboración no llega a abrirse.
      '/colaboracion': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  css: {
    /*
     * Configuración de PostCSS declarada aquí, vacía y a propósito.
     *
     * Sin esto, Vite busca un `postcss.config.js` subiendo por los directorios
     * padre y sale del proyecto: encuentra el de otro trabajo que hay en el
     * escritorio, intenta cargar el Tailwind que aquel declara y la compilación
     * falla con un error que no menciona ningún fichero de este repositorio.
     * Declararlo en línea corta la búsqueda en seco. Es la misma precaución que
     * toma el `vitest.config.ts` de la raíz, por el mismo motivo.
     */
    postcss: { plugins: [] },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
