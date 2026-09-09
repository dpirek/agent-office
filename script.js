document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();

  const menuToggle = document.querySelector('.menu-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  menuToggle?.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.innerHTML = open ? '<i data-lucide="x"></i>' : '<i data-lucide="menu"></i>';
    lucide.createIcons();
  });
  mobileMenu?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.innerHTML = '<i data-lucide="menu"></i>';
    lucide.createIcons();
  }));

  document.querySelectorAll('.steps li button').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.parentElement;
      document.querySelectorAll('.steps li').forEach(li => {
        li.classList.toggle('active', li === item);
        const icon = li.querySelector('button svg');
        if (icon) icon.outerHTML = li === item ? '<i data-lucide="minus"></i>' : '<i data-lucide="plus"></i>';
      });
      lucide.createIcons();
    });
  });

  const priceText = document.getElementById('home-price');
  const priceRange = document.getElementById('price-range');
  const downText = document.getElementById('down-payment');
  const downPercent = document.getElementById('down-percent');
  const rateInput = document.getElementById('interest-rate');
  const termSelect = document.getElementById('loan-term');
  const monthlyEl = document.getElementById('monthly-payment');
  const piEl = document.getElementById('pi-payment');
  const taxEl = document.getElementById('tax-payment');
  const insuranceEl = document.getElementById('insurance-payment');
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const numeric = s => Number(String(s).replace(/[^0-9.]/g, '')) || 0;

  function calculate() {
    const price = numeric(priceText.value);
    const down = Math.min(numeric(downText.value), price);
    const rate = Number(rateInput.value) / 100 / 12;
    const payments = Number(termSelect.value) * 12;
    const principal = Math.max(0, price - down);
    const pi = rate > 0 ? principal * (rate * Math.pow(1 + rate, payments)) / (Math.pow(1 + rate, payments) - 1) : principal / payments;
    const tax = price * .0075 / 12;
    const insurance = Math.max(75, price * .0022 / 12);
    const total = pi + tax + insurance;
    monthlyEl.textContent = fmt(total);
    piEl.textContent = '$' + fmt(pi);
    taxEl.textContent = '$' + fmt(tax);
    insuranceEl.textContent = '$' + fmt(insurance);
    downPercent.textContent = price ? Math.round(down / price * 100) + '%' : '0%';
    const pPct = total ? pi / total * 100 : 0;
    const tPct = total ? tax / total * 100 : 0;
    document.querySelector('.principal-bar').style.width = pPct + '%';
    document.querySelector('.tax-bar').style.width = tPct + '%';
    document.querySelector('.insurance-bar').style.width = (100 - pPct - tPct) + '%';
  }
  priceRange?.addEventListener('input', () => {
    const oldPrice = numeric(priceText.value) || 1;
    const pct = numeric(downText.value) / oldPrice;
    priceText.value = fmt(priceRange.value);
    downText.value = fmt(Number(priceRange.value) * pct);
    calculate();
  });
  priceText?.addEventListener('change', () => { priceText.value = fmt(numeric(priceText.value)); priceRange.value = numeric(priceText.value); calculate(); });
  downText?.addEventListener('change', () => { downText.value = fmt(numeric(downText.value)); calculate(); });
  rateInput?.addEventListener('input', calculate);
  termSelect?.addEventListener('change', calculate);
  calculate();

  const form = document.getElementById('lead-form');
  const toast = document.querySelector('.toast');
  form?.addEventListener('submit', e => {
    e.preventDefault();
    form.reset();
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4500);
  });

  const reviews = [
    {quote:'Harborline made us feel like we had <em>a trusted neighbor</em> in our corner—not just a lender.', name:'Danielle & Marcus R.', detail:'First-time buyers · Montclair, NJ'},
    {quote:'Every question got a straight answer, and our closing was <em>even smoother</em> than we hoped.', name:'Priya S.', detail:'Homebuyer · Jersey City, NJ'},
    {quote:'They found an option that fit our plans and kept us <em>confident at every step.</em>', name:'Chris & Avery M.', detail:'Homeowners · Red Bank, NJ'}
  ];
  let reviewIndex = 0;
  const renderReview = () => {
    const r = reviews[reviewIndex];
    document.querySelector('.testimonial blockquote').innerHTML = r.quote;
    document.querySelector('.reviewer strong').textContent = r.name;
    document.querySelector('.reviewer span').textContent = r.detail;
    document.querySelector('.testimonial-nav span').innerHTML = `<strong>0${reviewIndex+1}</strong> / 03`;
  };
  const reviewButtons = document.querySelectorAll('.testimonial-nav button');
  reviewButtons[0]?.addEventListener('click', () => { reviewIndex = (reviewIndex + reviews.length - 1) % reviews.length; renderReview(); });
  reviewButtons[1]?.addEventListener('click', () => { reviewIndex = (reviewIndex + 1) % reviews.length; renderReview(); });
});