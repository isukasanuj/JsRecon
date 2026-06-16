const $=(id)=>document.getElementById(id);
const send=(m)=>new Promise(r=>chrome.runtime.sendMessage(m,r));
async function refresh(){
  const s=await send({type:"GET_STATE"});
  $("toggle").checked=!!s.collecting;
  $("status").textContent=s.collecting?"On — mining as you browse":"Off";
  $("status").className="status "+(s.collecting?"on":"off");
  $("hosts").textContent=s.hosts||0; $("endpoints").textContent=s.endpoints||0; $("secrets").textContent=s.secrets||0;
  if(document.activeElement!==$("scope")) $("scope").value=(s.scope||[]).join(", ");
}
$("toggle").addEventListener("change",async e=>{await send({type:"SET_COLLECTING",value:e.target.checked});refresh();});
$("scope").addEventListener("change",async e=>{await send({type:"SET_SCOPE",scope:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)});});
$("open").addEventListener("click",()=>chrome.tabs.create({url:chrome.runtime.getURL("viewer.html")}));
$("theme").addEventListener("click",()=>window.__setTheme&&window.__setTheme(window.__theme()==="light"?"dark":"light"));
$("clear").addEventListener("click",async()=>{if(confirm("Clear all discovered data?")){await send({type:"CLEAR"});refresh();}});
refresh();
