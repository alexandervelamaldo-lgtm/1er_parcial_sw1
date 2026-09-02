import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registrarServiceWorker } from './services/pwa';
import './estilos.css';

const contenedor = document.getElementById('raiz');
if (!contenedor) throw new Error('Falta el elemento #raiz en index.html');

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registrarServiceWorker();
