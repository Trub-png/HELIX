const files={
  'App.tsx':`import { useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';

export default function App() {
  const [activeProject, setActiveProject] = useState('orbital');
  const workspace = useMemo(() => ({ name: 'Orbital', environment: 'development' }), []);
  return (<main className="app-shell"><Sidebar project={activeProject} onChange={setActiveProject} /><Dashboard workspace={workspace} /></main>);
}`,
  'Dashboard.tsx':`export function Dashboard({ workspace }) {
  console.log('Dashboard loaded');
  return <section>{workspace.name}</section>;
}`,
  'Sidebar.tsx':`export function Sidebar({ project, onChange }) {
  return <aside>Proyecto: {project}</aside>;
}`,
  'Arbol.java':`public class Arbol {
    public static void main(String[] args) {
        ArbolBinario<Integer> unArbol = new ArbolBinario();
        unArbol.setRaiz(unArbol.insertar(unArbol.getRaiz(), 17));
        unArbol.inserar(unArbol.getRaiz(), 17);
    }
}

public class ArbolBinario<T> {
    public <any> getRaiz() { return raiz; }
}`,
  'theme.css':`:root { --accent: #a78bfa; --surface: #17191e !important; }`,
  'package.json':`{ "name": "orbital-app", "private": true }`
};
const tree=[['folder','⌄','src',''],['folder indent','⌄','components',''],['file indent2','◆','Sidebar.tsx','ts'],['folder indent','⌄','pages',''],['file indent2','◆','Dashboard.tsx','ts'],['file indent','◆','App.tsx','ts'],['file indent','☕','Arbol.java','java'],['file indent','#','theme.css','css'],['file','{}','package.json','json'],['file','ⓘ','README.md','']];
let activeFile='App.tsx',openFiles=['App.tsx','Dashboard.tsx'],findings=[],workspaceHandle=null,fileHandles=new Map(),dirtyFiles=new Set();
const editor=document.querySelector('#editor'), lineNumbers=document.querySelector('#line-numbers');
const editorWrap=editor.closest('.editor-wrap');
let codeView=document.querySelector('#code-view');
if(!codeView){codeView=document.createElement('pre');codeView.id='code-view';codeView.className='code-view';codeView.setAttribute('aria-hidden','true');editorWrap.insertBefore(codeView,editor);}
let minimapContent=document.querySelector('#minimap-content');
if(!minimapContent){minimapContent=document.createElement('div');minimapContent.id='minimap-content';document.querySelector('.minimap')?.prepend(minimapContent);}
const lineOf=(t,i)=>t.slice(0,i).split('\n').length;
const finding=(file,text,index,severity,title,explanation,lesson)=>({file,line:lineOf(text,index),severity,title,explanation,lesson});
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
function tokenizeLine(line,filename){
  const ext=filename.split('.').pop().toLowerCase();
  const keywords=ext==='java'?'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits':
    ext==='py'?'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield':
    ext==='css'||ext==='scss'?'important inherit initial unset var':
    'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while yield true false null undefined interface type enum implements public private protected readonly abstract package';
  const keywordSet=new Set(keywords.split(/\s+/));
  const tokenRx=/(\/\/.*|#.*|\/\*.*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(===|!==|=>|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|[{}()[\].,;:+*%<>=!?&|^~\/-])/g;
  let out='',last=0,match;
  while((match=tokenRx.exec(line))){out+=escapeHtml(line.slice(last,match.index));const token=match[0];let cls='';if(match[1])cls='tok-comment';else if(match[2])cls='tok-string';else if(match[3])cls='tok-number';else if(match[4])cls=keywordSet.has(token)?'tok-keyword':/^[A-Z]/.test(token)?'tok-type':'tok-identifier';else cls='tok-operator';out+=`<span class="${cls}">${escapeHtml(token)}</span>`;last=match.index+token.length;}
  return out+escapeHtml(line.slice(last));
}
function renderCode(){
  if(!editor||!codeView)return;
  const rows=editor.value.split('\n'), errorLines=new Set(findings.filter(item=>item.file===activeFile&&item.severity==='error').map(item=>item.line));
  codeView.innerHTML=rows.map((line,index)=>`<span class="code-line${errorLines.has(index+1)?' code-error-line':''}">${tokenizeLine(line,activeFile)}${line?'':'\u200b'}</span>`).join('\n')+'\n';
  if(minimapContent){const max=180;minimapContent.innerHTML=activeFile?rows.slice(0,max).map((line,index)=>`<span class="minimap-code-line${errorLines.has(index+1)?' minimap-error':''}">${tokenizeLine(line,activeFile)||'\u200b'}</span>`).join(''):'<span class="minimap-empty">Sin archivo</span>';}
}
const fileIcon=name=>name.endsWith('.java')?'☕':name.endsWith('.json')?'{}':name.endsWith('.css')?'#':'◆';
const fileColor=name=>name.endsWith('.java')?'java':name.endsWith('.css')?'css':name.endsWith('.json')?'json':name.endsWith('.ts')||name.endsWith('.tsx')?'ts':'';
const languageFor=name=>name.endsWith('.java')?'Java':name.endsWith('.tsx')?'TypeScript React':name.endsWith('.ts')?'TypeScript':name.endsWith('.js')?'JavaScript':name.endsWith('.css')?'CSS':name.endsWith('.json')?'JSON':'Texto';
const setStatus=(text,kind='')=>{const el=document.querySelector('#save-status');el.textContent=text;el.dataset.kind=kind;};
const desktop=window.helixDesktop||null;
let repairSession=null,repairFailedFile='';
const repairEls={button:document.querySelector('#repair-once'),status:document.querySelector('#repair-status'),details:document.querySelector('#repair-details'),proposal:document.querySelector('#repair-proposal'),evidence:document.querySelector('#repair-evidence'),apply:document.querySelector('#repair-apply'),discard:document.querySelector('#repair-discard')};
function resetRepair(message='La propuesta temporal se limpió.'){if(repairSession?.id&&desktop?.discardRepair)desktop.discardRepair(repairSession.id).catch(()=>{});repairSession=null;repairFailedFile='';if(repairEls.details)repairEls.details.hidden=true;if(repairEls.apply)repairEls.apply.disabled=true;if(repairEls.discard)repairEls.discard.disabled=true;if(repairEls.button){repairEls.button.disabled=false;repairEls.button.textContent='Proponer reparación';}if(repairEls.status)repairEls.status.textContent=message;}
function noteRuntimeFailure(file){resetRepair('Ejecución fallida. Puedes solicitar una propuesta local de reparación.');repairFailedFile=file;if(repairEls.button){repairEls.button.disabled=false;repairEls.button.textContent='Reparar una vez';}}
if(repairEls.status&&!desktop)repairEls.status.textContent='La reparación en carpeta temporal está disponible en la aplicación de escritorio.';
if(repairEls.button)repairEls.button.addEventListener('click',async()=>{
  if(!desktop?.attemptRepair){if(repairEls.status)repairEls.status.textContent='La reparación en carpeta temporal está disponible en la aplicación de escritorio.';return;}
  if(!repairFailedFile||repairFailedFile!==activeFile){repairEls.status.textContent='Ejecuta primero este archivo y vuelve a intentarlo después de un error.';return;}
  if(dirtyFiles.has(activeFile)){repairEls.status.textContent='Guarda los cambios y vuelve a ejecutar el archivo antes de repararlo.';return;}
  if(!confirm(`Helix analizará el fallo de sintaxis de ${activeFile} y, si encuentra una corrección local pequeña, validará UNA copia temporal con el parser o compilador del lenguaje. No ejecutará tu programa, ni guardará o aplicará cambios sin tu aprobación posterior. ¿Validar propuesta?`))return;
  repairEls.button.disabled=true;repairEls.status.textContent='Analizando el error y validando una propuesta sintáctica temporal…';repairEls.details.hidden=true;
  try{
    const result=await desktop.attemptRepair(activeFile);
    repairSession=result?.verified&&result.id?{id:result.id,file:activeFile}:null;
    const proposal=result?.proposal||{};repairEls.proposal.textContent=[proposal.explanation,proposal.rule?`Regla: ${proposal.rule}`:'',proposal.replacement!==undefined?`Cambio: ${proposal.expectedText||'∅'} → ${proposal.replacement}`:''].filter(Boolean).join('\n')||'No se encontró una propuesta aplicable.';
    const verification=result?.verification||{};repairEls.evidence.textContent=result?.verified?`La validación sintáctica temporal terminó correctamente (código ${verification.code}).${verification.stdout?`\n${verification.stdout}`:''}${verification.stderr?`\n${verification.stderr}`:''}`:`La propuesta no superó la validación sintáctica (código ${verification.code??'desconocido'}).${verification.stderr?`\n${verification.stderr}`:''}`;
    repairEls.details.hidden=false;repairEls.apply.disabled=!repairSession;repairEls.discard.disabled=!repairSession;
    repairEls.status.textContent=result?.verified?'La propuesta pasó la validación sintáctica. Revisa el cambio y aplícala si estás de acuerdo.':'La propuesta no pasó la validación sintáctica y no se aplicará al archivo.';
    repairEls.button.textContent='Reintentar propuesta';
  }catch(error){repairEls.status.textContent=error.message||'No se pudo proponer una reparación segura.';repairEls.button.textContent='Reintentar propuesta';}
  finally{repairEls.button.disabled=false;}
});
repairEls.apply?.addEventListener('click',async()=>{
  if(!repairSession?.id||repairSession.file!==activeFile||dirtyFiles.has(activeFile))return;
  repairEls.apply.disabled=true;repairEls.status.textContent='Aplicando la propuesta verificada…';
  if(!confirm('Aplicar esta propuesta modificará el archivo original en disco. La copia temporal ya pasó la validación sintáctica; revisa el cambio y confirma para continuar.')){repairEls.apply.disabled=false;return;}
  try{await desktop.applyRepair(repairSession.id);const file=repairSession.file;const updated=await desktop.readFile(file);files[file]=updated;dirtyFiles.delete(file);repairSession=null;repairFailedFile='';openFile(file,false);analyzeProject();repairEls.details.hidden=true;repairEls.discard.disabled=true;repairEls.button.disabled=true;repairEls.button.textContent='Reparación aplicada';repairEls.status.textContent='Cambio aplicado y cargado en el editor. Ejecuta de nuevo para comprobar el archivo original.';setStatus('Reparación aplicada');}
  catch(error){repairEls.status.textContent=error.message||'No se pudo aplicar la propuesta.';repairEls.apply.disabled=false;}
});
repairEls.discard?.addEventListener('click',()=>resetRepair('Propuesta descartada. El archivo original sigue intacto.'));
function showOutput(message){const panel=document.querySelector('#output-content');if(panel)panel.textContent=typeof message==='string'?message:JSON.stringify(message,null,2);}
function setTerminalState(text,state=''){const el=document.querySelector('#terminal-state');if(el){el.textContent=text;el.dataset.state=state;}}
function findLoopbackUrl(text){const matches=String(text||'').match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?(?:[^\s"'<>]*)?/ig)||[];return matches.find(value=>{try{const url=new URL(value);return ['localhost','127.0.0.1'].includes(url.hostname.toLowerCase())&&url.port<=65535;}catch{return false;}})||'';}
function offerLocalPreview(text){const link=document.querySelector('#local-preview');if(!link)return;const url=findLoopbackUrl(text);link.hidden=!url;if(url){link.href=url;link.dataset.url=url;link.textContent=`↗ Abrir ${new URL(url).host}`;}}
function normalizeFileEntry(entry){if(typeof entry==='string')return entry.replaceAll('\\','/');if(entry&&typeof entry==='object')return String(entry.path||entry.relativePath||entry.name||'').replaceAll('\\','/');return '';}
function setEmptyWorkspace(visible){
  const empty=document.querySelector('#empty-workspace');if(empty)empty.classList.toggle('visible',visible);
  document.querySelector('#file-tree')?.classList.toggle('is-empty',visible);
}
function showExtensions(){
  const registry=window.HelixExtensions?.createRegistry(window.HelixExtensions.builtIns);const list=registry?.list()||[];
  document.querySelector('#panel-title').textContent='EXTENSIONES';
  document.querySelector('#file-tree').innerHTML=list.map(item=>`<div class="extension-card"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.id)} · v${escapeHtml(item.version)}</span><small>${escapeHtml(item.languages.join(', '))}</small></div>`).join('')||'<p class="empty-note">No hay extensiones registradas.</p>';
  document.querySelector('#outline-content').innerHTML='<div class="outline-item">Crea un manifiesto JSON local y regístralo; Helix no ejecuta scripts de extensiones sin permisos.</div>';
}
function balanced(file,text){const stack=[],pairs={')':'(',']':'[','}':'{' };let quote='';for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c===quote&&text[i-1]!=='\\')quote='';continue}if(`'\"\``.includes(c)){quote=c;continue}if('([{'.includes(c))stack.push({c,i});else if(pairs[c]){const prev=stack.pop();if(!prev||prev.c!==pairs[c])return finding(file,text,i,'error',`El símbolo “${c}” no tiene una apertura compatible.`,'Los delimitadores agrupan instrucciones. Revisa el bloque cercano y equilibra sus símbolos.','Estructura del código')}}if(stack.length){const prev=stack.at(-1);return finding(file,text,prev.i,'error',`Falta cerrar “${prev.c}”.`,'Un bloque quedó abierto. Añade el delimitador de cierre correspondiente.','Estructura del código')}}
function analyze(file,text){const result=[],bad=balanced(file,text);if(bad)result.push(bad);if(file.endsWith('.json')){try{JSON.parse(text)}catch{result.push(finding(file,text,0,'error','JSON inválido.','La configuración debe respetar comas, comillas y llaves.','Configuración'))}return result}const rules=[[/([^=]|^)==(?!=)/g,'warn','Usa comparación estricta (===).','La comparación flexible convierte tipos automáticamente; eso puede ocultar errores.','Comparaciones seguras'],[/\bconsole\.log\s*\(/g,'info','Registro de depuración encontrado.','Es útil mientras desarrollas, pero retíralo o usa un logger antes de publicar.','Código listo para producción'],[/\bany\b/g,'warn','El tipo any elimina protecciones.','Describe la forma esperada del dato para que TypeScript encuentre fallos antes de ejecutar.','Tipos útiles'],[/\bTODO\b/g,'info','Tarea pendiente marcada.','Convierte este recordatorio en una tarea concreta antes de terminar el cambio.','Mantenimiento'],[/!important/g,'warn','Evita !important si es posible.','Rompe la prioridad normal de CSS y hace más difícil mantener los estilos.','Cascada de CSS'],[/\bvar\s+/g,'warn','Prefiere const o let en lugar de var.','const evita reasignaciones accidentales y let mantiene el alcance dentro del bloque.','Variables modernas'],[/\bdebugger\b/g,'warn','Punto de interrupción olvidado.','debugger pausará la aplicación si las herramientas del navegador están abiertas.','Depuración']];rules.forEach(([rx,severity,title,explanation,lesson])=>{if(file.endsWith('.java')&&title==='El tipo any elimina protecciones.')return;for(const m of text.matchAll(rx))result.push(finding(file,text,m.index,severity,title,explanation,lesson))});if(file.endsWith('.tsx')&&/export function \w+\(\{[^}]+\}\)\s*\{/.test(text))result.push(finding(file,text,text.indexOf('export function'),'info','Considera tipar las propiedades del componente.','Las props sin tipo permiten recibir valores inesperados. Declara una interfaz para documentar y validar lo que necesita el componente.','Contratos de componentes'));if(file.endsWith('.java')){const publics=[...text.matchAll(/public\s+class\s+\w+/g)];if(publics.length>1)result.push(finding(file,text,publics[1].index,'error','Hay más de una clase pública en este archivo.','Java exige que cada clase pública viva en un archivo cuyo nombre coincida con la clase.','Organización de Java'));for(const m of text.matchAll(/public\s+<\s*any\s*>/g))result.push(finding(file,text,m.index,'error','El tipo <any> no existe en Java.','Un método genérico declara un tipo real, como <T>; para la raíz del árbol el retorno debería ser Nodo<T>.','Genéricos en Java'));for(const m of text.matchAll(/new\s+\w+\s*\(\s*\)/g))result.push(finding(file,text,m.index,'warn','Instanciación sin tipo genérico.','Usa el operador diamante, por ejemplo new ArbolBinario<>(), para conservar la seguridad de tipos.','Genéricos en Java'));for(const m of text.matchAll(/\.inserar\s*\(/g))result.push(finding(file,text,m.index,'warn','Posible error tipográfico: inserar.','El método habitual se llama insertar. Si no existe un método llamado inserar, el compilador no podrá resolverlo.','Lectura de errores del compilador'))}return result}
function analyzeProject(){findings=Object.entries(files).flatMap(([file,text])=>analyze(file,text));renderFindings();renderTrainer()}
function updateLines(){const lines=editor.value.split('\n');lineNumbers.textContent=lines.map((_,i)=>i+1).join('\n');const before=editor.value.slice(0,editor.selectionStart).split('\n');document.querySelector('#line-status').textContent=before.length;document.querySelector('#col-status').textContent=before.at(-1).length+1;renderCode()}
let selectedPath='';
function renderTree(){document.querySelector('#file-tree').innerHTML=tree.map(([kind,icon,name,color,depth=0])=>`<button class="${kind} ${name===activeFile?'selected':''} ${name===selectedPath?'path-selected':''}" data-file="${files[name]!==undefined?name:''}" data-path="${escapeHtml(name)}" style="padding-left:${6+depth*18}px"><span class="file-icon ${color}">${icon}</span>${escapeHtml(name.split('/').at(-1))}</button>`).join('')}
function renderTabs(){document.querySelector('#tabs').innerHTML=openFiles.map(name=>`<button class="tab ${name===activeFile?'active':''}" data-tab="${name}"><span class="file-icon ${fileColor(name)}">${fileIcon(name)}</span>${escapeHtml(name.split('/').at(-1))}${dirtyFiles.has(name)?' •':''}<span class="tab-close" data-close="${name}">×</span></button>`).join('')}
function renderOutline(){const items=activeFile==='App.tsx'?['App','activeProject','workspace']:activeFile==='Dashboard.tsx'?['Dashboard','workspace']:['Archivo abierto'];document.querySelector('#outline-content').innerHTML=items.map(x=>`<div class="outline-item"><span class="outline-symbol">◇</span>${x}</div>`).join('')}
function renderFindings(){const visible=findings.filter(x=>x.file===activeFile),root=document.querySelector('#problems'),errors=findings.filter(x=>x.severity==='error').length,warnings=findings.filter(x=>x.severity==='warn').length;document.querySelector('#problem-count').textContent=findings.length;document.querySelector('#error-count').textContent=errors;document.querySelector('#warning-count').textContent=warnings;root.innerHTML=visible.length?visible.map(x=>`<article class="problem"><span class="${x.severity}">${x.severity==='error'?'●':x.severity==='warn'?'▲':'◆'}</span><div><div class="problem-title">${escapeHtml(x.title)} <i class="location">${escapeHtml(x.file)}:${x.line}</i></div><div class="problem-explanation">${escapeHtml(x.explanation)}</div></div><button class="go-line" data-issue="${findings.indexOf(x)}">Ver línea</button></article>`).join(''):'<div class="problem"><span class="info">◆</span><div><div class="problem-title">No hay hallazgos en este archivo.</div><div class="problem-explanation">Edita el archivo y vuelve a analizar el proyecto.</div></div></div>';renderCode()}
function renderTrainer(){const errors=findings.filter(x=>x.severity==='error').length,warnings=findings.filter(x=>x.severity==='warn').length,score=Math.max(45,100-errors*20-warnings*8),next=findings.find(x=>x.severity!=='info')||findings[0];document.querySelector('#trainer').innerHTML=`<div class="trainer-grid"><div class="trainer-score">${score}<small>/100</small></div><div><div class="trainer-title">Tu siguiente lección: ${next?.lesson||'Proyecto limpio'}</div><div class="trainer-copy">${next?next.explanation:'Buen trabajo: el analizador no encontró patrones de riesgo en los archivos actuales.'}</div></div><span class="lesson-chip">${findings.length} hallazgo${findings.length===1?'':'s'}</span></div>`}
function openFile(name,focus=true){if(files[name]===undefined)return;if(name!==activeFile&&repairSession)resetRepair('Al cambiar de archivo, la propuesta temporal se descartó.');if(!openFiles.includes(name))openFiles.push(name);activeFile=name;editor.value=files[name];document.querySelector('#breadcrumbs').innerHTML=`${workspaceHandle?.name||'ejemplo'} <span>/</span> ${escapeHtml(name)}`;document.querySelector('#language-status').textContent=languageFor(name);renderTree();renderTabs();renderOutline();renderFindings();updateLines();if(focus)editor.focus()}
function jumpTo(i){const x=findings[i];if(!x)return;openFile(x.file);const lines=editor.value.split('\n'),p=lines.slice(0,x.line-1).join('\n').length+(x.line>1?1:0);editor.setSelectionRange(p,p+lines[x.line-1].length);updateLines()}
document.querySelector('#file-tree').addEventListener('click',e=>{const row=e.target.closest('[data-path]');if(!row)return;selectedPath=row.dataset.path;renderTree();if(row.dataset.file)openFile(row.dataset.file)});document.querySelector('#tabs').addEventListener('click',e=>{const close=e.target.dataset.close,name=e.target.closest('[data-tab]')?.dataset.tab;if(close){openFiles=openFiles.filter(x=>x!==close);if(activeFile===close)activeFile=openFiles.at(-1)||'';if(activeFile)openFile(activeFile)}else if(name)openFile(name)});editor.addEventListener('input',()=>{if(!activeFile)return;files[activeFile]=editor.value;dirtyFiles.add(activeFile);setStatus('Cambios sin guardar','dirty');renderTabs();updateLines()});editor.addEventListener('keyup',updateLines);editor.addEventListener('click',updateLines);editor.addEventListener('scroll',()=>{codeView.scrollTop=editor.scrollTop;codeView.scrollLeft=editor.scrollLeft;lineNumbers.scrollTop=editor.scrollTop});document.querySelector('.minimap')?.addEventListener('click',event=>{const box=event.currentTarget.getBoundingClientRect(),ratio=(event.clientY-box.top)/box.height;editor.scrollTop=ratio*Math.max(0,editor.scrollHeight-editor.clientHeight)});document.querySelector('#command-search').addEventListener('input',e=>{const f=Object.keys(files).find(x=>x.toLowerCase().includes(e.target.value.toLowerCase()));if(e.target.value&&f)openFile(f,false)});document.querySelectorAll('.activity').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.activity').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(b.dataset.panel==='extensions')showExtensions();else{document.querySelector('#panel-title').textContent=b.title.toUpperCase();document.querySelector('#search-panel').hidden=b.dataset.panel!=='search';document.querySelector('.project-starter[aria-label="Crear proyecto"]').hidden=b.dataset.panel==='search';renderTree();if(b.dataset.panel==='search')document.querySelector('#project-search').focus();}}));document.querySelector('#analyze-project').addEventListener('click',analyzeProject);document.querySelector('#ai-fix').addEventListener('click',()=>{analyzeProject();document.querySelector('#trainer-tab').click()});document.querySelector('#problems').addEventListener('click',e=>{if(e.target.dataset.issue!==undefined)jumpTo(e.target.dataset.issue)});document.querySelector('#trainer-tab').addEventListener('click',e=>{e.currentTarget.classList.add('selected');document.querySelector('.panel-tabs button:first-child').classList.remove('selected');document.querySelector('#problems').hidden=true;document.querySelector('#trainer').hidden=false});document.querySelector('.panel-tabs button:first-child').addEventListener('click',e=>{e.currentTarget.classList.add('selected');document.querySelector('#trainer-tab').classList.remove('selected');document.querySelector('#problems').hidden=false;document.querySelector('#trainer').hidden=true});
async function readWorkspace(folder,prefix='',depth=0){
  for await(const [name,handle] of folder.entries()){
    const path=prefix?`${prefix}/${name}`:name;
    if(handle.kind==='directory'){
      if(depth>=7||['.git','node_modules','dist','build','target','.idea','.vscode'].includes(name))continue;
      tree.push(['folder','⌄',path,'',depth]);await readWorkspace(handle,path,depth+1);continue;
    }
    if(handle.kind!=='file'||handle.name.startsWith('.'))continue;
    if(!/\.(java|kt|kts|js|jsx|ts|tsx|css|scss|html|htm|json|md|txt|xml|yml|yaml|py|c|h|cpp|hpp|cs|go|rs|php|sql|sh|properties|gradle)$/i.test(name))continue;
    const file=await handle.getFile();if(file.size>1024*1024)continue;
    try{files[path]=await file.text();fileHandles.set(path,handle);tree.push(['file',fileIcon(name),path,fileColor(name),depth]);}catch{ /* archivo no legible como texto */ }
  }
}
async function getDirectoryHandle(path,create=false){
  const parts=path.split('/').filter(Boolean);let current=workspaceHandle;
  for(const part of parts)current=await current.getDirectoryHandle(part,{create});
  return current;
}
async function createWorkspaceFile(path){
  if(desktop){
    const clean=path.trim().replaceAll('\\','/');
    if(!clean||clean.startsWith('/')||clean.split('/').some(part=>!part||part==='.'||part==='..')){setStatus('Ruta de archivo no válida','error');return;}
    if(files[clean]!==undefined){openFile(clean);setStatus('Ese archivo ya existe','error');return;}
    try{await desktop.createFile(clean);files[clean]='';dirtyFiles.delete(clean);tree.push(['file',fileIcon(clean),clean,fileColor(clean),clean.split('/').length-1]);setEmptyWorkspace(false);openFile(clean);setStatus('Archivo creado');return;}catch(error){setStatus(error.message||'No se pudo crear el archivo','error');return;}
  }
  if(!workspaceHandle){setStatus('Abre una carpeta antes de crear archivos','error');return;}
  const clean=path.trim().replaceAll('\\','/');
  if(!clean||clean.startsWith('/')||clean.split('/').some(part=>!part||part==='.'||part==='..')){setStatus('Ruta de archivo no válida','error');return;}
  if(files[clean]!==undefined){openFile(clean);setStatus('Ese archivo ya existe','error');return;}
  try{
    const parts=clean.split('/'),name=parts.pop(),parent=parts.length?await getDirectoryHandle(parts.join('/'),true):workspaceHandle;
    const handle=await parent.getFileHandle(name,{create:true}),writer=await handle.createWritable();await writer.write('');await writer.close();
    files[clean]='';fileHandles.set(clean,handle);dirtyFiles.delete(clean);
    const depth=parts.length; if(depth)tree.push(['folder','⌄',parts.at(-1),'',depth-1]);
    tree.push(['file',fileIcon(name),clean,fileColor(name),depth]);setEmptyWorkspace(false);openFile(clean);setStatus('Archivo creado');
  }catch(error){setStatus(error.name==='NotAllowedError'?'Permiso insuficiente para crear el archivo':'No se pudo crear el archivo','error');}
}
async function openWorkspace(){
  if(desktop){
    try{
      setStatus('Abriendo proyecto…');const workspace=await desktop.chooseWorkspace();
      if(!workspace)return;
      workspaceHandle=workspace;fileHandles.clear();dirtyFiles.clear();tree.splice(0);Object.keys(files).forEach(key=>delete files[key]);
      const listing=await desktop.listFiles();const entries=Array.isArray(listing)?listing:(listing?.files||[]);const paths=entries.filter(entry=>!entry||typeof entry!=='object'||entry.kind!=='directory').map(normalizeFileEntry).filter(Boolean);
      for(const path of paths){if(!/\.(java|kt|kts|js|jsx|ts|tsx|css|scss|html|htm|json|md|txt|xml|yml|yaml|py|c|h|cpp|hpp|cs|go|rs|php|sql|sh|properties|gradle)$/i.test(path))continue;try{files[path]=await desktop.readFile(path);}catch{/* Ignora archivos que cambiaron o no son texto */}}
      const dirs=new Set();for(const path of Object.keys(files)){const parts=path.split('/');parts.pop();let depth=0,partial='';for(const part of parts){partial=partial?`${partial}/${part}`:part;if(!dirs.has(partial)){dirs.add(partial);tree.push(['folder','⌄',partial,'',depth]);}depth++;}tree.push(['file',fileIcon(path),path,fileColor(path),parts.length]);}
      const label=workspace.name||workspace.rootName||workspace.path?.split(/[\\/]/).filter(Boolean).at(-1)||'Workspace';
      document.querySelector('#workspace-label').textContent=label.toUpperCase();document.querySelector('#workspace-status').textContent=`⌑ ${label}`;
      openFiles=[];const first=Object.keys(files)[0];setEmptyWorkspace(!first);if(first)openFile(first,false);else{activeFile='';editor.value='';renderTree();renderTabs();renderFindings();renderCode();}
      analyzeProject();setStatus(first?'Proyecto abierto':'Proyecto sin archivos de texto');return;
    }catch(error){setStatus(error.message||'No fue posible abrir el proyecto','error');return;}
  }
  if(!window.showDirectoryPicker){setStatus('Este navegador no permite abrir carpetas','error');return;}
  try{
    setStatus('Abriendo carpeta…');const folder=await window.showDirectoryPicker({mode:'readwrite'});workspaceHandle=folder;fileHandles.clear();dirtyFiles.clear();tree.splice(0);Object.keys(files).forEach(key=>delete files[key]);
    await readWorkspace(folder);document.querySelector('#workspace-label').textContent=folder.name.toUpperCase();document.querySelector('#workspace-status').textContent=`⌑ ${folder.name}`;
    const first=Object.keys(files)[0];openFiles=[];setEmptyWorkspace(!first);if(first)openFile(first,false);else{activeFile='';editor.value='';renderTree();renderTabs();renderFindings();}
    analyzeProject();setStatus(first?'Carpeta lista':'Carpeta sin archivos de texto');
  }catch(error){if(error.name!=='AbortError')setStatus('No fue posible abrir la carpeta','error');}
}
async function saveActiveFile(){
  if(desktop){if(!activeFile)return;try{setStatus('Guardando…');await desktop.writeFile(activeFile,files[activeFile]);dirtyFiles.delete(activeFile);renderTabs();setStatus('Guardado');}catch(error){setStatus(error.message||'No se pudo guardar el archivo','error');}return;}
  const handle=fileHandles.get(activeFile);if(!handle){setStatus('Este archivo de ejemplo no se puede guardar aún','error');return;}
  try{setStatus('Guardando…');const writer=await handle.createWritable();await writer.write(files[activeFile]);await writer.close();dirtyFiles.delete(activeFile);renderTabs();setStatus('Guardado');}catch(error){setStatus(error.name==='NotAllowedError'?'Vuelve a abrir la carpeta para autorizar la escritura':'No se pudo guardar el archivo','error');}
}
async function reloadDesktopFiles(preferred=''){
  if(!desktop?.listFiles||!desktop?.readFile)return;
  const listing=await desktop.listFiles(),entries=Array.isArray(listing)?listing:(listing?.files||[]),paths=entries.filter(entry=>!entry||typeof entry!=='object'||entry.kind!=='directory').map(normalizeFileEntry).filter(Boolean);
  for(const key of Object.keys(files))delete files[key];tree.splice(0);fileHandles.clear();dirtyFiles.clear();
  for(const path of paths){if(!/\.(java|kt|kts|js|jsx|ts|tsx|css|scss|html|htm|json|md|txt|xml|yml|yaml|py|c|h|cpp|hpp|cs|go|rs|php|sql|sh|properties|gradle)$/i.test(path))continue;try{files[path]=await desktop.readFile(path);}catch{/* Archivo cambiado o no legible */}}
  const dirs=new Set();for(const path of Object.keys(files)){const parts=path.split('/');parts.pop();let depth=0,partial='';for(const part of parts){partial=partial?`${partial}/${part}`:part;if(!dirs.has(partial)){dirs.add(partial);tree.push(['folder','⌄',partial,'',depth]);}depth++;}tree.push(['file',fileIcon(path),path,fileColor(path),parts.length]);}
  const target=preferred&&files[preferred]!==undefined?preferred:Object.keys(files)[0];openFiles=[];setEmptyWorkspace(!target);if(target)openFile(target,false);else{activeFile='';editor.value='';renderTree();renderTabs();renderFindings();renderCode();}analyzeProject();
}
async function loadTemplates(){
  const menu=document.querySelector('#template-menu');if(!menu||typeof desktop?.listTemplates!=='function')return;
  try{const result=await desktop.listTemplates(),items=Array.isArray(result)?result:(result?.templates||[]);if(!items.length)return;menu.innerHTML='<option value="">Elige una plantilla…</option>'+items.map(item=>{const id=typeof item==='string'?item:(item.id||item.name||'');const label=typeof item==='string'?item:(item.label||item.name||id);return id?`<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`:''}).join('');menu.addEventListener('change',async()=>{const id=menu.value;if(!id)return;const item=items.find(candidate=>(typeof candidate==='string'?candidate:(candidate.id||candidate.name||''))===id);const extensions=item&&typeof item==='object'&&Array.isArray(item.extensions)?item.extensions.join(', '):'la extensión correspondiente';const filePath=prompt(`Ruta del archivo inicial (${extensions}), por ejemplo proyectos/main${item?.extensions?.[0]||'.txt'}:`);if(!filePath?.trim()){menu.value='';return;}if(!desktop?.createTemplate){setStatus('La creación de plantillas no está disponible','error');menu.value='';return;}try{setStatus('Creando archivo…');const created=await desktop.createTemplate(id,filePath.trim());await reloadDesktopFiles(created?.entryFile||filePath.trim());setStatus('Archivo creado desde plantilla');}catch(error){setStatus(error.message||'No se pudo crear el archivo','error');}finally{menu.value='';}});}catch(error){setStatus(error.message||'No se pudieron cargar las plantillas','error');}
}
async function refreshRuntimeAvailability(){
  if(!desktop||typeof desktop.getRuntimeAvailability!=='function')return;
  const state=document.querySelector('#terminal-state');try{const result=await desktop.getRuntimeAvailability();const items=Array.isArray(result)?result:(result?.runtimes||[]);if(!items.length)return;const unavailable=items.filter(item=>!item.available).map(item=>item.label||item.id);if(state&&unavailable.length)state.title=`Runtime no disponibles: ${unavailable.join(', ')}`;}catch{/* Runtime probe opcional */}
}
document.querySelector('#open-folder').addEventListener('click',openWorkspace);document.querySelector('#empty-open-folder')?.addEventListener('click',openWorkspace);document.querySelector('#save-file').addEventListener('click',saveActiveFile);
document.querySelector('#new-file').addEventListener('click',async()=>{
  if(!workspaceHandle){
    await openWorkspace();
    if(!workspaceHandle)return;
  }
  const path=prompt('Nombre del archivo (puedes indicar una ruta, por ejemplo src/Main.java):');
  if(path)await createWorkspaceFile(path);
});
const searchInput=document.querySelector('#project-search'),searchResults=document.querySelector('#search-results'),searchStatus=document.querySelector('#search-status');
function runProjectSearch(){const query=searchInput.value.trim();searchResults.replaceChildren();if(!query){searchStatus.textContent='Escribe para buscar en los archivos de texto cargados.';return;}let count=0;for(const [path,content] of Object.entries(files)){const lines=String(content).split('\n');lines.forEach((line,index)=>{let at=-1;while((at=line.toLocaleLowerCase().indexOf(query.toLocaleLowerCase(),at+1))!==-1){count++;if(count>300)return;const button=document.createElement('button');button.type='button';button.className='search-result';button.dataset.file=path;button.dataset.line=String(index+1);const title=document.createElement('strong');title.textContent=`${path}:${index+1}`;const context=document.createElement('span');context.textContent=line.trim()||' ';button.append(title,context);searchResults.append(button);}});if(count>300)break;}searchStatus.textContent=count?`${Math.min(count,300)} coincidencias${count>300?' (límite de 300 resultados)':''}`:'No se encontraron coincidencias en los archivos cargados.';}
searchInput.addEventListener('input',runProjectSearch);searchResults.addEventListener('click',event=>{const result=event.target.closest('[data-file]');if(!result)return;openFile(result.dataset.file);const line=Number(result.dataset.line),lines=editor.value.split('\n'),start=lines.slice(0,line-1).join('\n').length+(line>1?1:0);editor.focus();editor.setSelectionRange(start,start+(lines[line-1]||'').length);updateLines();});
function validRelativePath(value){const path=value.trim().replaceAll('\\','/');return path&&!path.startsWith('/')&&!path.split('/').some(part=>!part||part==='.'||part==='..')?path:'';}
async function mutatePath(action,oldPath,newPath=''){if(desktop){const method={createFolder:'createFolder',rename:'moveFile',delete:'deleteFile'}[action];if(typeof desktop[method]!=='function'){setStatus(`Esta acción no está disponible: falta la API ${method} de escritorio.`,'error');return false;}if(action==='createFolder')await desktop.createFolder(oldPath);if(action==='rename')await desktop.moveFile(oldPath,newPath);if(action==='delete')await desktop.deleteFile(oldPath);await reloadDesktopFiles(action==='rename'?newPath:'');return true;}if(!workspaceHandle){setStatus('Abre una carpeta con permisos de escritura para administrar archivos.','error');return false;}try{if(action==='createFolder'){let parent=workspaceHandle;for(const part of oldPath.split('/'))parent=await parent.getDirectoryHandle(part,{create:true});}else{if(typeof workspaceHandle.getDirectoryHandle!=='function'){setStatus('La administración de archivos no está disponible en este navegador.','error');return false;}const source=await getHandleForPath(oldPath);if(action==='delete'){if(source.kind==='directory')await (await getDirectoryHandle(oldPath.split('/').slice(0,-1).join('/'),false)).removeEntry(oldPath.split('/').at(-1),{recursive:true});else await (await getDirectoryHandle(oldPath.split('/').slice(0,-1).join('/'),false)).removeEntry(oldPath.split('/').at(-1));}else{setStatus('Renombrar requiere la API de escritorio moveFile en esta versión.','error');return false;}}Object.keys(files).forEach(key=>delete files[key]);tree.splice(0);await readWorkspace(workspaceHandle);if(action==='createFolder')setStatus('Carpeta creada');else setStatus('Elemento eliminado');renderTree();return true;}catch(error){setStatus(error.message||'No se pudo completar la operación','error');return false;}}
async function getHandleForPath(path){const parts=path.split('/'),leaf=parts.pop(),parent=parts.length?await getDirectoryHandle(parts.join('/'),false):workspaceHandle;try{return await parent.getFileHandle(leaf);}catch{return await parent.getDirectoryHandle(leaf);}}
document.querySelector('#new-folder').addEventListener('click',async()=>{const path=validRelativePath(prompt('Nombre de la carpeta (puedes indicar una ruta, por ejemplo src/components):')||'');if(path)await mutatePath('createFolder',path);});
document.querySelector('#rename-path').addEventListener('click',async()=>{if(!selectedPath){setStatus('Selecciona un archivo o carpeta en el explorador.','error');return;}const path=validRelativePath(prompt(`Nuevo nombre o ruta para ${selectedPath}:`,selectedPath)||'');if(!path||path===selectedPath)return;if(!confirm(`Renombrar o mover “${selectedPath}” a “${path}”?`))return;await mutatePath('rename',selectedPath,path);});
document.querySelector('#delete-path').addEventListener('click',async()=>{if(!selectedPath){setStatus('Selecciona un archivo o carpeta en el explorador.','error');return;}if(!confirm(`Eliminar “${selectedPath}” del proyecto? Esta acción no se puede deshacer.`))return;await mutatePath('delete',selectedPath);});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveActiveFile();}});
async function runProject(){
  if(!desktop){showOutput('Ejecutar scripts Node está disponible en la aplicación de escritorio.');return;}
  let manifest;try{manifest=JSON.parse(files['package.json']||'{}');}catch{showOutput('package.json contiene JSON inválido.');return;}
  const scripts=manifest.scripts||{},names=Object.keys(scripts);
  if(!names.length){
    if(!/\.(js|mjs|cjs)$/i.test(activeFile)||typeof desktop.runNodeFile!=='function'){showOutput('Este package.json no declara scripts y el archivo activo no es JavaScript ejecutable.');return;}
    if(!confirm(`Se ejecutará node ${activeFile} dentro de la carpeta del proyecto. El archivo puede cambiar archivos o usar la red. ¿Continuar?`))return;
    try{setStatus('Ejecutando Node…');const result=await desktop.runNodeFile(activeFile);showOutput([result?.stdout,result?.stderr].filter(Boolean).join('\n')||JSON.stringify(result,null,2));const failed=result?.code!==0;setStatus(failed?'Node terminó con error':'Ejecución finalizada',failed?'error':'');}catch(error){showOutput(error.message||'No se pudo ejecutar Node.');setStatus('Error al ejecutar','error');}return;
  }
  const selection=prompt(`Scripts disponibles:\n${names.map((name,index)=>`${index+1}. ${name} — ${scripts[name]}`).join('\n')}\n\nEscribe el nombre del script:`);
  if(!selection)return;if(!Object.hasOwn(scripts,selection)){showOutput(`No existe el script "${selection}".`);return;}
  if(!confirm(`Se ejecutará npm run ${selection} dentro de la carpeta del proyecto. Los scripts pueden cambiar archivos o usar la red. ¿Continuar?`))return;
  try{setStatus(`Ejecutando ${selection}…`);showOutput(`$ npm run ${selection}\nEjecutando…`);const result=await desktop.runNpmScript(selection);const output=typeof result==='string'?result:[result?.stdout,result?.stderr].filter(Boolean).join('\n')||JSON.stringify(result,null,2);showOutput(output);const failed=typeof result==='object'&&result.code!==0;setStatus(failed?'El script terminó con error':'Ejecución finalizada',failed?'error':'');}
  catch(error){showOutput(error.message||'No se pudo ejecutar el script.');setStatus('Error al ejecutar','error');}
}
async function runActiveRuntimeFile(){
  const run=desktop?.runFile||desktop?.runProjectFile;if(typeof run!=='function'){showOutput(desktop?'La ejecución por runtime no está disponible en esta versión.':'La ejecución de proyectos está disponible en la aplicación de escritorio.');setTerminalState('Runtime no disponible','error');return;}
  if(!activeFile||!workspaceHandle){showOutput('Abre una carpeta y selecciona un archivo ejecutable.');setTerminalState('Sin archivo ejecutable','error');return;}
  try{
    const initialLabel=languageFor(activeFile);
    if(!confirm(`Se comprobará el runtime y se ejecutará ${activeFile} dentro del proyecto. El código puede modificar archivos o usar la red. ¿Continuar?`))return;
    let detected=null;if(typeof desktop.detectRuntime==='function')detected=await desktop.detectRuntime(activeFile);
    const label=detected?.label||detected?.name||detected?.id||initialLabel;
    if(detected?.available===false){showOutput(detected.error||`${label} no está instalado o disponible.`);setTerminalState(`${label} no disponible`,'error');return;}
    if(typeof desktop.getRuntimeAvailability==='function'){
      const availability=await desktop.getRuntimeAvailability();const list=Array.isArray(availability)?availability:(availability?.runtimes||[]);const ext=activeFile.slice(activeFile.lastIndexOf('.')).toLowerCase();const runtime=list.find(item=>item.id===detected?.id||item.extensions?.includes(ext));
      if(runtime?.available===false){showOutput(runtime.error||`${runtime.label||label} no está instalado o disponible.`);setTerminalState(`${runtime.label||label} no disponible`,'error');return;}
    }
    resetRepair('Ejecución iniciada. Si falla, podrás solicitar una propuesta local.');setTerminalState(`Ejecutando ${label}…`,'running');setStatus(`Ejecutando ${label}…`);showOutput(`▶ ${activeFile}\nEjecutando…`);
    const result=await run.call(desktop,activeFile);
    const stdout=typeof result==='string'?result:(result?.stdout||''),stderr=result?.stderr||'',output=[stdout&&`stdout:\n${stdout}`,stderr&&`stderr:\n${stderr}`].filter(Boolean).join('\n\n')||JSON.stringify(result,null,2);
    showOutput(output);offerLocalPreview(`${stdout}\n${stderr}`);
    const failed=typeof result==='object'&&result!==null&&result.code!==undefined&&result.code!==0;setTerminalState(failed?'La ejecución terminó con error':'Ejecución finalizada',failed?'error':'');setStatus(failed?'La ejecución terminó con error':'Ejecución finalizada',failed?'error':'');if(failed&&!result.timedOut&&!result.truncated)noteRuntimeFailure(activeFile);
  }catch(error){showOutput(error.message||'No se pudo ejecutar el archivo.');setTerminalState('Error al ejecutar','error');setStatus('Error al ejecutar','error');offerLocalPreview('');}
}
document.querySelector('#local-preview')?.addEventListener('click',async event=>{
  event.preventDefault();const link=event.currentTarget,url=link.dataset.url||link.href;
  if(!desktop||typeof desktop.openLocalUrl!=='function'){setTerminalState('Abrir URL local requiere la aplicación de escritorio','error');return;}
  try{await desktop.openLocalUrl(url);setTerminalState('Abriendo vista previa');}catch(error){setTerminalState(error.message||'No se pudo abrir la URL local','error');}
});
async function refreshGit(){
  if(!desktop?.getGitStatus){showOutput('El estado de Git está disponible en la aplicación de escritorio.');return;}
  try{const result=await desktop.getGitStatus();const output=typeof result==='string'?result:[result?.stdout,result?.stderr].filter(Boolean).join('\n')||JSON.stringify(result,null,2);showOutput(output);setStatus(result?.available===false?'Git no está disponible':'Estado Git actualizado',result?.available===false?'error':'');}
  catch(error){showOutput(error.message||'No se pudo consultar Git.');setStatus('Error de Git','error');}
}
document.querySelector('#run-project')?.addEventListener('click',runProject);
document.querySelector('#terminal-run')?.addEventListener('click',runActiveRuntimeFile);
loadTemplates();
document.querySelector('#git-refresh')?.addEventListener('click',refreshGit);
document.querySelector('#github-connect')?.addEventListener('click',()=>showOutput('GitHub aún no está conectado. Para acceder a repositorios privados o publicar cambios, primero configura una conexión autorizada de GitHub.'));
Object.keys(files).forEach(key=>delete files[key]);tree.splice(0);openFiles=[];activeFile='';editor.value='';document.querySelector('#workspace-label').textContent='SIN CARPETA ABIERTA';document.querySelector('#workspace-status').textContent='Sin carpeta abierta';document.querySelector('#breadcrumbs').textContent='Abre una carpeta o crea un archivo para empezar';document.querySelector('#language-status').textContent='Texto';setEmptyWorkspace(true);analyzeProject();renderTree();renderTabs();renderCode();
