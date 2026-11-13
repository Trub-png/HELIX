'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { constants: fsConstants } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRepairEngine } = require('./repair-engine');

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.idea']);
const TEXT_EXTENSIONS = new Set([
  '.java', '.kt', '.kts', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.scss',
  '.html', '.htm', '.json', '.md', '.txt', '.xml', '.yml', '.yaml', '.py', '.c', '.h',
  '.cpp', '.hpp', '.cs', '.go', '.rs', '.php', '.sql', '.sh', '.properties', '.gradle',
]);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TREE_FILES = 15000;
const MAX_PROCESS_OUTPUT = 512 * 1024;
const RUN_TIMEOUT_MS = 30000;
const RUNTIMES = Object.freeze({
  node: { label: 'Node.js', command: () => process.execPath, probe: ['--version'], extensions: ['.js', '.mjs', '.cjs'], template: "console.log('Hola desde Node.js');\n" },
  python: { label: 'Python', command: () => process.platform === 'win32' ? 'python' : 'python3', probe: ['--version'], extensions: ['.py'], template: "print('Hola desde Python')\n" },
  java: { label: 'Java', command: () => 'java', probe: ['-version'], extensions: ['.java'], template: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hola desde Java");\n    }\n}\n' },
  c: { label: 'C (gcc)', command: () => 'gcc', probe: ['--version'], extensions: ['.c'], template: '#include <stdio.h>\n\nint main(void) {\n    puts("Hola desde C");\n    return 0;\n}\n' },
  go: { label: 'Go', command: () => 'go', probe: ['version'], extensions: ['.go'], template: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hola desde Go")\n}\n' },
});
let mainWindow;
let workspaceRoot = null;
const repairEngine = createRepairEngine();
const failedRuns = new Map();
const repairSessions = new Map();
const REPAIR_TTL_MS = 5 * 60 * 1000;
const FAILED_RUN_TTL_MS = 5 * 60 * 1000;

function contentHash(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
function repairKey(relative) { return `${mainWindow?.webContents.id || 0}\0${workspaceRoot}\0${relative}`; }
function cleanupRepairSession(id) {
  const session = repairSessions.get(id);
  if (session) repairEngine.clearSession(session.engineSessionId);
  repairSessions.delete(id);
}
function pruneRepairSessions() {
  const now = Date.now();
  for (const [id, session] of repairSessions) if (session.expiresAt <= now) cleanupRepairSession(id);
  for (const [key, failed] of failedRuns) if (failed.expiresAt <= now) failedRuns.delete(key);
}

function isTrustedSender(event) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  try {
    return new URL(frame.url).href === pathToFileURL(path.join(__dirname, 'index.html')).href;
  } catch {
    return false;
  }
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Solicitud IPC no autorizada.');
    return handler(...args);
  });
}

function requireWorkspace() {
  if (!workspaceRoot) throw new Error('Primero abre una carpeta de proyecto.');
  return workspaceRoot;
}

function normalizeRelativePath(input) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) {
    throw new TypeError('La ruta debe ser texto válido.');
  }
  const normalized = input.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('Solo se permiten rutas relativas al proyecto.');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('La ruta contiene segmentos no permitidos.');
  }
  return parts.join(path.sep);
}

async function safePath(relativePath, { allowMissing = false } = {}) {
  const root = requireWorkspace();
  const relative = normalizeRelativePath(relativePath);
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error('La ruta queda fuera de la carpeta del proyecto.');
  }
  let checked = candidate;
  if (allowMissing) {
    let parent = path.dirname(candidate);
    while (parent !== root && !parent.startsWith(`${root}${path.sep}`)) {
      throw new Error('La carpeta padre queda fuera del proyecto.');
    }
    const realRoot = await fs.realpath(root);
    const realParent = await fs.realpath(parent);
    if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error('La ruta atraviesa un enlace fuera del proyecto.');
    }
    return { candidate, relative };
  }
  checked = await fs.realpath(candidate);
  const realRoot = await fs.realpath(root);
  if (checked !== realRoot && !checked.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('La ruta atraviesa un enlace fuera del proyecto.');
  }
  return { candidate: checked, relative };
}

