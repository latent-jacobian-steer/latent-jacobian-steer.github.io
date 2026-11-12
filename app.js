'use strict';
let research, speed=1, galleryTask='hurdle', activeCompare='shutter', activeAssembly='tight_insertion', heroPlaying=!matchMedia('(prefers-reduced-motion: reduce)').matches;
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const captions={hurdle:'Hand-supported hurdle traversal, then standing on the far side.',shutter:'Bimanual shutter lifting, then whole-body traversal.',door_cube:'Carrying a cube to press the handle and push the door open.'};
const assemblyText={tight_insertion:'Both methods stand the peg upright in the hole. Direct goal CEM lifts and seats it within seven seconds; CEM-LJS first slides the peg along the table before lifting it in.',beam_assembly_step1:'Both methods lift the beam, turn it upright, and set it into its slot within a few seconds, with similar motions.',beam_assembly_step2:'Both methods lift the part over the post, lower it into place, and let go.',screwing:'CEM-LJS picks up the leg, sets it on the thread, turns it into the seat without letting go, and slides its hand away. Direct goal CEM drops the leg onto the thread, then repeatedly lets go and regrasps it while turning, taking twice as long.'};
const compareText={hurdle:'All three reach the far side. CEM-LJS plants its hands, steps onto the hurdle, sits upright astride it, and swings the other leg across. Direct latent CEM leans on the near side for about ten seconds before climbing over. Residual-action CEM throws its chest flat across the top before sitting up and sliding off.',shutter:'CEM-LJS crouches under the shutter, pushes it up, and walks through to stand on the far side. Direct latent CEM squats against the panel for the rest of the run. Residual-action CEM falls to the floor and crawls under on its side, never standing up again.',door_cube:'CEM-LJS and direct latent CEM both lift the cube high, carry it to the door, and push the door open. Residual-action CEM lifts the cube, tips it onto its edge on the stand, and never carries it.'};
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const group=task=>task in research.humanoid.tasks?'humanoid':'assembly';
function findRun(task,method,seed){return research.runs.find(r=>r.task===task&&r.method===method&&r.seed===seed);}
function videoCard(v,title,description=''){
 const complete=v.effects===v.total;
 return `<article class="video-card"><div class="video-wrap"><video controls muted playsinline loop preload="none" poster="${v.poster}" data-src="${v.src}" aria-label="${escapeHTML(title)}, seed ${v.seed}, ${v.effects} of ${v.total} effects"></video></div><h3>${escapeHTML(title)}</h3><div class="video-meta"><span>Seed ${v.seed}</span><span class="${complete?'success':''}">${v.effects} / ${v.total} effects</span></div>${description?`<p>${escapeHTML(description)}</p>`:''}</article>`;
}
const observer='IntersectionObserver' in window?new IntersectionObserver(entries=>entries.forEach(entry=>{
 if(entry.isIntersecting){loadVideo(entry.target);observer.unobserve(entry.target);}
}),{rootMargin:'250px'}):null;
function loadVideo(video){if(video.dataset.src){video.src=video.dataset.src;delete video.dataset.src;video.load();}video.playbackRate=speed;}
function setupVideos(container=document){container.querySelectorAll('video').forEach(video=>{
 if(video.dataset.hero!==undefined)return;
 video.playbackRate=speed;
 if(observer&&video.dataset.src)observer.observe(video);else loadVideo(video);
 video.addEventListener('error',()=>{if(video.parentElement.querySelector('.video-error'))return;const box=document.createElement('div');box.className='video-error';const link=document.createElement('a');link.href=video.currentSrc||video.dataset.src||video.src;link.textContent='Open this recording directly ↗';box.append('The embedded player could not load this recording. ',link);video.parentElement.append(box);});
});}
function renderMain(){
 const h=research.humanoid;
 $('#main-demos').innerHTML=Object.keys(h.tasks).map(task=>videoCard(findRun(task,'cem_ljs',h.featured[task]),h.tasks[task].name,captions[task])).join('');$('#main-demos').querySelectorAll('.video-meta').forEach(el=>el.remove());setupVideos($('#main-demos'));
 $$('[data-hero]').forEach(video=>{const v=findRun(video.dataset.hero,'cem_ljs',h.hero[video.dataset.hero]);video.src=v.src;video.poster=v.poster;video.playbackRate=1;if(heroPlaying)video.play().catch(()=>{});});updateHeroButton();
}
function renderComparison(){
 const t=activeCompare,h=research.humanoid;
 $('#comparison-videos').innerHTML=Object.entries(h.compare[t]).map(([m,seed])=>videoCard(findRun(t,m,seed),h.methods[m])).join('');setupVideos($('#comparison-videos'));
 $('#comparison-caption').textContent=compareText[t];
}
// Score each cell so higher is better; bold every cell that equals the column best.
function cellScore(s,metric){if(metric==='success')return s.successes;if(metric==='effects')return s.mean;return s.best_seconds===null?null:-s.best_seconds;}
function cell(s,metric,total,best){
 const b=best!==null&&cellScore(s,metric)===best?' class="best"':'';
 if(metric==='success')return `<td${b}>${s.successes} <small>/ ${research.seeds.length}</small></td>`;
 if(metric==='time')return s.best_seconds===null?'<td>∞</td>':`<td${b}>${s.best_seconds.toFixed(0)} <small>s</small></td>`;
 return `<td${b}>${s.mean.toFixed(1)} <small>± ${s.sd.toFixed(1)} / ${total}</small></td>`;
}
function renderSummary(groupName,id,metric){
 const g=research[groupName],tasks=Object.keys(g.tasks),methods=Object.keys(g.methods),summary=research.summary[groupName];
 const best=Object.fromEntries(tasks.map(t=>{const v=methods.map(m=>cellScore(summary[t][m],metric)).filter(x=>x!==null);return [t,v.length?Math.max(...v):null];}));
 $(`#${id} tbody`).innerHTML=methods.map((m,i)=>`<tr class="${i===0?'ours':''}"><th scope="row">${g.methods[m]}</th>${tasks.map(t=>cell(summary[t][m],metric,g.tasks[t].effects,best[t])).join('')}</tr>`).join('');
 $$(`#${id} thead th span`).forEach((el,i)=>el.textContent=metric==='effects'?`${g.tasks[tasks[i]].effects} effects`:'');
}
function renderResults(metric){renderSummary('humanoid','results-table',metric);}
function renderAssemblyTable(metric){renderSummary('assembly','assembly-table',metric);}
function renderAssembly(){
 const a=research.assembly,t=activeAssembly;
 $('#assembly-videos').innerHTML=Object.entries(a.compare[t]).map(([m,seed])=>videoCard(findRun(t,m,seed),a.methods[m])).join('');setupVideos($('#assembly-videos'));$('#assembly-caption').textContent=assemblyText[t];
}
function renderAssemblyFigures(){
 const a=research.assembly;
 $('#assembly-figures').innerHTML=Object.keys(a.tasks).map(t=>`<figure class="paper-figure"><h3>${escapeHTML(a.tasks[t].name)}</h3><div class="figure-scroll"><img alt="Seven frames from the best CEM-LJS and direct goal CEM runs: ${escapeHTML(a.tasks[t].name.toLowerCase())}." loading="lazy" src="assets/figures/${t.replaceAll('_','-')}-comparison.png"/></div></figure>`).join('');
}
function renderMethodFilter(){
 const methods=research[group(galleryTask)].methods,select=$('#method-filter'),current=select.value;
 select.innerHTML=Object.entries(methods).map(([k,v])=>`<option value="${k}">${escapeHTML(v)}</option>`).join('')+'<option value="all">All methods</option>';
 select.value=current in methods||current==='all'?current:'cem_ljs';
}
function renderGallery(){
 const method=$('#method-filter').value,g=research[group(galleryTask)];
 const runs=research.runs.filter(r=>r.task===galleryTask&&(method==='all'||r.method===method));
 $('#video-gallery').innerHTML=runs.map(r=>videoCard(r,g.methods[r.method])).join('');setupVideos($('#video-gallery'));
}
function bestRun(groupName,task,seed){
 return research.runs.filter(r=>r.group===groupName&&r.task===task&&r.seed===seed).reduce((a,b)=>b.effects>a.effects||(b.effects===a.effects&&b.seconds<a.seconds)?b:a);
}
function renderTimes(groupName,id){
 const g=research[groupName],runs=research.runs.filter(r=>r.group===groupName),seeds=[...new Set(runs.map(r=>r.seed))];
 const head=`<thead><tr><th scope="col">Task</th><th scope="col">Method</th>${seeds.map(s=>`<th scope="col">Seed ${s}</th>`).join('')}</tr></thead>`;
 const body=Object.keys(g.tasks).map(t=>Object.keys(g.methods).map((m,i)=>`<tr class="${m==='cem_ljs'?'ours':''}">${i===0?`<th scope="rowgroup" rowspan="${Object.keys(g.methods).length}">${escapeHTML(g.tasks[t].name)}</th>`:''}<th scope="row">${escapeHTML(g.methods[m])}</th>${seeds.map(s=>{const r=findRun(t,m,s),top=bestRun(groupName,t,s);return `<td${r===top?' class="best"':''}>${r.seconds.toFixed(0)} <small>s, ${r.effects} / ${r.total}</small></td>`;}).join('')}</tr>`).join('')).join('');
 $('#'+id).innerHTML=head+'<tbody>'+body+'</tbody>';
}
function selectButton(button,attribute){$$(`[${attribute}]`).forEach(b=>{const on=b===button;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});}
$$('[data-speed]').forEach(b=>b.addEventListener('click',()=>{speed=Number(b.dataset.speed);selectButton(b,'data-speed');$$('video:not([data-hero])').forEach(v=>v.playbackRate=speed);}));
$$('[data-metric]').forEach(b=>b.addEventListener('click',()=>{selectButton(b,'data-metric');if(research)renderResults(b.dataset.metric);}));
$$('[data-assembly-metric]').forEach(b=>b.addEventListener('click',()=>{selectButton(b,'data-assembly-metric');if(research)renderAssemblyTable(b.dataset.assemblyMetric);}));
$$('[data-assembly]').forEach(b=>b.addEventListener('click',()=>{selectButton(b,'data-assembly');activeAssembly=b.dataset.assembly;if(research)renderAssembly();}));
$$('[data-task]').forEach(b=>b.addEventListener('click',()=>{selectButton(b,'data-task');galleryTask=b.dataset.task;if(research){renderMethodFilter();renderGallery();}}));
$$('[data-compare]').forEach(b=>b.addEventListener('click',()=>{selectButton(b,'data-compare');activeCompare=b.dataset.compare;if(research)renderComparison();}));
$('#method-filter').addEventListener('change',()=>{if(research)renderGallery();});
function updateHeroButton(){$('#hero-motion').textContent=heroPlaying?'Pause video':'Play video';$('#hero-motion').setAttribute('aria-pressed',String(heroPlaying));}
$('#hero-motion').addEventListener('click',()=>{heroPlaying=!heroPlaying;$$('[data-hero]').forEach(v=>heroPlaying?v.play().catch(()=>{}):v.pause());updateHeroButton();});
document.addEventListener('visibilitychange',()=>{$$('[data-hero]').forEach(v=>{if(document.hidden)v.pause();else if(heroPlaying)v.play().catch(()=>{});});});
function renderControllers(items){
 if(!items.length){$('#controllers').hidden=true;return;}
 const host=$('#controller-showcase');host.innerHTML='<div class="controller-tabs" role="group" aria-label="Controller demonstrations"></div><div class="controller-content"></div>';
 const tabs=host.querySelector('.controller-tabs');
 function show(index){const item=items[index];Array.from(tabs.children).forEach((b,i)=>{b.classList.toggle('selected',i===index);b.setAttribute('aria-pressed',String(i===index));});
 host.querySelector('.controller-content').innerHTML=`<div><video controls muted playsinline loop preload="metadata" src="${item.src}" poster="${item.poster}" aria-label="${escapeHTML(item.title)}"></video></div><div class="controller-copy"><p class="controller-label">${escapeHTML(item.controller)}</p><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.description)}</p></div>`;setupVideos(host);}
 items.forEach((item,i)=>{const b=document.createElement('button');b.textContent=item.label||item.controller;b.type='button';b.addEventListener('click',()=>show(i));tabs.append(b);});show(0);
}
Promise.all([fetch('research.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Result data missing');return r.json();}),fetch('controllers.json',{cache:'no-cache'}).then(r=>r.ok?r.json():[])]).then(([data,controllers])=>{research=data;renderMain();renderResults('success');renderComparison();renderAssemblyTable('success');renderAssembly();renderAssemblyFigures();renderTimes('humanoid','humanoid-times');renderTimes('assembly','assembly-times');renderMethodFilter();renderGallery();renderControllers(controllers);setupVideos($('#reliability'));setupVideos($('#minimal-definitions'));setupVideos($('#comparison .pair-grid'));}).catch(error=>{console.error(error);$('#site-status').textContent='Some media could not be loaded. Please reload this page.';for(const id of ['main-demos','comparison-videos','video-gallery','assembly-videos'])$('#'+id).innerHTML='<p class="error-message">The recordings could not load. Please reload this page.</p>';});
