document.getElementById('year').textContent=String(new Date().getFullYear());

if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