async function safeWriteFile(candidate, content) {
  // lstat rejects a destination symlink; O_NOFOLLOW closes the final-component race
  // on platforms that support it. The pre/post checks also cover platforms without it.
  const before = await fs.lstat(candidate);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('La ruta no corresponde a un archivo seguro.');
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const handle = await fs.open(candidate, fsConstants.O_WRONLY | noFollow);
  try {
    const opened = await handle.stat();
    const after = await fs.lstat(candidate);
    if (!opened.isFile() || after.isSymbolicLink() || opened.dev !== after.dev || opened.ino !== after.ino) {
      throw new Error('El archivo de destino cambió durante la escritura.');
    }
    await handle.truncate(0);
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}

function processEnvironment({ git = false } = {}) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'SystemRoot', 'WINDIR', 'PATHEXT']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.FORCE_COLOR = '0';
  if (git) {
    env.GIT_CONFIG_NOSYSTEM = '1';
    env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
    env.GIT_CONFIG_COUNT = '2';
    env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
    env.GIT_CONFIG_VALUE_0 = process.platform === 'win32' ? 'NUL' : '/dev/null';
    env.GIT_CONFIG_KEY_1 = 'safe.directory';
    env.GIT_CONFIG_VALUE_1 = '*';
  }
  return env;
}

async function listWorkspaceFiles() {
  const root = requireWorkspace();
  const result = [];
  async function walk(dir, depth = 0) {
    if (depth > 12 || result.length >= MAX_TREE_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (result.length >= MAX_TREE_FILES) return;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          result.push({ path: relative, kind: 'directory' });
          await walk(absolute, depth + 1);
        }
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(absolute);
        if (stat.size <= MAX_FILE_BYTES) result.push({ path: relative, kind: 'file', size: stat.size });
      }
    }
  }
  await walk(root);
  return { rootName: path.basename(root), files: result, truncated: result.length >= MAX_TREE_FILES };
}

