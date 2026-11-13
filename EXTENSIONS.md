# Extensiones locales de Helix

Helix define una base declarativa para que el editor pueda descubrir capacidades por lenguaje y mostrar comandos disponibles. `extensions.js` valida manifiestos y arma un registro en memoria. No carga módulos JavaScript de terceros, no descarga código y no ejecuta scripts.

## Manifiesto inicial

```json
{
  "id": "publisher.example",
  "name": "Herramientas de ejemplo",
  "version": "1.0.0",
  "languages": ["javascript", "typescript"],
  "commands": [
    { "id": "check-project", "title": "Revisar proyecto", "when": "workspace" },
    { "id": "explain-current-file", "title": "Explicar archivo", "when": "file" }
  ]
}
```

- `id`: identificador estable en minúsculas, con números, puntos y guiones.
- `name`: etiqueta que verá la persona usuaria.
- `version`: versión semver.
- `languages`: identificadores como `java`, `javascript`, `typescript` o `json`.
- `commands`: acciones declaradas; `when` puede ser `workspace` o `file`.

El registro expone `validateManifest`, `createRegistry`, `builtIns`, `list`, `findForLanguage` y `getCommands`. Los comandos son metadatos; la aplicación debe conectar cada `id` con un manejador propio y permitir sólo acciones incluidas explícitamente en una lista confiable.

## Seguridad y evolución

Para ejecutar extensiones de terceros hará falta una decisión de producto y una frontera de seguridad: permisos visibles, sandbox, límites de CPU/memoria/tiempo, acceso a archivos limitado al workspace autorizado, política de red y mecanismo de desinstalación. No se debe ejecutar `handler`, `script`, `exec`, URL remota ni código descargado a partir de un manifiesto. Hasta implementar esa frontera, las extensiones instalables sólo pueden aportar metadatos y contribuciones no ejecutables.

Una futura tienda requerirá firma o verificación de editor, revisión de dependencias y actualización con consentimiento. La base actual funciona sin dependencias ni red.
