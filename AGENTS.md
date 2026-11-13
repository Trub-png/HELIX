# Reglas de desarrollo de Helix

Helix se construye como un entorno de escritorio local, útil con carpetas y archivos reales. No se deben presentar maquetas o controles inertes como funcionalidades terminadas.

## Ciclo obligatorio para cambios funcionales

1. Separar la arquitectura, interfaz y ejecución en tareas con alcance concreto.
2. Ejecutar cambios mediante componentes mínimos y con permisos explícitos para archivos, procesos, red o cuentas.
3. Verificar sintaxis, compatibilidad de la interfaz y el flujo modificado.
4. Pedir a un agente nuevo, sin historial del cambio, que haga revisión independiente de seguridad y funcionalidad.
5. Corregir los hallazgos de severidad alta o media y repetir la verificación independiente.

## Ejecución de proyectos

- La ejecución de código del proyecto siempre debe requerir confirmación visible.
- Los procesos tienen límite de tiempo, salida acotada y entorno reducido.
- Cada adaptador de lenguaje valida extensión, ruta dentro del workspace y runtime instalado.
- Cualquier URL detectada debe limitarse a `localhost` o `127.0.0.1`; no abrir destinos externos de forma automática.

## Calidad de producto

- La interfaz debe explicar claramente los estados vacíos, permisos y errores.
- Las características deben funcionar en la aplicación Electron y degradarse con claridad en el modo navegador.
- No incluir secretos, credenciales ni telemetría externa por defecto.
