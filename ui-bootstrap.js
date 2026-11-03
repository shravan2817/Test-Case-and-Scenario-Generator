(function () {
  'use strict';
  const root = document.documentElement;
  const paths = {
    add:'M12 5v14M5 12h14', close:'m6 6 12 12M6 18 18 6',
    expand_more:'m6 9 6 6 6-6', arrow_back:'m12 5-7 7 7 7M5 12h14', arrow_forward:'m12 5 7 7-7 7M19 12H5',
    search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    content_copy:'M9 5h11v16H9zM5 17H3V1h11v2',
    download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
    upload:'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',
    folder:'M3 6h7l2 2h9v12H3z', table_chart:'M3 4h18v16H3zM3 9h18M10 9v11',
    edit_note:'M4 5h10M4 10h7M4 15h5m5 1 5-5 3 3-5 5-4 1z',
    visibility:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    check_circle:'M20 6 9 17l-5-5', error:'M12 4v9m0 4v1M3 3h18v18H3z',
    more_vert:'M12 4v1m0 6v1m0 6v1', delete:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15',
    light_mode:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    dark_mode:'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12',
    fact_check:'M3 3h18v18H3zM6 8h5m-5 5h5m3-2 2 2 3-4',
    auto_fix_high:'m4 20 12-12 3 3L7 23zM6 2v6M3 5h6m10-4v6m-3-3h6',
    history:'M3 4v6h6M3 10a9 9 0 1 1 2 9M12 6v6l4 2',
    pending:'M4 12h1m6 0h1m6 0h1', sync:'M4 8a8 8 0 0 1 14-3l2 3m0-5v5h-5M20 16a8 8 0 0 1-14 3l-2-3m0 5v-5h5',
    default:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'
  };
  const aliases = { folder_copy:'folder', folder_open:'folder', folder_off:'folder', hard_drive:'table_chart', grid_on:'table_chart', task_alt:'check_circle', cloud_download:'download', cloud_upload:'upload', contrast:'light_mode', notes:'edit_note', magic_button:'auto_fix_high' };
  function applyFallbacks() {
    document.querySelectorAll('.material-symbols-rounded').forEach(icon => {
      if (!icon.hasAttribute('data-fallback-icon')) {
        const size=parseFloat(getComputedStyle(icon).fontSize);
        icon.style.setProperty('--fallback-size',`${size || 24}px`);
      }
      const name = icon.textContent.trim();
      const path = paths[aliases[name] || name] || paths.default;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
      icon.style.setProperty('--fallback-icon', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
      icon.dataset.fallbackIcon = '';
      icon.setAttribute('aria-hidden', 'true');
      const button = icon.closest('button');
      if (button && !button.hasAttribute('aria-label') && button.dataset.tooltip) button.setAttribute('aria-label', button.dataset.tooltip);
    });
  }
  async function fontsReady() {
    const link = document.getElementById('materialIconStylesheet');
    if (!link) return true;
    if (!link.sheet) await new Promise((resolve,reject) => {
      link.addEventListener('load',resolve,{once:true});
      link.addEventListener('error',()=>reject(new Error('Icon stylesheet unavailable.')),{once:true});
    });
    link.media = 'all';
    const loaded = await document.fonts.load('24px "Material Symbols Rounded"');
    if (!loaded.length) throw new Error('Icon font unavailable.');
    return true;
  }
  const initialized = window.qaUiInitialized ? Promise.resolve() : new Promise(resolve => window.addEventListener('qa-ui-initialized',resolve,{once:true}));
  let fontTimer, initTimer;
  const timeout = (ms,message,setTimer) => new Promise((resolve,reject)=>setTimer(setTimeout(()=>reject(new Error(message)),ms)));
  const font = Promise.race([fontsReady(),timeout(3500,'Icon loading timed out.',id=>{fontTimer=id;})])
    .catch(error => {
      console.warn('Using local icon fallback:',error);
      applyFallbacks();root.dataset.icons = 'fallback';
      new MutationObserver(applyFallbacks).observe(document.body,{childList:true,subtree:true,characterData:true});
      return false;
    }).finally(()=>clearTimeout(fontTimer));
  const app = Promise.race([initialized,timeout(6000,'Startup is taking longer than expected.',id=>{initTimer=id;})])
    .catch(error=>{console.error('UI initialization:',error);return false;}).finally(()=>clearTimeout(initTimer));
  Promise.all([font,app]).then(([icons,ready]) => {
    clearTimeout(window.qaBootstrapTimer);
    root.dataset.icons = icons ? 'ready' : 'fallback';
    root.dataset.uiReady = 'true';
    document.body.setAttribute('aria-busy','false');
    document.getElementById('appBootstrap').hidden = true;
    if (!icons || ready === false) {
      const notice=document.getElementById('bootstrapNotice');
      notice.hidden=false;
      notice.querySelector('span').textContent=ready===false?'Startup delayed. Reload if the screen does not respond.':'Basic icons enabled. Reload to retry icon loading.';
    }
  });
})();
