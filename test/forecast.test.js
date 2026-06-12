'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { projectMonthEnd } = require('../out/usage/forecast.js');

describe('projectMonthEnd', () => {
  // June 2026 has 30 days. Use noon to keep the partial-day fraction small.
  const midJune = new Date(2026, 5, 15, 12, 0, 0); // day 15 of 30

  test('linear projection to month-end', () => {
    // 14.5 days elapsed (day 15 minus 1, plus half a day), 145 used -> ~10/day -> ~300.
    const f = projectMonthEnd(145, midJune);
    assert.equal(f.daysInMonth, 30);
    assert.ok(Math.abs(f.dailyRate - 10) < 0.05, `dailyRate=${f.dailyRate}`);
    assert.ok(f.projected >= 295 && f.projected <= 305, `projected=${f.projected}`);
    assert.equal(f.reliable, true);
  });

  test('early-month burst does not blow up (daysElapsed floored at 1)', () => {
    const day1 = new Date(2026, 5, 1, 0, 5, 0); // 5 minutes into the month
    const f = projectMonthEnd(50, day1);
    assert.equal(f.daysElapsed, 1); // floored
    assert.equal(f.projected, 50 * 30); // bounded, not astronomical
    assert.equal(f.reliable, false); // too little signal
  });

  test('budget crossing day is computed when on pace to exceed', () => {
    // 10/day, budget 200 -> crosses on day 20, projected 300 > 200.
    const f = projectMonthEnd(145, midJune, 200);
    assert.equal(f.projectedOverBudget, true);
    assert.equal(f.hitBudgetDay, 20);
  });

  test('no budget crossing when pace stays under budget', () => {
    const f = projectMonthEnd(145, midJune, 1000); // 10/day -> ~300, under 1000
    assert.equal(f.projectedOverBudget, false);
    assert.equal(f.hitBudgetDay, undefined);
  });

  test('zero usage yields zero projection and no crossing', () => {
    const f = projectMonthEnd(0, midJune, 200);
    assert.equal(f.projected, 0);
    assert.equal(f.dailyRate, 0);
    assert.equal(f.hitBudgetDay, undefined);
  });
});
