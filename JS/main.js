// Mobile menu: toggle open/closed, and close after picking a link
const header = document.querySelector('.header');
const navToggle = header.querySelector('.nav-toggle');
function setNavOpen(open){
  header.classList.toggle('nav-open', open);
  navToggle.setAttribute('aria-expanded', open);
}
navToggle.addEventListener('click', () => setNavOpen(!header.classList.contains('nav-open')));
header.querySelector('.nav-menu').addEventListener('click', e => { if(e.target.closest('a')) setNavOpen(false); });

// Shrink the header once the page is scrolled. Two thresholds so the header
// shrinking (which nudges the scroll position) can't make it flicker.
function updateHeader(){
  const y = window.scrollY;
  if(y > 40) header.classList.add('is-scrolled');
  else if(y < 5) header.classList.remove('is-scrolled');
}
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();

// Reviews carousel: arrows and dots scroll the track; swiping works natively
const track = document.querySelector('.carousel-track');
const slides = track.children;
const dots = document.querySelector('.carousel-dots');
const [prevBtn, nextBtn] = document.querySelectorAll('.carousel-btn');
const step = () => slides[1].offsetLeft - slides[0].offsetLeft;
const visible = () => Math.round(track.clientWidth / step()) || 1;
const lastIndex = () => slides.length - visible();
const currentIndex = () => Math.round(track.scrollLeft / step());
const goTo = i => track.scrollTo({ left: Math.max(0, Math.min(i, lastIndex())) * step() });

function buildDots(){
  dots.innerHTML = '';
  for(let i = 0; i <= lastIndex(); i++){
    const dot = document.createElement('button');
    dot.setAttribute('aria-label', `Show review ${i + 1}`);
    dot.addEventListener('click', () => goTo(i));
    dots.append(dot);
  }
  updateCarousel();
}
function updateCarousel(){
  const i = currentIndex();
  [...dots.children].forEach((d, n) => d.setAttribute('aria-current', n === i));
  prevBtn.disabled = i <= 0;
  nextBtn.disabled = i >= lastIndex();
}
prevBtn.addEventListener('click', () => goTo(currentIndex() - 1));
nextBtn.addEventListener('click', () => goTo(currentIndex() + 1));
track.addEventListener('scroll', updateCarousel, { passive: true });
track.addEventListener('keydown', e => {
  if(e.key === 'ArrowLeft') { e.preventDefault(); goTo(currentIndex() - 1); }
  if(e.key === 'ArrowRight') { e.preventDefault(); goTo(currentIndex() + 1); }
});
window.addEventListener('resize', buildDots);
buildDots();

