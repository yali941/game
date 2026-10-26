import test from 'node:test';
import assert from 'node:assert/strict';
import { newCube, turnLayer, scramble, isSolved } from '../public/cube-rules.js';
import { AXES, NORMALS, defaultView, orbitView, projectPoint, rotatePoint, cssAngle, selectDragLayer, dragAngle } from '../public/cube-rules.js';
const close = (a, b) => a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < 1e-7, `${a} != ${b}`));
const css = ([x, y, z]) => [x, -y, z];

test('all nine layers: animation endpoint equals every physical sticker position and normal', () => {
  for (const axis of AXES) for (const index of [-1, 0, 1]) for (const direction of [-1, 1]) {
    const cube = newCube(); scramble(cube);
    const before = structuredClone(cube.stickers);
    turnLayer(cube, axis, index, direction);
    for (let i = 0; i < before.length; i++) {
      const moved = before[i].position[AXES.indexOf(axis)] === index;
      for (const field of ['position', 'normal']) {
        const final = moved ? rotatePoint(css(before[i][field]), axis, cssAngle(axis, direction * Math.PI / 2)) : css(before[i][field]);
        close(final, css(cube.stickers[i][field]));
      }
      assert.equal(cube.stickers[i].color, before[i].color);
    }
    turnLayer(cube, axis, index, -direction);
    assert.deepEqual(cube.stickers, before);
  }
});
test('front-facing gestures select the touched row/column and follow right, left, up and down', () => {
  const view = [1,0,0,0,1,0,0,0,1];
  for (const index of [-1, 0, 1]) {
    for (const direction of [-1, 1]) {
      const row = selectDragLayer([0,index,1], NORMALS.F, [0,index*78,115], [40*direction,0], view);
      assert.equal(row.axis, 'y'); assert.equal(row.index, index);
      assert.equal(Math.sign(dragAngle([40*direction,0], row.tangent)), direction);
      const col = selectDragLayer([index,0,1], NORMALS.F, [index*78,0,115], [0,40*direction], view);
      assert.equal(col.axis, 'x'); assert.equal(col.index, index);
      assert.equal(Math.sign(dragAngle([0,40*direction], col.tangent)), direction);
    }
  }
});
test('drag direction follows projected movement after arbitrary orbit, including upside down and rear faces', () => {
  let checks = 0;
  for (const [dx,dy] of [[0,0],[420,0],[0,420],[-600,-350],[900,570]]) {
    const view = orbitView(defaultView(), dx, dy);
    for (const normal of Object.values(NORMALS)) for (const axis of AXES) {
      if (normal[AXES.indexOf(axis)]) continue;
      const position = [...normal], point = normal.map(v => v * 115);
      for (const sign of [-1,1]) {
        const start = projectPoint(point, view);
        const end = projectPoint(rotatePoint(point, axis, sign * .001), view);
        const delta = end.map((v,i) => (v - start[i]) * 300);
        if (Math.hypot(...delta) < 8) continue;
        const selection = selectDragLayer(position, normal, point, delta, view);
        assert.equal(selection.axis, axis);
        assert.equal(Math.sign(dragAngle(delta, selection.tangent)), sign);
        checks++;
      }
    }
  }
  assert.ok(checks > 80);
});
test('tiny gestures do not turn; reversing the same drag reverses the layer and snap is bounded', () => {
  assert.equal(selectDragLayer([1,1,1], NORMALS.F, [78,78,115], [2,3], defaultView()), null);
  assert.equal(dragAngle([1000,0], [100,0]), Math.PI/2);
  assert.equal(dragAngle([-1000,0], [100,0]), -Math.PI/2);
});
test('middle layer turns preserve physical cubies and a whole-cube reorientation is still solved', () => {
  for (const axis of AXES) {
    const cube = newCube();
    for (const layer of [-1,0,1]) turnLayer(cube, axis, layer, 1);
    assert.equal(isSolved(cube), true);
    turnLayer(cube, axis, 0, 1); assert.equal(isSolved(cube), false);
    turnLayer(cube, axis, 0, -1); assert.equal(isSolved(cube), true);
  }
});
