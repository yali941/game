// Small painted animal portraits, drawn as vectors so the pieces stay clear on phones.
const ns = 'http://www.w3.org/2000/svg';
const eye = (x, y, iris = '#493f28') => `<ellipse cx="${x}" cy="${y}" rx="2.9" ry="3.2" fill="#fff7df"/><ellipse cx="${x + .4}" cy="${y + .2}" rx="1.7" ry="2.5" fill="${iris}"/><circle cx="${x + 1}" cy="${y - .8}" r=".75" fill="white"/>`;
const muzzle = (y = 7) => `<ellipse cx="-5" cy="${y}" rx="6" ry="5" fill="#fff2d4"/><ellipse cx="5" cy="${y}" rx="6" ry="5" fill="#fff2d4"/><path d="M-3 ${y - 3} Q0 ${y - 5} 3 ${y - 3} Q3 ${y} 0 ${y + 1} Q-3 ${y} -3 ${y - 3}" fill="#343735"/><path d="M0 ${y + 1}v3m0 0q-3 3-5 0m5 0q3 3 5 0" fill="none" stroke="#766044" stroke-width=".8" stroke-linecap="round"/>`;
const whiskers = `<path d="M-9 7l-9-2m9 5-10 1m28-4 9-2m-9 5 10 1" fill="none" stroke="#514c43" stroke-width=".6" opacity=".65"/>`;
const eyes = (iris = '#635025') => eye(-6, -2, iris) + eye(6, -2, iris);
const portraits = {
  1: `<circle cx="-13" cy="-12" r="9" fill="#7c8591" stroke="#535f6d"/><circle cx="13" cy="-12" r="9" fill="#7c8591" stroke="#535f6d"/><circle cx="-13" cy="-12" r="6" fill="#dda6a3"/><circle cx="13" cy="-12" r="6" fill="#dda6a3"/><path d="M-16-6Q-14-17 0-14Q14-17 16-6Q20 5 5 17Q0 21-5 17Q-20 5-16-6" fill="url(#fur-grey)" stroke="#64707b"/>${eyes('#2e3237')}<ellipse cy="11" rx="8" ry="6" fill="#e9e5dc"/><ellipse cy="9" rx="3" ry="2.4" fill="#d59b9f"/>${whiskers}<path d="M-2 14v4h4v-4" fill="white" stroke="#a4aaa8" stroke-width=".5"/>`,
  2: `<path d="M-17-4L-17-21L-5-12Q0-14 5-12L17-21L17-4Q22 17 0 20Q-22 17-17-4" fill="url(#fur-charcoal)" stroke="#303641"/><path d="M-14-15l7 5-7 2zm28 0-7 5 7 2" fill="#c99e9e"/><path d="M0-13L-3 3Q-15 4-12 14Q0 23 12 14Q15 4 3 3Z" fill="#f4eee1"/>${eyes('#aaa441')}${muzzle(9)}${whiskers}`,
  3: `<path d="M-12-15Q-24-13-22 5Q-18 13-13 6M12-15Q24-13 22 5Q18 13 13 6" fill="#a76532" stroke="#784926"/><path d="M-16-6Q-15-19 0-18Q15-19 16-6L15 10Q8 21 0 20Q-8 21-15 10Z" fill="url(#fur-gold)" stroke="#b07a3b"/><path d="M-13 6Q-10 0 0 5Q10 0 13 6Q16 19 0 20Q-16 19-13 6" fill="#fff0d3"/>${eyes('#352d26')}${muzzle(9)}<path d="M-3 15q3-2 6 0v4q-3 4-6 0Z" fill="#e39e92"/>`,
  4: `<path d="M-16-5L-14-23L-4-12Q0-15 4-12L14-23L16-5L21 9L13 10L15 15L0 21L-15 15L-13 10L-21 9Z" fill="url(#fur-grey)" stroke="#58636c"/><path d="M-12-17l5 6-6 1zm24 0-5 6 6 1" fill="#d1b2ad"/><path d="M0-10L-5 3L-15 6Q-12 17 0 20Q12 17 15 6L5 3Z" fill="#f2eee3"/>${eyes('#948045')}<path d="M-11-7l8 3m14-3-8 3" stroke="#4a5158" stroke-width="2" stroke-linecap="round"/>${muzzle(10)}`,
  5: `<circle cx="-12" cy="-13" r="7" fill="#db9d3c" stroke="#9e6428"/><circle cx="12" cy="-13" r="7" fill="#db9d3c" stroke="#9e6428"/><circle cx="-12" cy="-13" r="3.6" fill="#594839"/><circle cx="12" cy="-13" r="3.6" fill="#594839"/><path d="M-16-7Q-12-19 0-16Q12-19 16-7L16 8Q12 19 0 20Q-12 19-16 8Z" fill="url(#fur-gold)" stroke="#b58036"/>${[-11,0,11].map((x,i)=>`<circle cx="${x}" cy="${i===1?-12:-8}" r="2.2" fill="none" stroke="#63432c" stroke-width="1.7"/>`).join('')}<path d="M-14 0l2 3m-2 4 3 2m25-9-2 3m2 4-3 2" stroke="#63432c" stroke-width="2" stroke-linecap="round"/>${eyes('#76633b')}${muzzle(10)}${whiskers}`,
  6: `<circle cx="-12" cy="-13" r="7" fill="#c77f2e" stroke="#6e482a"/><circle cx="12" cy="-13" r="7" fill="#c77f2e" stroke="#6e482a"/><circle cx="-12" cy="-13" r="3.5" fill="#eee2c9"/><circle cx="12" cy="-13" r="3.5" fill="#eee2c9"/><path d="M-17-5Q-15-19 0-17Q15-19 17-5L16 10Q8 21 0 20Q-8 21-16 10Z" fill="url(#fur-orange)" stroke="#b27630"/><path d="M-5-15L0-8L5-15L2-14V-17H-2V-14ZM-16-8l8 4-9-1m0 6 8 2-7 2m31-13-8 4 9-1m0 6-8 2 7 2" fill="#493e30"/><path d="M-14 9Q-7 3 0 7Q7 3 14 9Q10 21 0 20Q-10 21-14 9" fill="#fff0d1"/>${eyes('#5c6438')}${muzzle(10)}${whiskers}`,
  7: `<path d="M0-24l6 4 7-1 3 7 6 4-1 8 3 7-6 6-1 7-9 1-8 5-8-5-9-1-1-7-6-6 3-7-1-8 6-4 3-7 7 1Z" fill="url(#lion-mane)" stroke="#8d522b"/><circle cx="-11" cy="-11" r="5" fill="#dca953"/><circle cx="11" cy="-11" r="5" fill="#dca953"/><path d="M-13-6Q-10-17 0-14Q10-17 13-6L12 10Q6 19 0 18Q-6 19-12 10Z" fill="url(#fur-gold)"/><path d="M-10-6l5 1m15-1-5 1" stroke="#86562c" stroke-width="1.5" stroke-linecap="round"/>${eyes('#6b5a30')}${muzzle(8)}<path d="M-5 15L0 19L5 15" fill="#f6deb0"/>`,
  8: `<ellipse cx="-14" cy="0" rx="10" ry="16" fill="#86abb9" stroke="#5c8294"/><ellipse cx="14" cy="0" rx="10" ry="16" fill="#86abb9" stroke="#5c8294"/><ellipse cx="-15" cy="0" rx="6" ry="11" fill="#c8a6b9"/><ellipse cx="15" cy="0" rx="6" ry="11" fill="#c8a6b9"/><path d="M-13-7Q-11-21 0-20Q11-21 13-7L11 11Q7 16 0 15Q-7 16-11 11Z" fill="url(#fur-blue)" stroke="#6b99ad"/>${eye(-7,-2,'#343b46')}${eye(7,-2,'#343b46')}<path d="M-10 5Q-15 15-6 12M10 5Q15 15 6 12" fill="#fff4d9" stroke="#d8d8c0" stroke-width=".5"/><path d="M-4 3L-5 15Q-5 25 5 23Q12 22 10 16Q8 14 6 17Q6 20 2 18L4 3" fill="url(#fur-blue)" stroke="#5c8a9e"/><path d="M-2 8h5m-5 4h5m-5 4h4" stroke="#7298a9" stroke-width=".7"/>`
};