// Send a form to Formspree without leaving the page. Resolves true on success.
async function sendForm(form){
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' }
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Contact form: show a confirmation in place of the form
const contactForm = document.getElementById('contact-form');
contactForm.addEventListener('submit', async e => {
  e.preventDefault();
  const status = contactForm.querySelector('.form-status');
  const button = contactForm.querySelector('button');
  button.disabled = true;
  status.textContent = 'Sending...';
  if(await sendForm(contactForm)){
    contactForm.innerHTML = '<div class="form-done"><h3>Thanks, we got your message.</h3><p>We respond within one business day, and most inquiries the same day. Talk soon.</p></div>';
  } else {
    button.disabled = false;
    status.textContent = 'Something went wrong. Please try again or email info@rapidityhomes.com.';
  }
});

/* ========== PRO FORMA ==========
   Rapidity: 10% fee, labor included, materials at a contractor discount.
   Typical PM: 7.5% fee, labor billed, materials at retail.
   Fees are charged on rent collected (after vacancy). Repairs scale with rent. */
const RAPIDITY_FEE = 0.10;
const TYPICAL_FEE = 0.075;
const EXPENSE_GROWTH = 0.03;
const YEARS = 5;

const pfInputs = document.getElementById('pf-inputs');
const pfResults = document.querySelector('.pf-results');
const pfGate = document.getElementById('pf-gate');
const pfFull = pfResults.querySelector('.pf-full');
const money = n => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
const out = (key, html) => { pfResults.querySelector(`[data-out="${key}"]`).innerHTML = html; };

function readInputs(){
  const v = {};
  for(const el of pfInputs.elements){
    if(el.name) v[el.name] = parseFloat(el.value) || 0;
  }
  return v;
}

function calculate(v){
  const years = [];
  for(let y = 0; y < YEARS; y++){
    const gross = v.rent * 12 * (1 + v.growth / 100) ** y;
    const collected = gross * (1 - v.vacancy / 100);
    const expenses = (v.taxes + v.insurance + v.hoa * 12 + v.other) * (1 + EXPENSE_GROWTH) ** y;
    const repairsTypical = gross * v.repairPct / 100;
    const repairsRapidity = repairsTypical * (v.materialsShare / 100) * (1 - v.discount / 100);
    const r = { fee: collected * RAPIDITY_FEE, repairs: repairsRapidity };
    const t = { fee: collected * TYPICAL_FEE, repairs: repairsTypical };
    r.cost = r.fee + r.repairs;
    t.cost = t.fee + t.repairs;
    r.cashFlow = collected - expenses - r.cost;
    t.cashFlow = collected - expenses - t.cost;
    years.push({ r, t });
  }
  return years;
}

function render(){
  const v = readInputs();
  const years = calculate(v);
  const [y1] = years;

  out('fee-r', money(y1.r.fee));       out('fee-t', money(y1.t.fee));
  out('rep-r', money(y1.r.repairs));   out('rep-t', money(y1.t.repairs));
  out('cost-r', money(y1.r.cost));     out('cost-t', money(y1.t.cost));
  out('cf-r', money(y1.r.cashFlow));   out('cf-t', money(y1.t.cashFlow));

  const saved = y1.t.cost - y1.r.cost;
  const pct = y1.t.cost ? Math.round(saved / y1.t.cost * 100) : 0;
  out('headline', saved > 0
    ? `Year 1: about <strong>${money(saved)} lower</strong> true management cost with Rapidity (${pct}% less).`
    : `Year 1: about ${money(-saved)} higher true management cost with Rapidity under these assumptions.`);

  let sumR = 0, sumT = 0;
  out('years', years.map(({ r, t }, i) => {
    sumR += r.cashFlow;
    sumT += t.cashFlow;
    return `<tr><th scope="row">${i + 1}</th><td class="col-rapidity">${money(r.cashFlow)}</td><td>${money(t.cashFlow)}</td><td>${money(r.cashFlow - t.cashFlow)}</td></tr>`;
  }).join(''));
  out('sum-r', money(sumR));
  out('sum-t', money(sumT));
  out('sum-d', money(sumR - sumT));

  if(v.value > 0){
    const appreciation = v.value * ((1 + v.appreciation / 100) ** YEARS - 1);
    out('return', `With ${v.appreciation}% yearly appreciation on a ${money(v.value)} home (about ${money(appreciation)} over 5 years), total 5-year return before mortgage is about <strong>${money(sumR + appreciation)}</strong> with Rapidity vs. ${money(sumT + appreciation)} with a typical PM.`);
  } else {
    out('return', 'Add a property value above to include appreciation and see total 5-year return.');
  }

  // Give the lead form a plain-text copy of what the owner modeled
  pfGate.elements.proforma.value =
    Object.entries(v).map(([k, n]) => `${k}: ${n}`).join(', ') +
    ` | Y1 cost Rapidity ${money(y1.r.cost)} vs typical ${money(y1.t.cost)} | 5-yr cash flow ${money(sumR)} vs ${money(sumT)}`;
}

function unlock(){
  pfGate.hidden = true;
  pfFull.hidden = false;
}

pfInputs.addEventListener('input', render);
pfInputs.addEventListener('submit', e => e.preventDefault());

pfGate.addEventListener('submit', async e => {
  e.preventDefault();
  if(!pfGate.reportValidity()) return;
  const button = pfGate.querySelector('button');
  button.disabled = true;
  pfGate.querySelector('.form-status').textContent = 'One moment...';
  // Show the results either way; a failed send shouldn't block the owner
  await sendForm(pfGate);
  try { sessionStorage.setItem('pfUnlocked', '1'); } catch {}
  unlock();
});

try { if(sessionStorage.getItem('pfUnlocked')) unlock(); } catch {}
render();
