import test from 'node:test';
import assert from 'node:assert/strict';
import { newFlight, rollFlight, moveFlight } from '../public/table-rules.js';
import { flightMotionSteps, sampleFlightLeg, flightHeading } from '../public/flight-path.js';

function itinerary(from, dice) {
  const game = newFlight(); game.planes[0].progress = from;
  rollFlight(game, 1, dice); moveFlight(game, 1, '1-1');
  return { game, steps: flightMotionSteps(game.last) };
}
test('flight animation launches, hops every dice step and separates color jumps', () => {
  assert.deepEqual(itinerary(-1, 6).steps.map(s => [s.from, s.to, s.type]), [[-1, 0, 'launch']]);
  assert.deepEqual(itinerary(0, 3).steps.map(s => [s.from, s.to, s.type]), [[0, 1, 'hop'], [1, 2, 'hop'], [2, 3, 'hop']]);
  assert.deepEqual(itinerary(0, 2).steps.map(s => [s.to, s.type]), [[1, 'hop'], [2, 'hop'], [6, 'jump']]);
});
test('shortcut animation follows the authoritative order for both chained cases', () => {
  assert.deepEqual(itinerary(13, 1).steps.map(s => [s.to, s.type]), [[14, 'hop'], [18, 'jump'], [30, 'fly']]);
  assert.deepEqual(itinerary(17, 1).steps.map(s => [s.to, s.type]), [[18, 'hop'], [30, 'fly'], [34, 'jump']]);
});
test('overshooting visibly reaches the finish then bounces; exact finish celebrates then parks', () => {
  assert.deepEqual(itinerary(55, 3).steps.map(s => s.to), [56, 55, 54]);
  assert.deepEqual(itinerary(55, 1).steps.map(s => [s.to, s.type]), [[56, 'hop'], [56, 'arrive'], [-1, 'home']]);
});
test('every legal progress/dice combination ends at the real move destination', () => {
  for (let from = -1; from < 56; from++) for (let dice = 1; dice <= 6; dice++) {
    if (from === -1 && ![2,4,6].includes(dice)) continue;
    const { game, steps } = itinerary(from, dice);
    assert.equal(steps.at(-1).to, game.last.to === 56 ? -1 : game.last.to);
    for (const step of steps) { assert.ok(step.to >= -1 && step.to <= 56); assert.ok(step.duration > 0); }
  }
});
test('motion starts and lands exactly, with a higher arc and larger plane during flight', () => {
  const leg = { from: [10, 20], to: [70, 80], start: 100, duration: 600, type: 'fly' };
  const first = sampleFlightLeg(leg, 0), middle = sampleFlightLeg(leg, 400), last = sampleFlightLeg(leg, 900);
  assert.deepEqual([first.x, first.y, first.lift, first.scale], [10, 20, 0, 1]);
  assert.deepEqual([last.x, last.y, last.scale], [70, 80, 1]);
  assert.ok(Math.abs(last.lift) < .0001);
  assert.equal(middle.x, 40); assert.equal(middle.y, 50);
  assert.ok(middle.lift > sampleFlightLeg({ ...leg, type: 'hop' }, 400).lift);
  assert.ok(middle.scale > 1.3);
});

test('plane noses follow every travel direction, reverse on bounce and hold at rest', () => {
  assert.equal(flightHeading([0,0],[1,0]),0);
  assert.equal(flightHeading([0,0],[0,1]),90);
  assert.equal(flightHeading([0,0],[-1,0]),180);
  assert.equal(flightHeading([0,0],[0,-1]),-90);
  for(const to of [[36,0],[0,-36],[-36,0],[0,36],[36,36],[-36,36]]) {
    const leg={from:[0,0],to,start:0,duration:500,type:'hop'};
    const a=sampleFlightLeg(leg,100),b=sampleFlightLeg(leg,200);
    const heading=flightHeading(leg.from,leg.to)*Math.PI/180;
    assert.ok((b.x-a.x)*Math.cos(heading)+(b.y-a.y)*Math.sin(heading)>0);
    assert.equal(Math.abs(flightHeading(to,[0,0])-flightHeading([0,0],to)),180);
  }
  assert.equal(flightHeading([3,4],[3,4],-90),-90);
});