export function addTabletopDefs(defs) {
  const colors = {
    'fur-grey': ['#c8cdd0', '#7f8b98'], 'fur-charcoal': ['#596270', '#303745'],
    'fur-gold': ['#ffdc88', '#df9e43'], 'fur-orange': ['#ffca73', '#e4973f'],
    'fur-blue': ['#c0deea', '#7eaabd'], 'lion-mane': ['#ca8b43', '#96552a'],
    'token-red': ['#ed7772', '#b93840'], 'token-blue': ['#70afea', '#306bb6'],
    'token-ivory': ['#fffef5', '#ddd6bd'], 'jungle-grass': ['#abc579', '#8ba956'],
    'jungle-path': ['#e4d39f', '#ccba81'], 'jungle-water': ['#9bd2d5', '#57a5b1'],
    'jungle-wood': ['#d0a971', '#96693c']
  };
  for (const [id, stops] of Object.entries(colors)) {
    const gradient = document.createElementNS(ns, 'linearGradient'); gradient.id = id;
    gradient.setAttribute('x2','30%'); gradient.setAttribute('y2','100%');
    gradient.innerHTML = stops.map((color,i)=>`<stop offset="${i*100}%" stop-color="${color}"/>`).join(''); defs.append(gradient);
  }
  for (const [rank, art] of Object.entries(portraits)) {
    const symbol = document.createElementNS(ns,'symbol'); symbol.id = 'animal-' + rank;
    symbol.setAttribute('viewBox','-25 -25 50 50'); symbol.innerHTML = art; defs.append(symbol);
  }
}

export function animalPortrait(rank, x, y) {
  const use = document.createElementNS(ns, 'use');
  for (const [key,value] of Object.entries({ href:'#animal-'+rank, x:x-22, y:y-25, width:44, height:44, 'pointer-events':'none' })) use.setAttribute(key,value);
  return use;
}
