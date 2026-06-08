// FSHD App - External Script
document.title = 'EXT-LOADED';
const d = document.getElementById('debug');
if(d) d.textContent = 'External JS Running!';
console.log('app.js loaded');