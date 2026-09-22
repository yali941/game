// Visual itinerary derived from the authoritative move, without changing game rules.
export function flightHeading(from, to, fallback = 0) {
  const dx=to[0]-from[0],dy=to[1]-from[1];
  return dx===0 && dy===0 ? fallback : Math.atan2(dy,dx)*180/Math.PI;
}

export function flightMotionSteps(move) {
  const steps = [];
  let from = move.from;
  const add = (to, type, duration) => { steps.push({ from, to, type, duration }); from = to; };
  if (from === -1) add(0, 'launch', 480);
  else {
    for (let n = 1; n <= move.dice; n++) {
      const progress = move.from + n;
      add(progress > 56 ? 112 - progress : progress, 'hop', 150);
    }
    for (const to of move.landings.slice(1)) add(to, from === 18 && to === 30 ? 'fly' : 'jump', from === 18 && to === 30 ? 850 : 380);
  }
  if (move.to === 56) { add(56, 'arrive', 300); add(-1, 'home', 460); }
  return steps;
}

export function sampleFlightLeg(leg, elapsed) {
  const t = Math.max(0, Math.min(1, (elapsed - leg.start) / leg.duration));
  const smooth = t * t * (3 - 2 * t), airborne = Math.sin(Math.PI * t);
  const heights = { hop: 11, jump: 32, fly: 44, launch: 28, return: 32, home: 26, arrive: 0 };
  return {
    x: leg.from[0] + (leg.to[0] - leg.from[0]) * smooth,
    y: leg.from[1] + (leg.to[1] - leg.from[1]) * smooth,
    lift: airborne * heights[leg.type],
    scale: 1 + airborne * (leg.type === 'fly' ? .42 : leg.type === 'arrive' ? .28 : .12),
    t
  };
}
