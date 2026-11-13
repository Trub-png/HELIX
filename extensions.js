/*
 * Helix extension registry.
 * Manifests declare metadata and command contributions only. This module does
 * not evaluate JavaScript supplied by an extension or load remote content.
 */
(function (root) {
  'use strict';

  const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
  const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
  const LANGUAGE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
  const MAX_COMMANDS = 30;
  const MAX_LABEL_LENGTH = 80;

  function validateManifest(manifest) {
    const errors = [];
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { valid: false, errors: ['El manifiesto debe ser un objeto JSON.'] };
    }

    if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id)) {
      errors.push('id debe usar minúsculas, números, puntos o guiones.');
    }
    if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > MAX_LABEL_LENGTH) {
      errors.push(`name debe contener entre 1 y ${MAX_LABEL_LENGTH} caracteres.`);
    }
    if (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) {
      errors.push('version debe seguir el formato semver, por ejemplo 1.0.0.');
    }
    if (!Array.isArray(manifest.languages) || manifest.languages.length === 0 ||
        manifest.languages.some((language) => typeof language !== 'string' || !LANGUAGE_PATTERN.test(language))) {
      errors.push('languages debe ser una lista de identificadores, por ejemplo ["java", "javascript"].');
    }
    if (!Array.isArray(manifest.commands) || manifest.commands.length > MAX_COMMANDS) {
      errors.push(`commands debe ser una lista con un máximo de ${MAX_COMMANDS} elementos.`);
    } else {
      const seen = new Set();
      manifest.commands.forEach((command, index) => {
        const prefix = `commands[${index}]`;
        if (!command || typeof command !== 'object' || Array.isArray(command)) {
          errors.push(`${prefix} debe ser un objeto.`);
          return;
        }
        if (typeof command.id !== 'string' || !ID_PATTERN.test(command.id)) {
          errors.push(`${prefix}.id no es válido.`);
        } else if (seen.has(command.id)) {
          errors.push(`${prefix}.id está duplicado.`);
        } else {
          seen.add(command.id);
        }
        if (typeof command.title !== 'string' || !command.title.trim() || command.title.length > MAX_LABEL_LENGTH) {
          errors.push(`${prefix}.title debe contener entre 1 y ${MAX_LABEL_LENGTH} caracteres.`);
        }
        if (command.when !== undefined && command.when !== 'workspace' && command.when !== 'file') {
          errors.push(`${prefix}.when solo puede ser "workspace" o "file".`);
        }
        // An extension can declare a command identifier, but not a shell
        // command, script path, handler source, or arbitrary executable.
        if (Object.keys(command).some((key) => ['command', 'script', 'handler', 'exec', 'url'].includes(key))) {
          errors.push(`${prefix} contiene una propiedad ejecutable o remota no permitida.`);
        }
      });
    }
    return { valid: errors.length === 0, errors };
  }

  function freezeCopy(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy));
    if (value && typeof value === 'object') {
      const copy = {};
      Object.keys(value).forEach((key) => { copy[key] = freezeCopy(value[key]); });
      return Object.freeze(copy);
    }
    return value;
  }

  function createRegistry(initialManifests) {
    const entries = new Map();

    function register(manifest) {
      const result = validateManifest(manifest);
      if (!result.valid) return result;
      if (entries.has(manifest.id)) {
        return { valid: false, errors: [`Ya existe una extensión con id "${manifest.id}".`] };
      }
      entries.set(manifest.id, freezeCopy(manifest));
      return { valid: true, errors: [] };
    }

    function list() {
      return Array.from(entries.values());
    }

    function findForLanguage(language) {
      return list().filter((manifest) => manifest.languages.includes(language));
    }

    function getCommands(context) {
      const activeLanguage = context && typeof context.language === 'string' ? context.language : null;
      const hasWorkspace = Boolean(context && context.workspaceOpen);
      return list()
        .filter((manifest) => !activeLanguage || manifest.languages.includes(activeLanguage))
        .flatMap((manifest) => manifest.commands.map((command) => ({
          extensionId: manifest.id,
          extensionName: manifest.name,
          id: command.id,
          title: command.title,
          enabled: command.when !== 'workspace' || hasWorkspace,
        })));
    }

    (initialManifests || []).forEach((manifest) => {
      const result = register(manifest);
      if (!result.valid) throw new TypeError(result.errors.join(' '));
    });

    return Object.freeze({ register, list, findForLanguage, getCommands });
  }

  const builtIns = [
    {
      id: 'helix.java',
      name: 'Soporte base de Java',
      version: '0.1.0',
      languages: ['java'],
      commands: [
        { id: 'analyze-java', title: 'Analizar archivo Java', when: 'file' },
        { id: 'learn-java-diagnostic', title: 'Explicar diagnóstico Java', when: 'file' },
      ],
    },
    {
      id: 'helix.node',
      name: 'Soporte base de Node.js',
      version: '0.1.0',
      languages: ['javascript', 'typescript', 'json'],
      commands: [
        { id: 'inspect-node-project', title: 'Inspeccionar proyecto Node.js', when: 'workspace' },
        { id: 'analyze-package-json', title: 'Revisar package.json', when: 'file' },
      ],
    },
  ];

  const api = Object.freeze({ validateManifest, createRegistry, builtIns });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HelixExtensions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
