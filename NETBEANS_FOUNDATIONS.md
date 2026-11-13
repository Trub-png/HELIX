# Fundamentos de Helix inspirados en Apache NetBeans

Helix no replica NetBeans ni depende de ingeniería inversa de sus binarios. Se inspira en su separación por módulos, usando ideas arquitectónicas e implementación propia.

## Capas propuestas

1. **Workspace y archivos:** un adaptador observa una carpeta elegida por la persona usuaria y alimenta el árbol visual.
2. **Proyectos:** detectores independientes reconocen proyectos Java, Node, Python o genéricos y aportan comandos de compilación, prueba y ejecución.
3. **Lenguajes:** cada lenguaje aporta tokenización, diagnósticos, navegación y acciones rápidas. Java empezará con reglas locales y después podrá invocar `javac` en un proceso aislado.
4. **Editor y diagnósticos:** el editor consume hallazgos normalizados: archivo, rango, severidad, explicación y acción sugerida.
5. **Entrenador:** transforma cada diagnóstico en una lección breve. Las sospechas se presentan como sugerencias, no como errores seguros.
6. **Acciones y extensiones:** los comandos reciben el contexto del archivo/proyecto activo mediante una interfaz, sin acoplarse a la vista.

Estas capas se inspiran respectivamente en los sistemas de Filesystems, Project API/Project UI, Editor/Lexer/Parsing, Java Source/Hints, Actions y Lookup de Apache NetBeans.

## Límites de licencia

Apache NetBeans se distribuye bajo Apache License 2.0. Si en el futuro se reutiliza código suyo, habrá que conservar licencia y avisos `NOTICE` aplicables, además de revisar licencias transitivas. Por ahora Helix contiene implementación propia.

## Fuentes oficiales

- https://netbeans.apache.org/front/main/about/index.html
- https://netbeans.apache.org/wiki/main/netbeansdevelopperfaq/DevFaqTutorialsAPI/
- https://netbeans.apache.org/wiki/main/wiki/BuildSystemHowTo/
- https://github.com/apache/netbeans/blob/master/LICENSE
