/**
 * Month-end usage forecasting for the dashboard's Monthly tab.
 *
 * Copilot premium-request budgets and most subscriptions roll on a calendar
 * month, so the useful question is "at my current pace, where do I land by
 * month-end, and will I blow the budget before then?" This is a pure linear
 * burn-rate projection — deliberately simple and explainable, no smoothing
 * model the user can't reason about.
 */

export interface MonthForecast {
  /** Usage so far this calendar month (combined requests). */
  used: number;
  /** Days elapsed in the month, floored at 1 to avoid early-month blow-up. */
  daysElapsed: number;
  daysInMonth: number;
  daysRemaining: number;
  /** used / daysElapsed. */
  dailyRate: number;
  /** Linear projection to month-end. */
  projected: number;
  /** False for the first couple of days — too little signal to trust. */
  reliable: boolean;
  budget?: number;
  /** Projected to exceed budget at month-end. */
  projectedOverBudget?: boolean;
  /** Calendar day-of-month the budget is projected to be crossed, if within this month. */
  hitBudgetDay?: number;
}

/** Minimum elapsed days before we present the projection as trustworthy. */
const RELIABLE_AFTER_DAYS = 3;

export function projectMonthEnd(used: number, now: Date = new Date(), budget = 0): MonthForecast {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Elapsed time including the partial current day, floored at 1 day so a burst
  // at 00:05 on the 1st doesn't extrapolate to a preposterous monthly total.
  const fractionOfToday =
    (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
  const rawElapsed = now.getDate() - 1 + fractionOfToday;
  const daysElapsed = Math.max(rawElapsed, 1);

  const dailyRate = used / daysElapsed;
  const projected = Math.round(dailyRate * daysInMonth);
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  const forecast: MonthForecast = {
    used,
    daysElapsed,
    daysInMonth,
    daysRemaining,
    dailyRate,
    projected,
    reliable: rawElapsed >= RELIABLE_AFTER_DAYS,
  };

  if (budget > 0) {
    forecast.budget = budget;
    forecast.projectedOverBudget = projected > budget;
    if (dailyRate > 0) {
      // Day-of-month at which cumulative usage crosses the budget.
      const crossDay = Math.ceil(budget / dailyRate);
      if (crossDay <= daysInMonth) {
        forecast.hitBudgetDay = crossDay;
      }
    }
  }

  return forecast;
}
