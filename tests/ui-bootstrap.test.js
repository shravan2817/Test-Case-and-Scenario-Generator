const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const source=readFileSync(join(__dirname,'..','ui-bootstrap.js'),'utf8');

async function boot(font,initialized=true) {
  const timers=new Map(),events=new Map(),properties={};
  const root={dataset:{}},icon={textContent:'download',dataset:{},style:{setProperty:(name,value)=>{properties[name]=value;}},hasAttribute:()=>false,setAttribute(){},closest:()=>null};
  const nodes={
    materialIconStylesheet:{sheet:{},media:'print'},
    appBootstrap:{hidden:false},
    bootstrapNotice:{hidden:true,querySelector:()=>nodes.noticeText},
    noticeText:{textContent:''}
  };
  const window={qaUiInitialized:initialized,addEventListener:(name,fn)=>events.set(name,fn)};
  const context=vm.createContext({
    window,document:{documentElement:root,body:{setAttribute(){}},fonts:{load:()=>font},getElementById:id=>nodes[id],querySelectorAll:()=>[icon]},
    getComputedStyle:()=>({fontSize:'24px'}),console:{warn(){},error(){}},
    MutationObserver:class {observe(){}},
    setTimeout:(fn,ms)=>{timers.set(ms,fn);return ms;},clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(source,context);
  const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
  await settle();
  return {root,nodes,events,timers,properties,settle};
}
test('startup stays gated until both UI initialization and the icon font finish',async()=>{
  let resolveFont;const font=new Promise(resolve=>{resolveFont=resolve;});
  const state=await boot(font,false);
  assert.equal(state.nodes.appBootstrap.hidden,false);
  assert.equal(state.root.dataset.uiReady,undefined);
  resolveFont([{}]);await state.settle();
  assert.equal(state.nodes.appBootstrap.hidden,false);
  state.events.get('qa-ui-initialized')();await state.settle();
  assert.equal(state.nodes.appBootstrap.hidden,true);
  assert.equal(state.root.dataset.icons,'ready');
  assert.equal(state.nodes.bootstrapNotice.hidden,true);
});
test('missing icon font enables local SVG fallbacks and an actionable notice',async()=>{
  const state=await boot(Promise.resolve([]));
  assert.equal(state.root.dataset.icons,'fallback');
  assert.equal(state.nodes.appBootstrap.hidden,true);
  assert.equal(state.nodes.bootstrapNotice.hidden,false);
  assert.match(state.nodes.noticeText.textContent,/Reload/);
  assert.match(state.properties['--fallback-icon'],/data:image\/svg\+xml/);
});
test('slow font requests have a bounded timeout rather than an indefinite loader',async()=>{
  const state=await boot(new Promise(()=>{}));
  state.timers.get(3500)();await state.settle();
  assert.equal(state.root.dataset.icons,'fallback');
  assert.equal(state.nodes.appBootstrap.hidden,true);
});
test('slow application initialization releases the loader with an honest recovery notice',async()=>{
  const state=await boot(Promise.resolve([{}]),false);
  state.timers.get(6000)();await state.settle();
  assert.equal(state.nodes.appBootstrap.hidden,true);
  assert.match(state.nodes.noticeText.textContent,/Startup delayed/);
});
