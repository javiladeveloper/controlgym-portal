# FitCore — Panel del gimnasio

Portal de gestión multisede para gimnasios, construido con **React + Vite + Tailwind CSS**.
Implementa el diseño `FitCore Prototipo.dc.html` (vista **Panel del gimnasio**) de Claude Design.

> La *App del socio* es un proyecto aparte. Este repositorio es solo el **portal web** de gestión.

## Arranque

```bash
npm install
npm run dev      # http://localhost:5173
```

Otros scripts: `npm run build` (producción → `dist/`) · `npm run preview`.

## Módulos (sidebar)

| Módulo | Descripción |
|---|---|
| **Dashboard** | KPIs por sede, asistencia por hora, check-ins por huella en vivo, alertas |
| **Clientes** | Listado de socios + ficha individual (datos, historial, generar rutina) |
| **CRM** | Embudo de prospectos (arrastra de etapa) y seguimientos del día |
| **Membresías** | Planes, socios por vencer y gestión (renovar / congelar / reactivar) |
| **Rutinas y dietas** | Editor del plan semanal y de comidas, envío a la app del socio |
| **Clases** | Horario semanal (pausar/activar) y matriz de acceso por plan |
| **Promociones** | Campañas de captación y retención |
| **Personal** | Colaboradores, roles, turnos |
| **Kardex** | Inventario y movimientos de productos |
| **Máquinas** | Equipos, estado y mantenimientos |
| **Finanzas** | Ingresos/gastos, gráfico de 6 meses, movimientos |
| **Sponsors** | Convenios y auspicios |
| **Reportes** | Generación de reportes PDF / Excel |

## Interacciones vivas

- **Selector de sede** (sidebar): recalcula los KPIs del Dashboard.
- **Check-ins en vivo**: se agregan cada 5 s en el Dashboard.
- **CRM**: botón *Avanzar* mueve el lead de columna; seguimientos marcables.
- **Membresías / Clases**: congelar socios, pausar clases, togglear acceso por plan.
- **Rutinas**: editar plan semanal y comidas (el total de kcal se recalcula) y "Enviar a la app".
- **Ficha de socio** → *Generar rutina y dieta* navega a Rutinas con el socio precargado.

## Estructura

```
src/
  App.jsx              # Rutas
  store.jsx            # Contexto de sede
  data/fitcore.js      # Todos los datos semilla + paleta
  components/
    Sidebar.jsx  Topbar.jsx  ui.jsx  icons.jsx
  pages/               # 13 módulos
```

## Diseño

- **Tipografía:** Manrope
- **Paleta:** Navy `#141B2E` · Naranja `#FF6B35` · Verde `#1D9E75` · Rojo `#E24B4A`
- Tokens definidos en `tailwind.config.js`.

El HTML original del prototipo se conserva en `design/FitCore Prototipo.dc.html` (referencia, fuera del build).