function runProcess(command, args, cwd, { git = false, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    // POSIX children run in a new process group so a timeout can also stop descendants.
    // Windows has no equivalent here: child.kill() terminates only the spawned process.
    const isWindows = process.platform === 'win32';
    const child = spawn(command, args, {
      cwd, shell: false, windowsHide: true, detached: !isWindows, env: processEnvironment({ git }),
    });
    let stdout = '';
    let stderr = '';
    let total = 0;
    const append = (target, chunk) => {
      const text = chunk.toString();
      total += Buffer.byteLength(text);
      if (total <= MAX_PROCESS_OUTPUT) {
        if (target === 'stdout') stdout += text;
        else stderr += text;
      }
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (isWindows) {
        // taskkill terminates the child and its descendants without invoking a shell.
        // It is best effort; settle immediately so its own process cannot hold up callers.
        try {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            shell: false, windowsHide: true, stdio: 'ignore', env: processEnvironment({ git }),
          });
          killer.on('error', () => {});
        } catch {}
        try { child.kill('SIGKILL'); } catch {}
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') child.kill('SIGKILL');
        }
      }
      // Do not wait for close: inherited stdio held by a descendant can keep
      // the pipes open even after the spawned process has been killed.
      finish({ code: null, signal: 'SIGKILL', stdout, stderr, truncated: total > MAX_PROCESS_OUTPUT, timedOut });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', (code, signal) => {
      finish({ code, signal, stdout, stderr, truncated: total > MAX_PROCESS_OUTPUT, timedOut });
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#101114',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function installIpc() {
  registerHandler('helix:workspace:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    workspaceRoot = await fs.realpath(result.filePaths[0]);
    failedRuns.clear();
    for (const id of repairSessions.keys()) cleanupRepairSession(id);
    return { name: path.basename(workspaceRoot), path: workspaceRoot };
  });
  registerHandler('helix:files:list', listWorkspaceFiles);
  registerHandler('helix:files:read', async (relativePath) => {
    const { candidate } = await safePath(relativePath);
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('El archivo no es de texto o supera 1 MB.');
    if (!TEXT_EXTENSIONS.has(path.extname(candidate).toLowerCase())) throw new Error('Este tipo de archivo no se admite como texto.');
    return fs.readFile(candidate, 'utf8');
  });
  registerHandler('helix:files:write', async (relativePath, content) => {
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('El contenido supera el límite de 1 MB.');
    const { candidate } = await safePath(relativePath);
    await safeWriteFile(candidate, content);
    return { saved: true };
  });
  registerHandler('helix:files:create', async (relativePath) => {
    return createWorkspaceFile(relativePath, '');
  });
  registerHandler('helix:folders:create', createWorkspaceFolder);
  registerHandler('helix:files:move', moveWorkspaceEntry);
  registerHandler('helix:files:delete', deleteWorkspaceEntry);
  registerHandler('helix:templates:list', async () => Object.entries(RUNTIMES).map(([id, item]) => ({ id, label: item.label, extensions: item.extensions, template: item.template })));
  registerHandler('helix:templates:create', async (templateId, relativePath) => {
    if (typeof templateId !== 'string' || !Object.hasOwn(RUNTIMES, templateId)) throw new Error('Plantilla no admitida.');
    const item = RUNTIMES[templateId];
    const relative = normalizeRelativePath(relativePath);
    if (!item.extensions.includes(path.extname(relative).toLowerCase())) throw new Error('La extensión no coincide con la plantilla elegida.');
    await createWorkspaceFile(relative, item.template);
    return { created: true, templateId };
  });
  registerHandler('helix:git:status', async () => {
    const root = requireWorkspace();
    const hooksPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const result = await runProcess('git', ['-c', `core.hooksPath=${hooksPath}`, 'status', '--short', '--branch'], root, { git: true });
    return { ...result, available: result.code !== null };
  });
  registerHandler('helix:node:npm-script', async (scriptName) => {
    const root = requireWorkspace();
    if (typeof scriptName !== 'string' || !/^[a-zA-Z0-9:_-]{1,80}$/.test(scriptName)) throw new Error('Nombre de script inválido.');
    const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    if (!packageJson.scripts || typeof packageJson.scripts[scriptName] !== 'string') throw new Error('Ese script no existe en package.json.');
    return runProcess(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', scriptName], root);
  });
  registerHandler('helix:node:run-file', async (relativePath) => {
    return executeProjectFile(relativePath);
  });
  registerHandler('helix:runtime:catalog', async () => Object.entries(RUNTIMES).map(([id, item]) => ({ id, label: item.label, extensions: item.extensions, template: item.template })));
  registerHandler('helix:runtime:availability', async () => Promise.all(Object.entries(RUNTIMES).map(async ([id, item]) => {
    try {
      const result = await runProcess(item.command(), item.probe, requireWorkspace(), { timeoutMs: 5000 });
      return { id, available: result.code === 0, version: `${result.stdout}${result.stderr}`.trim().slice(0, 240) };
    } catch (error) { return { id, available: false, error: String(error.message).slice(0, 240) }; }
  })));
  registerHandler('helix:runtime:run-file', executeProjectFile);
  registerHandler('helix:repair:attempt', attemptRepair);
  registerHandler('helix:repair:apply', applyRepair);
  registerHandler('helix:repair:discard', discardRepair);
  registerHandler('helix:runtime:open-local-url', async (input) => {
    const url = validateLocalUrl(input);
    await shell.openExternal(url.href);
    return { opened: true, url: url.href };
  });
}

