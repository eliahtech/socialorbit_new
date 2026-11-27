/* Classic (non-module) script loaded before the app. It exists so that a startup failure is never silent:
   it shows a visible banner for script load errors, uncaught errors, and an app that never finishes starting. */
(function(){
  var shown=false;
  function banner(message){
    if(shown)return;shown=true;
    function add(){
      var box=document.createElement('div');box.setAttribute('role','alert');
      box.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#7a1020;color:#fff;padding:14px 18px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 -4px 24px rgba(0,0,0,.4)';
      box.appendChild(document.createTextNode(message+' '));
      var a=document.createElement('a');a.href='/diagnose.html';a.textContent='Run diagnostics';a.style.cssText='color:#fff;font-weight:700;text-decoration:underline';
      box.appendChild(a);document.body.appendChild(box);
    }
    if(document.body)add();else document.addEventListener('DOMContentLoaded',add);
  }
  window.__soBooted=false;
  // Capture phase so failed <script src> / module loads (which do not bubble) are seen too.
  window.addEventListener('error',function(e){
    var t=e.target;
    if(t&&t!==window&&(t.src||t.href))banner('A required file failed to load: '+(t.src||t.href).replace(location.origin,'')+'.');
    else banner('Script error: '+(e.message||'unknown')+'.');
  },true);
  window.addEventListener('unhandledrejection',function(e){banner('Unexpected error: '+((e.reason&&e.reason.message)||e.reason||'unknown')+'.')});
  setTimeout(function(){if(!window.__soBooted)banner('The app did not finish starting.')},8000);
})();
