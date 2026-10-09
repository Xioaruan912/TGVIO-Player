// Real-browser check of delete with undo, against the loopback fixture only: a
// temporary Chrome profile, the isolated fake API (TGVIO_ACCEPTANCE_DELETABLE=1) and
// FFmpeg test clips. It proves what unit tests cannot: the feed moves on at once, the
// undo control is painted on top and really hit-testable at phone and landscape sizes,
// undo brings the clip back, and a closed notice leaves no tab stop behind.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const profile=await mkdtemp(path.join(tmpdir(),"tgvio-delete-browser-"));
let chrome,socket,server,baseUrl;const checks=[],children=[];
const check=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
async function stop(child){
 if(!child||child.exitCode!==null)return;
 const closed=new Promise(resolve=>child.once("close",resolve));
 child.kill("SIGTERM");await Promise.race([closed,delay(2500)]);
 if(child.exitCode===null){child.kill("SIGKILL");await closed;}
}
try {
 server=spawn(process.execPath,["tests/ui-acceptance.server.mjs"],{cwd:root,env:{...process.env,TGVIO_ACCEPTANCE_PORT:"0",TGVIO_ACCEPTANCE_DELETABLE:"1"},stdio:["ignore","pipe","pipe"]});children.push(server);
 let log="";
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error("Fixture startup failed: "+log)),25000);
  server.stdout.on("data",chunk=>{
   log+=chunk;
   for(const line of log.split("\n")){
    if(!line.startsWith("{")||!line.includes('"realTestMedia":true'))continue;
    try{const status=JSON.parse(line);if(status.url){baseUrl=status.url;clearTimeout(timer);resolve();return;}}catch{}
   }
  });
  server.stderr.on("data",chunk=>{log+=chunk;});
  server.once("exit",code=>{clearTimeout(timer);reject(new Error("Fixture exited "+code+": "+log));});
 });
 chrome=spawn(process.env.CHROME_BIN||"google-chrome",["--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
  "--disable-background-networking","--no-first-run","--no-default-browser-check","--autoplay-policy=no-user-gesture-required",
  `--user-data-dir=${profile}`,"--remote-debugging-port=0","--remote-debugging-address=127.0.0.1","about:blank"],{stdio:["ignore","ignore","pipe"]});
 children.push(chrome);
 let debugPort;
 for(let i=0;i<100&&!debugPort;i++){
  try{debugPort=Number((await readFile(path.join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]);}catch{await delay(100);}
 }
 if(!debugPort)throw new Error("Temporary Chrome did not start");
 const page=(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item=>item.type==="page");
 socket=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
 let id=0;const pending=new Map();
 socket.addEventListener("message",event=>{
  const message=JSON.parse(event.data);const task=pending.get(message.id);if(!task)return;
  pending.delete(message.id);clearTimeout(task.timer);
  message.error?task.reject(new Error(message.error.message)):task.resolve(message.result);
 });
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{
  const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error("CDP deadline: "+method));},12000);
  pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));
 });
 const evaluate=async expression=>{
  const result=await cdp("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error("Browser JS: "+JSON.stringify(result.exceptionDetails));
  return result.result?.value;
 };
 const wait=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw new Error("Timed out: "+label);};
 // A real pointer press at the centre of the first visible match, after proving the
 // centre is really that element (painted on top, not covered, not inert).
 const click=async selector=>{
  let box;
  for(let attempt=0;attempt<10&&!box?.hit;attempt++){
   box=await evaluate("(()=>{const el=[...document.querySelectorAll("+JSON.stringify(selector)+")].find(e=>e.getClientRects().length&&!e.closest('[inert]'));if(!el)return null;const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,width:r.width,height:r.height,hit:el.contains(document.elementFromPoint(x,y))}})()");
   if(!box?.hit)await delay(100);
  }
  check(box?.hit,"pointer can reach "+selector+" "+JSON.stringify(box));
  await cdp("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,x:box.x,y:box.y});
  await cdp("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,x:box.x,y:box.y});
  return box;
 };
 const status=async()=>(await fetch(baseUrl+"/__acceptance__/status")).json();
 await cdp("Page.enable");
 await cdp("Page.addScriptToEvaluateOnNewDocument",{source:"try{localStorage.setItem('tgvio.player.prefs',JSON.stringify({cacheMode:'off',gestureGuideSeen:true,quality:'original'}));}catch{}"});
 for(const [width,height] of [[360,800],[390,844],[844,390]]){
  await cdp("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:true});
  await cdp("Page.navigate",{url:baseUrl+"/"});
  await wait("!!document.querySelector('.app-shell')&&!!document.querySelector('#feed [data-media-id]')","feed "+width);
  const firstIndex=await evaluate("(()=>{const f=document.querySelector('#feed');return Math.round(f.scrollTop/Math.max(1,f.clientHeight))})()");
  const ids=await evaluate("[...document.querySelectorAll('#feed [data-media-id]')].map(p=>p.dataset.mediaId)");
  const deleted=ids[firstIndex];
  check(typeof deleted==="string"&&deleted.length===64,"a current clip to delete "+width);
  const {deletionRequests:before,deletionsQueued:queuedBefore}=await status();

  await click(".player-panel .media-actions-toggle");
  await click(".player-panel .delete-action");
  await wait("!!document.querySelector('.delete-warning-confirm')","delete confirmation "+width);
  const confirmedAt=Date.now();
  await click(".delete-warning-confirm");
  await wait("!!document.querySelector('.undo-toast .undo-toast-action')","undo offered "+width);
  const removed=await evaluate("!document.querySelector('#feed [data-media-id=\""+deleted+"\"]')");
  check(removed,"the deleted clip left the feed "+width);
  check(Date.now()-confirmedAt<1500,"the feed moved on without waiting for the archive "+width+": "+(Date.now()-confirmedAt)+"ms");
  await evaluate("Promise.all(document.querySelector('.undo-toast').getAnimations().filter(a=>a.animationName==='undo-toast-in').map(a=>a.finished.catch(()=>{})))");
  const geometry=await evaluate("(()=>{const t=document.querySelector('.undo-toast'),a=t.querySelector('.undo-toast-action'),r=t.getBoundingClientRect(),b=a.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,actionHeight:b.height,actionWidth:b.width,vw:innerWidth,vh:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()");
  check(geometry.left>=0&&geometry.right<=geometry.vw&&geometry.top>=0&&geometry.bottom<=geometry.vh,"undo notice inside the viewport "+width+" "+JSON.stringify(geometry));
  check(geometry.actionHeight>=44&&geometry.actionWidth>=64,"undo action is a real touch target "+width+" "+JSON.stringify(geometry));
  check(!geometry.overflow,"no horizontal page scroll with the notice "+width);
  check((await status()).deletionRequests===before+1,"exactly one delete request "+width);

  await click(".undo-toast-action");
  await wait("!!document.querySelector('#feed [data-media-id=\""+deleted+"\"]')","undo brings the clip back "+width);
  await wait("document.querySelector('.undo-toast-text')?.textContent==='已撤销删除'","undo is confirmed "+width);
  check((await status()).deletionsQueued===queuedBefore,"the server no longer holds the delete "+width);
  check(await evaluate("!document.querySelector('.undo-toast-action')"),"no undo button remains after undo "+width);

  // A delete left alone stays deleted, and its notice leaves the document.
  await click(".player-panel .media-actions-toggle");
  await click(".player-panel .delete-action");
  await wait("!!document.querySelector('.delete-warning-confirm')","second confirmation "+width);
  await click(".delete-warning-confirm");
  await wait("!!document.querySelector('.undo-toast-action')","second undo offer "+width);
  await wait("!document.querySelector('.undo-toast')","the notice closes by itself "+width);
  check((await status()).deletionsQueued===queuedBefore+1,"an untouched delete stays queued "+width);
  check(await evaluate("[...document.querySelectorAll('button')].every(b=>!b.classList.contains('undo-toast-action'))"),"no hidden undo tab stop "+width);
 }
 // The long player hands the delete to its page: the player closes and the tile leaves
 // at once, and undo puts the tile back in the list.
 await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await cdp("Page.navigate",{url:baseUrl+"/"});
 await wait("!!document.querySelector('.app-shell')","app for the long check");
 await click('.nav-btn[data-action="long"]');
 await wait("!!document.querySelector('.long-list .cover-tile[data-media-id] .cover-tile-play')","long list");
 const longId=await evaluate("document.querySelector('.long-list .cover-tile[data-media-id]').dataset.mediaId");
 await click(".long-list .cover-tile[data-media-id='"+longId+"'] .cover-tile-play");
 await wait("!!document.querySelector('.large-player .large-delete')","long player open");
 // Opened from the long page the player starts privacy-locked; unlock it first.
 await click(".large-player .large-privacy-play");
 await wait("!document.querySelector('.large-player').classList.contains('privacy-locked')","long player unlocked");
 await click(".large-player .media-actions-toggle");
 await click(".large-player .large-delete");
 await wait("!!document.querySelector('.delete-warning-confirm')","long delete confirmation");
 await click(".delete-warning-confirm");
 await wait("!document.querySelector('.large-player')&&!!document.querySelector('.undo-toast-action')","long player closes with undo offered");
 check(await evaluate("!document.querySelector('.long-list .cover-tile[data-media-id=\""+longId+"\"]')"),"the deleted long video left the list");
 await click(".undo-toast-action");
 await wait("!!document.querySelector('.long-list .cover-tile[data-media-id=\""+longId+"\"]')","undo puts the long video back");
 check(await evaluate("document.querySelector('.long-list .cover-tile[data-media-id]').dataset.mediaId")===longId,"the long video returns to its place");
 await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
 await cdp("Page.navigate",{url:baseUrl+"/"});
 await wait("!!document.querySelector('#feed [data-media-id]')","feed with reduced motion");
 await click(".player-panel .media-actions-toggle");
 await click(".player-panel .delete-action");
 await wait("!!document.querySelector('.delete-warning-confirm')","reduced-motion confirmation");
 await click(".delete-warning-confirm");
 await wait("!!document.querySelector('.undo-toast')","reduced-motion notice");
 check(await evaluate("getComputedStyle(document.querySelector('.undo-toast')).animationName==='none'"),"reduced motion keeps the notice still");
 console.log(JSON.stringify({ok:true,checks:checks.length,source:"loopback fixture with FFmpeg test clips; isolated fake API"}));
} finally {
 socket?.close();for(const child of children.reverse())await stop(child);
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