async function createWorkspaceFile(relativePath, content) {
  const root = requireWorkspace();
  const relative = normalizeRelativePath(relativePath);
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('El contenido supera el límite permitido.');
  const parts = relative.split(path.sep);
  const name = parts.pop();
  let parent = root;
  for (const part of parts) {
    parent = path.join(parent, part);
    try {
      const stat = await fs.lstat(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('La carpeta de destino no es segura.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(parent);
    }
  }
  const candidate = path.join(parent, name);
  const realRoot = await fs.realpath(root);
  const realParent = await fs.realpath(parent);
  if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) throw new Error('La ruta queda fuera del proyecto.');
  if (!TEXT_EXTENSIONS.has(path.extname(candidate).toLowerCase())) throw new Error('Usa una extensión de texto admitida.');
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const handle = await fs.open(candidate, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow, 0o666);
  try { await handle.writeFile(content, 'utf8'); } finally { await handle.close(); }
  return { created: true };
}

// File-management operations reject symlinks in every traversed component. This
// deliberately does not use safePath's realpath resolution, which permits safe
// links within the project for read-only operations.
async function checkedWorkspaceEntry(relativePath, { allowMissing = false } = {}) {
  const root = requireWorkspace();
  const relative = normalizeRelativePath(relativePath);
  const parts = relative.split(path.sep);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('No se permiten enlaces simbólicos en operaciones de archivos.');
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('La carpeta padre no es válida.');
      if (index === parts.length - 1) return { candidate: current, relative, stat };
    } catch (error) {
      if (error.code !== 'ENOENT' || !allowMissing) throw error;
      if (index < parts.length - 1) throw new Error('La carpeta padre no existe.');
      return { candidate: current, relative, stat: null };
    }
  }
  throw new Error('La ruta no es válida.');
}

async function createWorkspaceFolder(relativePath) {
  const root = requireWorkspace();
  const relative = normalizeRelativePath(relativePath);
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('La ruta de carpeta no es segura.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(current, { mode: 0o755 });
    }
  }
  return { created: true, path: relative.split(path.sep).join('/') };
}

async function moveWorkspaceEntry(sourcePath, destinationPath) {
  const source = await checkedWorkspaceEntry(sourcePath);
  const destination = await checkedWorkspaceEntry(destinationPath, { allowMissing: true });
  if (destination.stat) throw new Error('Ya existe un elemento con ese nombre.');
  if (source.stat.isDirectory() && destination.candidate.startsWith(`${source.candidate}${path.sep}`)) {
    throw new Error('No se puede mover una carpeta dentro de sí misma.');
  }
  await fs.rename(source.candidate, destination.candidate);
  return { moved: true, path: destination.relative.split(path.sep).join('/') };
}

async function deleteWorkspaceEntry(relativePath) {
  const { candidate, stat, relative } = await checkedWorkspaceEntry(relativePath);
  if (stat.isDirectory()) {
    // Inspect recursively before removal so a symlink cannot hide a path outside
    // the workspace, and do not follow links while examining descendants.
    async function rejectSymlinks(directory) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        const childStat = await fs.lstat(child);
        if (childStat.isSymbolicLink()) throw new Error('No se puede eliminar una carpeta que contiene enlaces simbólicos.');
        if (childStat.isDirectory()) await rejectSymlinks(child);
      }
    }
    await rejectSymlinks(candidate);
    await fs.rm(candidate, { recursive: true, force: false });
  } else if (stat.isFile()) {
    await fs.unlink(candidate);
  } else {
    throw new Error('Solo se pueden eliminar archivos y carpetas.');
  }
  return { deleted: true, path: relative.split(path.sep).join('/') };
}

