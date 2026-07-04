export type DateScopeMode = "single_month" | "custom_range" | "multi_month";

export type DateScopeState = {
  mode: DateScopeMode;
  month: string;
  year: string;
  startDate: string;
  endDate: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
};

export const MONTHS = [
  { value: "0", label: "January" },
  { value: "1", label: "February" },
  { value: "2", label: "March" },
  { value: "3", label: "April" },
  { value: "4", label: "May" },
  { value: "5", label: "June" },
  { value: "6", label: "July" },
  { value: "7", label: "August" },
  { value: "8", label: "September" },
  { value: "9", label: "October" },
  { value: "10", label: "November" },
  { value: "11", label: "December" },
];

const pad = (n: number) => String(n).padStart(2, "0");

export function yearOptions() {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear - 5; y <= currentYear + 1; y++) years.push(y);
  return years;
}

export function createDefaultDateScope(): DateScopeState {
  const now = new Date();
  return {
    mode: "single_month",
    month: String(now.getMonth()),
    year: String(now.getFullYear()),
    startDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    endDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    )}`,
    startMonth: String(now.getMonth()),
    startYear: String(now.getFullYear()),
    endMonth: String(now.getMonth()),
    endYear: String(now.getFullYear()),
  };
}

function monthName(value: string) {
  return MONTHS.find((month) => month.value === value)?.label ?? "Unknown";
}

function monthRange(year: number, month: number) {
  const monthNumber = month + 1;
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    from: `${year}-${pad(monthNumber)}-01`,
    to: `${year}-${pad(monthNumber)}-${pad(lastDay)}`,
  };
}

export function getDateScopeRange(scope: DateScopeState) {
  if (scope.mode === "custom_range") {
    const from = scope.startDate || createDefaultDateScope().startDate;
    const to = scope.endDate || from;
    const ordered = from <= to ? { from, to } : { from: to, to: from };
    return { ...ordered, label: `${ordered.from} to ${ordered.to}` };
  }

  if (scope.mode === "multi_month") {
    const startYear = Number(scope.startYear);
    const startMonth = Number(scope.startMonth);
    const endYear = Number(scope.endYear);
    const endMonth = Number(scope.endMonth);
    const start = monthRange(startYear, startMonth);
    const end = monthRange(endYear, endMonth);
    const from = start.from <= end.from ? start.from : end.from;
    const to = start.from <= end.from ? end.to : start.to;
    return {
      from,
      to,
      label: `${monthName(scope.startMonth)} ${scope.startYear} to ${monthName(scope.endMonth)} ${scope.endYear}`,
    };
  }

  if (scope.month === "all") {
    return {
      from: `${scope.year}-01-01`,
      to: `${scope.year}-12-31`,
      label: `All months ${scope.year}`,
    };
  }

  const range = monthRange(Number(scope.year), Number(scope.month));
  return {
    ...range,
    label: `${monthName(scope.month)} ${scope.year}`,
  };
}

export function dateInScope(date: string | null | undefined, scope: DateScopeState) {
  if (!date) return false;
  const value = date.slice(0, 10);
  const { from, to } = getDateScopeRange(scope);
  return value >= from && value <= to;
}
