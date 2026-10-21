// Mobile menu: toggle open/closed, and close after picking a link
const header = document.querySelector('.header');
const navToggle = header.querySelector('.nav-toggle');
function setNavOpen(open){
  header.classList.toggle('nav-open', open);
  navToggle.setAttribute('aria-expanded', open);
}
navToggle.addEventListener('click', () => setNavOpen(!header.classList.contains('nav-open')));
header.querySelector('.nav-menu').addEventListener('click', e => { if(e.target.closest('a')) setNavOpen(false); });