function validateLocalUrl(input) {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(input)) throw new Error('URL local inválida.');
  let url;
  try { url = new URL(input); } catch { throw new Error('URL local inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase())) throw new Error('Solo se permiten URLs HTTP(S) de localhost o 127.0.0.1.');
  return url;
}

async function executeProjectFile(relativePath) {
  const { candidate } = await safePath(relativePath);
  const extension = path.extname(candidate).toLowerCase();
  const item = Object.values(RUNTIMES).find((runtime) => runtime.extensions.includes(extension));
  if (!item) throw new Error('Extensión no admitida para ejecución.');
  const stat = await fs.stat(candidate);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('El archivo supera 1 MB o no es un archivo.');
  const cwd = requireWorkspace();
  const result = await executeCandidate(candidate, extension, cwd);
  const key = repairKey(normalizeRelativePath(relativePath));
  if (result.code !== 0 || result.timedOut || result.truncated) {
    failedRuns.set(key, { relativePath: normalizeRelativePath(relativePath), result, expiresAt: Date.now() + FAILED_RUN_TTL_MS });
  } else failedRuns.delete(key);
  return { ...result, detectedUrls: findLocalUrls(`${result.stdout}\n${result.stderr}`) };
}

async function executeCandidate(candidate, extension, cwd) {
  const item = Object.values(RUNTIMES).find((runtime) => runtime.extensions.includes(extension));
  if (!item) throw new Error('Extensión no admitida para ejecución.');
  const stat = await fs.stat(candidate);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('El archivo supera 1 MB o no es un archivo.');
  let result;
  if (extension === '.java' || extension === '.c') {
    const tempRoot = await fs.realpath(os.tmpdir());
    const workDir = path.join(tempRoot, `helix-run-${crypto.randomBytes(16).toString('hex')}`);
    await fs.mkdir(workDir, { mode: 0o700 });
    try {
      const sourceName = extension === '.java' ? path.basename(candidate) : 'main.c';
      const tempSource = path.join(workDir, sourceName);
      await fs.copyFile(candidate, tempSource, fsConstants.COPYFILE_EXCL);
      const compile = extension === '.java'
        ? await runProcess('javac', ['-d', workDir, tempSource], cwd, { timeoutMs: RUN_TIMEOUT_MS })
        : await runProcess('gcc', ['-o', path.join(workDir, 'program'), tempSource], cwd, { timeoutMs: RUN_TIMEOUT_MS });
      if (compile.code !== 0 || compile.timedOut) return { ...compile, phase: 'compile', detectedUrls: findLocalUrls(compile.stdout + '\n' + compile.stderr) };
      result = extension === '.java'
        ? await runProcess('java', ['-cp', workDir, path.basename(candidate, '.java')], cwd, { timeoutMs: RUN_TIMEOUT_MS })
        : await runProcess(path.join(workDir, 'program'), [], cwd, { timeoutMs: RUN_TIMEOUT_MS });
    } finally { await fs.rm(workDir, { recursive: true, force: true }); }
  } else {
    const args = extension === '.py' ? [candidate] : extension === '.go' ? ['run', candidate] : [candidate];
    result = await runProcess(item.command(), args, cwd, { timeoutMs: RUN_TIMEOUT_MS });
  }
  return result;
}

// Parse or compile a temporary source file without launching the user's program.
async function validateSyntaxCandidate(candidate, extension, cwd) {
  const item = Object.values(RUNTIMES).find((runtime) => runtime.extensions.includes(extension));
  if (!item) throw new Error('La reparación sintáctica no admite este lenguaje.');
  const stat = await fs.stat(candidate);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('El archivo supera 1 MB o no es un archivo.');
  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    return runProcess(process.execPath, ['--check', candidate], cwd, { timeoutMs: RUN_TIMEOUT_MS });
  }
  if (extension === '.py') {
    // compile() parses source but never executes its module body or writes pycache.
    const helper = 'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"),sys.argv[1],"exec")';
    return runProcess(process.platform === 'win32' ? 'python' : 'python3', ['-c', helper, candidate], cwd, { timeoutMs: RUN_TIMEOUT_MS });
  }
  if (extension === '.java') {
    return runProcess('javac', ['-proc:none', '-d', cwd, candidate], cwd, { timeoutMs: RUN_TIMEOUT_MS });
  }
  if (extension === '.c') {
    return runProcess('gcc', ['-fsyntax-only', candidate], cwd, { timeoutMs: RUN_TIMEOUT_MS });
  }
  if (extension === '.go') {
    return runProcess('gofmt', ['-e', '-d', candidate], cwd, { timeoutMs: RUN_TIMEOUT_MS });
  }
  throw new Error('No existe un validador sintáctico seguro para este lenguaje.');
}

