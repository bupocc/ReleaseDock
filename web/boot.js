// 即使模块未能加载，也给出可操作的提示，避免长时间停留在空白页面。
(() => {
  const showStartupError = () => {
    const app = document.querySelector('#app');
    if (!app || app.dataset.booting !== 'true') return;
    app.dataset.booting = 'failed';
    app.innerHTML = '<main class="loading-screen" id="main-content"><h1>页面暂时无法加载</h1><p>请检查网络连接后刷新页面。若问题持续，请联系站点管理员。</p><a class="btn btn-primary" href="/">重新加载发布中心</a></main>';
  };
  window.addEventListener('error', (event) => {
    if (event.target instanceof HTMLScriptElement) showStartupError();
  }, true);
  window.setTimeout(showStartupError, 30000);
})();
