# Helix

Helix es un entorno de escritorio local para abrir una carpeta, editar archivos de texto, guardar cambios, revisar diagnósticos, ejecutar scripts Node con confirmación y consultar Git.

## Usar la aplicación

En desarrollo:

```bash
npm install
npm start
```

Para una carpeta real, pulsa **Abrir** y selecciona el proyecto. La aplicación limita las operaciones a esa carpeta; el editor no recibe acceso directo a Node ni al sistema de archivos.

## Ejecutable Linux

```bash
npm run package:linux
./outputs/Helix-linux-x64/Helix
```

## Límites actuales

- Node y scripts `npm` piden confirmación porque ejecutan código del proyecto.
- Git muestra el estado local del repositorio.
- GitHub no se conecta a cuentas ni repositorios privados hasta configurar una autorización explícita.
- Las extensiones son manifiestos locales validados; no se ejecuta código de extensiones de terceros sin un modelo de permisos.