async function attemptRepair(relativePath) {
  pruneRepairSessions();
  const relative = normalizeRelativePath(relativePath);
  const key = repairKey(relative);
  const failed = failedRuns.get(key);
  if (!failed || failed.expiresAt <= Date.now()) { failedRuns.delete(key); throw new Error('No hay una ejecución fallida reciente para este archivo.'); }
  const run = failed.result;
  if (run.code === 0 || run.timedOut || run.truncated) throw new Error('La ejecución no es elegible para reparación.');
  const { candidate } = await safePath(relative);
  const currentText = await fs.readFile(candidate, 'utf8');
  const digest = contentHash(currentText);
  const engineSessionId = crypto.randomBytes(16).toString('hex');
  const error = `${run.stderr || ''}\n${run.stdout || ''}`.trim();
  const ext = path.extname(candidate).toLowerCase();
  const proposals = repairEngine.analyze({ text: currentText, error, syntaxDiagnostic: error, language: ext.slice(1), sessionId: engineSessionId });
  if (!proposals.length) throw new Error('No se encontró una propuesta local segura para este error.');
  const proposal = proposals[0];
  if (!repairEngine.validate(currentText, proposal)) throw new Error('La propuesta no coincide con el archivo actual.');
  const proposedText = currentText.slice(0, proposal.start) + proposal.replacement + currentText.slice(proposal.end);
  const tempRoot = await fs.realpath(os.tmpdir());
  const shadow = path.join(tempRoot, `helix-repair-${crypto.randomBytes(16).toString('hex')}`);
  await fs.mkdir(shadow, { mode: 0o700 });
  let verification;
  try {
    const shadowFile = path.join(shadow, path.basename(candidate));
    await fs.writeFile(shadowFile, proposedText, { flag: 'wx', mode: 0o600 });
    verification = await validateSyntaxCandidate(shadowFile, ext, shadow);
  } catch (error) {
    repairEngine.clearSession(engineSessionId);
    throw error;
  } finally { await fs.rm(shadow, { recursive: true, force: true }); }
  if (!verification || verification.code !== 0 || verification.timedOut || verification.truncated) {
    repairEngine.clearSession(engineSessionId);
    return { proposal: { id: proposal.id, rule: proposal.rule, explanation: proposal.explanation, expectedText: proposal.expectedText, replacement: proposal.replacement }, verified: false,
      verification: { code: verification?.code ?? null, timedOut: Boolean(verification?.timedOut), truncated: Boolean(verification?.truncated), stdout: verification?.stdout || '', stderr: verification?.stderr || '' } };
  }
  const id = crypto.randomBytes(16).toString('hex');
  repairSessions.set(id, { engineSessionId, proposal, relative, workspace: workspaceRoot, hash: digest, proposedText, expiresAt: Date.now() + REPAIR_TTL_MS });
  return { id, proposal: { id: proposal.id, rule: proposal.rule, explanation: proposal.explanation, expectedText: proposal.expectedText, replacement: proposal.replacement }, verified: true,
    verification: { code: verification.code, stdout: verification.stdout, stderr: verification.stderr } };
}

async function applyRepair(id) {
  pruneRepairSessions();
  const session = repairSessions.get(id);
  if (!session || session.expiresAt <= Date.now()) { cleanupRepairSession(id); throw new Error('La propuesta expiró o ya fue descartada.'); }
  if (session.workspace !== workspaceRoot || !repairEngine.validate(session.proposedText, { ...session.proposal, start: session.proposal.start, end: session.proposal.start + session.proposal.replacement.length, expectedText: session.proposal.replacement })) {
    cleanupRepairSession(id); throw new Error('La propuesta ya no es válida.');
  }
  const { candidate } = await safePath(session.relative);
  const currentText = await fs.readFile(candidate, 'utf8');
  if (contentHash(currentText) !== session.hash || !repairEngine.validate(currentText, session.proposal)) {
    cleanupRepairSession(id); throw new Error('El archivo cambió desde que se generó la propuesta.');
  }
  await safeWriteFile(candidate, session.proposedText);
  repairEngine.recordExecution(session.engineSessionId, session.proposal, currentText);
  cleanupRepairSession(id);
  failedRuns.delete(repairKey(session.relative));
  return { applied: true };
}

function discardRepair(id) {
  cleanupRepairSession(id);
  return { discarded: true };
}

function findLocalUrls(text) {
  const matches = text.match(/https?:\/\/[^\s"'<>`]+/gi) || [];
  const urls = [];
  for (const match of matches) {
    const candidate = match.replace(/[),.;\]}]+$/g, '');
    try { const url = validateLocalUrl(candidate).href; if (!urls.includes(url)) urls.push(url); } catch { /* external URLs are not surfaced as actions */ }
  }
  return urls.slice(0, 20);
}

app.whenReady().then(() => {
  installIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
